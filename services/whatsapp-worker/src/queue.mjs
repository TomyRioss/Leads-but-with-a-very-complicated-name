// Per-user FIFO outbound queue with a monthly limit and random spacing.
import { config, logger } from './config.mjs';
import { state, saveState, rememberContact } from './store.mjs';
import { emitCallback } from './callbacks.mjs';

const MAX_SENT_REFS = 2000;
const MAX_SEND_ATTEMPTS = 3;
const MAX_TRANSIENT_SEND_ATTEMPTS = 10;
const RETRY_DELAY_MS = 60_000;

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** "YYYY-MM" in config.timeZone: the monthly quota rolls over at local midnight of the 1st. */
export const thisMonth = (now = Date.now()) => dayFmt.format(new Date(now)).slice(0, 7);

/**
 * ms until the 1st of next month, local midnight in config.timeZone (+1 s margin).
 * ponytail: walks local days with timeFmt/dayFmt; fine for a fixed-offset zone like Buenos Aires.
 */
export function msUntilNextMonth(now = Date.now()) {
  const [h, m, s] = timeFmt.format(new Date(now)).split(':').map(Number);
  const msToMidnight = 86_400_000 - (((h * 60 + m) * 60 + s) * 1000 + (now % 1000));
  const [y, mo, d] = dayFmt.format(new Date(now)).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return msToMidnight + (daysInMonth - d) * 86_400_000 + 1000;
}

