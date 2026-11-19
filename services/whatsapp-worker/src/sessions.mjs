// Baileys socket lifecycle per user.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  jidDecode,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
} from 'baileys';
import { config, logger, baileysLogger } from './config.mjs';
import { findLead, hasReplied, markReplied, dropContacts } from './store.mjs';
import { emitCallback } from './callbacks.mjs';
import { pump, stats, dropQueue, setSessionProvider } from './queue.mjs';

const SESSIONS_DIR = path.join(config.dataDir, 'sessions');
const QR_WINDOW_MS = 3 * 60_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 7;

// libsignal 6.0.0 writes the full Signal session object to stderr from this
// warning. That object contains key material, so keep the event but drop its
// arguments before they reach the worker logs.
const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (args[0] === 'Closing open session in favor of incoming prekey bundle') {
    logger.warn('replaced an old Signal session with a new prekey bundle');
    return;
  }
  originalConsoleWarn(...args);
};

/** userId -> { sock, status, qr, phone, attempts, reconnectTimer, qrTimer, qrStartedAt, closing } */
const sessions = new Map();
let shuttingDown = false;

const authDir = (userId) => path.join(SESSIONS_DIR, userId);
const digitsOf = (jid) => (jid ? jidDecode(jid)?.user ?? null : null);

export function getSocket(userId) {
  const s = sessions.get(userId);
  return s && s.status === 'connected' ? s.sock : null;
}

setSessionProvider({ getSocket });

export function getState(userId) {
  const s = sessions.get(userId);
  return {
    status: s?.status ?? 'disconnected',
    qr: s?.status === 'qr' ? s.qr : null,
    phone: s?.phone ?? null,
    ...stats(userId),
  };
}

export async function startSession(userId) {
  const existing = sessions.get(userId);
  if (existing && existing.status !== 'disconnected') return getState(userId);
  const s = existing ?? { sock: null, status: 'connecting', qr: null, phone: null, attempts: 0 };
  s.status = 'connecting';
  s.closing = false;
  s.attempts = 0;
  s.qrStartedAt = null;
  sessions.set(userId, s);
  try {
    await connect(userId, s);
  } catch (err) {
    logger.error({ err, userId }, 'failed to create socket');
    s.status = 'disconnected';
  }
  return getState(userId);
}

async function connect(userId, s) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir(userId));
  if (s.closing || shuttingDown) return;
  const log = baileysLogger.child({ userId });
  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log) },
    logger: log,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });
  s.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (s.sock !== sock) return; // stale socket
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (!s.qrStartedAt) {
        s.qrStartedAt = Date.now();
        s.qrTimer = setTimeout(() => void abortPairing(userId, s, 'qr_timeout'), QR_WINDOW_MS);
      }
      s.status = 'qr';
      s.qr = qr;
    }

    if (connection === 'open') {
      clearTimeout(s.qrTimer);
      s.qrTimer = null;
      s.qrStartedAt = null;
      s.status = 'connected';
      s.qr = null;
      s.attempts = 0;
      const user = sock.user;
      s.phone = digitsOf(user?.phoneNumber) ?? (isLidUser(user?.id) ? null : digitsOf(user?.id));
      logger.info({ userId }, 'session connected');
      pump(userId);
    }

    if (connection === 'close') {
      s.qr = null;
      if (s.closing || shuttingDown) return;
      const code = lastDisconnect?.error?.output?.statusCode;
      const registered = !!state.creds.me?.id;
      const reason = Object.entries(DisconnectReason).find(([, value]) => value === code)?.[0] ?? 'unknown';
      logger.warn({ userId, code, reason, registered }, 'connection closed');

      if (code === DisconnectReason.loggedOut) {
        void wipe(userId, s);
        return;
      }
      const qrExpired = s.qrStartedAt && Date.now() - s.qrStartedAt >= QR_WINDOW_MS;
      if (!registered && (code === DisconnectReason.timedOut || qrExpired)) {
        void abortPairing(userId, s, 'qr_expired');
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        // Another client took over this session; reconnecting would fight it.
        s.status = 'disconnected';
        s.sock = null;
        return;
      }
      scheduleReconnect(userId, s, code === DisconnectReason.restartRequired ? 0 : undefined);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      handleIncoming(userId, sock, msg).catch((err) =>
        logger.warn({ userId, err: err?.message }, 'incoming handler error'),
      );
    }
  });
}

