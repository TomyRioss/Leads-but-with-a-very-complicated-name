// HTTP API for the leadta WhatsApp worker.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config, logger } from './config.mjs';
import { flushAllSync } from './store.mjs';
import { kick as kickCallbacks, stopCallbacks } from './callbacks.mjs';
import { startScheduler, stopScheduler } from './scheduler.mjs';
import { enqueue, isKnownRef, messageStatus, pumpAll, stopQueue } from './queue.mjs';
import { deleteSession, getSocket, getState, restoreSessions, shutdownSessions, startSession } from './sessions.mjs';

const BODY_LIMIT = 64 * 1024;
const USER_ID_RE = /^[a-zA-Z0-9]{15}$/;
const PHONE_RE = /^[1-9][0-9]{7,14}$/;
const SECRET_DIGEST = createHash('sha256').update(`Bearer ${config.secret}`).digest();

class HttpError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function authorized(req) {
  const header = req.headers.authorization || '';
  const digest = createHash('sha256').update(header).digest();
  return timingSafeEqual(digest, SECRET_DIGEST);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > BODY_LIMIT) return reject(new HttpError(413, 'payload_too_large'));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

const isStr = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;

function parseItems(body) {
  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) throw new HttpError(400, 'invalid_items');
  return items.map((it) => {
    if (!it || typeof it !== 'object') throw new HttpError(400, 'invalid_items');
    if (!isStr(it.ref, 1, 64)) throw new HttpError(400, 'invalid_ref');
    if (!isStr(it.leadId, 15, 15) || !USER_ID_RE.test(it.leadId)) throw new HttpError(400, 'invalid_lead_id');
    if (!isStr(it.text, 1, 1500) || !it.text.trim()) throw new HttpError(400, 'invalid_text');
    return { ref: it.ref, leadId: it.leadId, phone: typeof it.phone === 'string' ? it.phone : '', text: it.text };
  });
}

async function postMessages(userId, body) {
  const items = parseItems(body);
  const sock = getSocket(userId);
  if (!sock) throw new HttpError(409, 'not_connected');

  const queued = [];
  const duplicates = [];
  const invalid = [];
  const accepted = [];
  const seen = new Set();

  for (const it of items) {
    if (seen.has(it.ref) || isKnownRef(userId, it.ref)) {
      duplicates.push(it.ref);
      continue;
    }
    seen.add(it.ref);
    if (!PHONE_RE.test(it.phone)) {
      invalid.push({ ref: it.ref, reason: 'invalid_phone' });
      continue;
    }
    let result;
    try {
      [result] = (await sock.onWhatsApp(`${it.phone}@s.whatsapp.net`)) ?? [];
    } catch (err) {
      logger.warn({ userId, ref: it.ref, err: err?.message }, 'onWhatsApp lookup failed');
      invalid.push({ ref: it.ref, reason: 'lookup_failed' });
      continue;
    }
    if (!result?.exists || !result.jid) {
      invalid.push({ ref: it.ref, reason: 'not_on_whatsapp' });
      continue;
    }
    accepted.push({ ...it, jid: result.jid });
    queued.push(it.ref);
  }

  const etaSeconds = accepted.length ? enqueue(userId, accepted) : 0;
  return { queued, duplicates, invalid, etaSeconds };
}

// Phone -> registered on WhatsApp. Same business shows up in many users' searches, so a week of cache saves lookups.
const CHECK_TTL_MS = 7 * 24 * 3600_000;
const CHECK_CACHE_MAX = 20_000;
const checkCache = new Map();
// WhatsApp registers some mobiles with an extra digit (AR 549..., MX 521...): compare without it.
const sameNumber = (phone) => phone.replace(/^549/, '54').replace(/^521/, '52');

async function postCheck(userId, body) {
  const phones = body?.phones;
  if (!Array.isArray(phones) || phones.length < 1 || phones.length > 25 || !phones.every((p) => typeof p === 'string' && PHONE_RE.test(p))) {
    throw new HttpError(400, 'invalid_phones');
  }
  const sock = getSocket(userId);
  if (!sock) throw new HttpError(409, 'not_connected');

  const now = Date.now();
  const results = {};
  const unknown = [];
  for (const phone of new Set(phones)) {
    const hit = checkCache.get(phone);
    if (hit && now - hit.at < CHECK_TTL_MS) results[phone] = hit.exists;
    else unknown.push(phone);
  }
  if (unknown.length) {
    let found = null;
    try {
      found = (await sock.onWhatsApp(...unknown.map((p) => `${p}@s.whatsapp.net`))) ?? [];
    } catch (err) {
      logger.warn({ userId, err: err?.message }, 'onWhatsApp check failed');
    }
    const registered = new Set((found ?? []).filter((r) => r?.exists).map((r) => sameNumber(String(r.jid).split('@')[0])));
    for (const phone of unknown) {
      if (!found) {
        results[phone] = null; // lookup failed: unknown, never cached
        continue;
      }
      const exists = registered.has(sameNumber(phone));
      results[phone] = exists;
      checkCache.delete(phone);
      checkCache.set(phone, { exists, at: now });
      if (checkCache.size > CHECK_CACHE_MAX) checkCache.delete(checkCache.keys().next().value);
    }
  }
  return { results };
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
  if (parts[0] !== 'sessions' || parts.length < 2 || parts.length > 4) return send(res, 404, { error: 'not_found' });

  const userId = parts[1];
  if (!USER_ID_RE.test(userId)) return send(res, 400, { error: 'invalid_user_id' });
  const action = parts[2];

  if (action === 'messages' && parts.length === 4 && req.method === 'GET') {
    const ref = parts[3];
    if (!/^[a-f0-9]{40}$/.test(ref)) return send(res, 400, { error: 'invalid_ref' });
    return send(res, 200, { status: messageStatus(userId, ref), connection: getState(userId).status });
  }
  if (action === 'messages' && parts.length === 3 && req.method === 'GET') {
    const refs = url.searchParams.getAll('ref');
    if (!refs.length || refs.length > 25 || refs.some((ref) => !/^[a-f0-9]{40}$/.test(ref))) return send(res, 400, { error: 'invalid_refs' });
    return send(res, 200, { statuses: Object.fromEntries(refs.map((ref) => [ref, messageStatus(userId, ref)])), connection: getState(userId).status });
  }

  if (!action && req.method === 'GET') return send(res, 200, getState(userId));
  if (!action && req.method === 'DELETE') return send(res, 200, await deleteSession(userId));
  if (action === 'start' && req.method === 'POST') return send(res, 200, await startSession(userId));
  if (action === 'check' && req.method === 'POST') {
    const body = await readJson(req);
    return send(res, 200, await postCheck(userId, body));
  }
  if (action === 'messages' && req.method === 'POST') {
    const body = await readJson(req);
    return send(res, 200, await postMessages(userId, body));
  }
  return send(res, 404, { error: 'not_found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    logger.error({ err }, 'request failed');
    if (!res.headersSent) send(res, 500, { error: 'internal_error' });
  });
});
server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, async () => {
  logger.warn({ port: config.port }, 'whatsapp-worker listening');
  try {
    const n = await restoreSessions();
    if (n) logger.warn({ sessions: n }, 'restoring sessions');
  } catch (err) {
    logger.error({ err }, 'failed to restore sessions');
  }
  kickCallbacks();
  pumpAll();
  startScheduler();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close();
  stopQueue();
  stopCallbacks();
  stopScheduler();
  await shutdownSessions();
  try {
    flushAllSync();
  } catch (err) {
    logger.error({ err }, 'failed to flush state');
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