const randomDelay = () =>
  config.minDelayMs + Math.floor(Math.random() * (config.maxDelayMs - config.minDelayMs + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sessions = null; // { getSocket(userId) -> sock|null } injected to avoid an import cycle
export const setSessionProvider = (p) => { sessions = p; };

const timers = new Map(); // userId -> Timeout
const busy = new Set();
let stopped = false;

export function userState(userId) {
  let u = state.users[userId];
  if (!u) {
    u = state.users[userId] = { queue: [], sentRefs: [], month: thisMonth(), sentMonth: 0, nextAt: 0 };
  }
  // State saved before the monthly quota had a daily counter: today's sends count toward this month.
  if (u.month === undefined) {
    u.month = thisMonth();
    u.sentMonth = typeof u.day === 'string' && u.day.startsWith(u.month) ? u.sentToday || 0 : 0;
    delete u.day;
    delete u.sentToday;
  }
  const mo = thisMonth();
  if (u.month !== mo) { u.month = mo; u.sentMonth = 0; }
  return u;
}

export function stats(userId) {
  const u = state.users[userId] ? userState(userId) : null;
  return { sentThisMonth: u ? u.sentMonth : 0, monthlyLimit: config.monthlyLimit, queued: u ? u.queue.length : 0 };
}

export function isKnownRef(userId, ref) {
  const u = state.users[userId];
  if (!u) return false;
  return u.queue.some((q) => q.ref === ref) || u.sentRefs.includes(ref);
}

export function messageStatus(userId, ref) {
  const u = state.users[userId];
  if (!u) return "unknown";
  if (u.queue.some((item) => item.ref === ref)) return "queued";
  if (u.failedRefs?.includes(ref)) return "failed";
  if (u.sentRefs.includes(ref)) return "sent";
  return "unknown";
}

/** Estimated seconds until the item at queue index `idx` is sent. */
function etaFor(u, idx) {
  const now = Date.now();
  const avg = (config.minDelayMs + config.maxDelayMs) / 2;
  const remaining = Math.max(0, config.monthlyLimit - u.sentMonth);
  let ms;
  if (idx < remaining) {
    ms = Math.max(0, u.nextAt - now) + idx * avg;
  } else {
    // Over the monthly cap: waits for next month (the app blocks this before queueing; kept as a safety net).
    ms = msUntilNextMonth(now) + (idx - remaining) * avg;
  }
  return Math.round(ms / 1000);
}

export function enqueue(userId, items) {
  const u = userState(userId);
  for (const it of items) u.queue.push({ ...it, attempts: 0, queuedAt: Date.now() });
  saveState();
  const eta = u.queue.length ? etaFor(u, u.queue.length - 1) : 0;
  pump(userId);
  return eta;
}

export function dropQueue(userId) {
  const u = state.users[userId];
  clearTimer(userId);
  if (u) { u.queue = []; saveState(); }
}

function clearTimer(userId) {
  const t = timers.get(userId);
  if (t) { clearTimeout(t); timers.delete(userId); }
}

function wakeIn(userId, ms) {
  clearTimer(userId);
  const t = setTimeout(() => { timers.delete(userId); pump(userId); }, Math.max(0, ms));
  timers.set(userId, t);
}

function isConnectionError(err) {
  const code = err?.output?.statusCode;
  const msg = String(err?.message || '');
  return code === 428 || code === 408 || /connection (closed|lost)|timed out|not open/i.test(msg);
}

export function pump(userId) {
  if (stopped || busy.has(userId) || timers.has(userId)) return;
  const u = state.users[userId];
  if (!u || !u.queue.length) return;
  userState(userId); // month rollover
  const sock = sessions?.getSocket(userId);
  if (!sock) return; // waits until session connects (sessions calls pump on open)
  if (u.sentMonth >= config.monthlyLimit) return wakeIn(userId, Math.min(msUntilNextMonth(), 2_147_000_000));
  const wait = u.nextAt - Date.now();
  if (wait > 0) return wakeIn(userId, wait);
  busy.add(userId);
  sendHead(userId, u, sock)
    .catch((err) => logger.error({ err, userId }, 'queue send loop error'))
    .finally(() => {
      busy.delete(userId);
      pump(userId);
    });
}

async function sendHead(userId, u, sock) {
  const item = u.queue[0];
  try {
    await sock.sendPresenceUpdate('composing', item.jid).catch(() => {});
    await sleep(1500 + Math.floor(Math.random() * 2500));
    await sock.sendPresenceUpdate('paused', item.jid).catch(() => {});
    if (stopped) return;
    await sock.sendMessage(item.jid, { text: item.text });
  } catch (err) {
    item.attempts += 1;
    const transient = isConnectionError(err);
    logger.warn({ userId, ref: item.ref, attempts: item.attempts, transient, err: err?.message }, 'send failed');
    const maxAttempts = transient ? MAX_TRANSIENT_SEND_ATTEMPTS : MAX_SEND_ATTEMPTS;
    if (item.attempts >= maxAttempts) {
      u.queue.shift();
      pushRef(u, "failedRefs", item.ref);
      emitCallback({
        type: 'failed', userId, leadId: item.leadId, ref: item.ref,
        reason: String(err?.message || (transient ? 'connection_unavailable' : 'send_failed')).slice(0, 200), at: new Date().toISOString(),
      });
    }
    u.nextAt = Date.now() + RETRY_DELAY_MS;
    saveState();
    return;
  }

  u.queue.shift();
  pushRef(u, "sentRefs", item.ref);
  userState(userId).sentMonth += 1;
  u.nextAt = Date.now() + randomDelay();
  saveState();

  let lid = null;
  try {
    const l = await sock.signalRepository?.lidMapping?.getLIDForPN(item.jid);
    if (l) lid = l.split('@')[0].split(':')[0];
  } catch { /* optional */ }
  const jidDigits = item.jid.split('@')[0].split(':')[0];
  rememberContact(userId, { leadId: item.leadId, phones: [...new Set([item.phone, jidDigits])], lid });

  logger.info({ userId, ref: item.ref }, 'message sent');
  emitCallback({ type: 'sent', userId, leadId: item.leadId, ref: item.ref, text: item.text, at: new Date().toISOString() });
}

function pushRef(u, key, ref) {
  u[key] ??= [];
  u[key].push(ref);
  if (u[key].length > MAX_SENT_REFS) u[key].splice(0, u[key].length - MAX_SENT_REFS);
}

export function pumpAll() {
  for (const userId of Object.keys(state.users)) pump(userId);
}

export function stopQueue() {
  stopped = true;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