function scheduleReconnect(userId, s, forcedDelay) {
  if (s.attempts >= MAX_RECONNECT_ATTEMPTS) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
    s.status = 'disconnected';
    s.qr = null;
    s.sock = null;
    logger.warn({ userId, attempts: s.attempts }, 'reconnect limit reached; waiting for manual retry');
    return;
  }
  s.status = 'connecting';
  const delay = forcedDelay ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** s.attempts);
  s.attempts += 1;
  clearTimeout(s.reconnectTimer);
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    if (s.closing || shuttingDown) return;
    connect(userId, s).catch((err) => {
      logger.error({ err, userId }, 'reconnect failed');
      scheduleReconnect(userId, s);
    });
  }, delay);
}

async function abortPairing(userId, s, reason) {
  logger.info({ userId, reason }, 'pairing aborted');
  await closeSocket(s, false);
  // Unregistered creds are useless and would re-trigger a QR on boot.
  await fsp.rm(authDir(userId), { recursive: true, force: true }).catch(() => {});
  s.status = 'disconnected';
  s.qrStartedAt = null;
}

async function wipe(userId, s) {
  logger.warn({ userId }, 'session logged out, wiping auth');
  await closeSocket(s, false);
  await fsp.rm(authDir(userId), { recursive: true, force: true }).catch(() => {});
  s.status = 'disconnected';
  s.phone = null;
}

async function closeSocket(s, logout) {
  s.closing = true;
  clearTimeout(s.qrTimer);
  clearTimeout(s.reconnectTimer);
  s.qrTimer = s.reconnectTimer = null;
  s.qr = null;
  const sock = s.sock;
  s.sock = null;
  if (!sock) return;
  try {
    if (logout) await sock.logout();
    else await sock.end(undefined);
  } catch {
    try { await sock.end(undefined); } catch { /* already closed */ }
  }
  sock.ev.removeAllListeners();
}

export async function deleteSession(userId) {
  const s = sessions.get(userId);
  if (s) {
    await closeSocket(s, s.status === 'connected');
    sessions.delete(userId);
  }
  await fsp.rm(authDir(userId), { recursive: true, force: true });
  dropQueue(userId);
  await dropContacts(userId);
  return { status: 'disconnected' };
}

function textOf(message) {
  const m = normalizeMessageContent(message);
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

async function handleIncoming(userId, sock, msg) {
  const key = msg.key;
  if (!key || key.fromMe || !msg.message) return;
  const jid = key.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return;

  let phone = null;
  let lid = null;
  if (isLidUser(jid)) {
    lid = digitsOf(jid);
    const alt = key.remoteJidAlt || key.senderPn;
    phone = alt && !isLidUser(alt) ? digitsOf(alt) : null;
    if (!phone) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
      if (pn) phone = digitsOf(pn);
    }
  } else {
    phone = digitsOf(jid);
    if (key.remoteJidAlt && isLidUser(key.remoteJidAlt)) lid = digitsOf(key.remoteJidAlt);
  }

  const leadId = findLead(userId, { phone, lid });
  if (!leadId || hasReplied(userId, leadId)) return;
  markReplied(userId, leadId);
  const ts = Number(msg.messageTimestamp) || 0;
  logger.info({ userId, leadId }, 'lead replied');
  emitCallback({
    type: 'replied',
    userId,
    leadId,
    text: textOf(msg.message).slice(0, 500),
    at: new Date(ts ? ts * 1000 : Date.now()).toISOString(),
  });
}

export async function restoreSessions() {
  let dirs = [];
  try {
    dirs = await fsp.readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return 0;
  }
  const ids = dirs
    .filter((d) => d.isDirectory() && /^[a-zA-Z0-9]{15}$/.test(d.name))
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(authDir(id), 'creds.json')));
  // Stagger starts to avoid a CPU spike on a 1 vCPU host.
  ids.forEach((id, i) => {
    setTimeout(() => {
      if (!shuttingDown) void startSession(id);
    }, i * 2000);
  });
  return ids.length;
}

export async function shutdownSessions() {
  shuttingDown = true;
  await Promise.allSettled([...sessions.values()].map((s) => closeSocket(s, false)));
}
