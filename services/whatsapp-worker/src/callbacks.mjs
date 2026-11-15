// Persisted, retried callbacks to the Next.js app.
import { randomUUID } from 'node:crypto';
import { config, logger } from './config.mjs';
import { state, saveState } from './store.mjs';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
const MAX_PENDING = 5000;
const CONCURRENCY = 3;
const TIMEOUT_MS = 10_000;

let timer = null;
let running = false;
let stopped = false;

export function emitCallback(payload) {
  state.callbacks.push({ id: randomUUID(), payload, attempts: 0, nextAt: 0 });
  if (state.callbacks.length > MAX_PENDING) {
    const dropped = state.callbacks.splice(0, state.callbacks.length - MAX_PENDING);
    logger.warn({ dropped: dropped.length }, 'callback backlog full, dropping oldest');
  }
  saveState();
  kick();
}

async function post(payload) {
  const res = await fetch(config.callbackUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.secret}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.arrayBuffer().catch(() => {});
  if (!res.ok) throw new Error(`callback http ${res.status}`);
}

async function attempt(cb) {
  try {
    await post(cb.payload);
    const i = state.callbacks.indexOf(cb);
    if (i !== -1) state.callbacks.splice(i, 1);
    logger.debug({ type: cb.payload.type, userId: cb.payload.userId }, 'callback delivered');
  } catch (err) {
    cb.attempts += 1;
    if (cb.attempts >= MAX_ATTEMPTS) {
      const i = state.callbacks.indexOf(cb);
      if (i !== -1) state.callbacks.splice(i, 1);
      logger.error({ type: cb.payload.type, userId: cb.payload.userId, ref: cb.payload.ref, err: err.message }, 'callback dropped after max attempts');
    } else {
      cb.nextAt = Date.now() + BACKOFF_MS[cb.attempts - 1];
      logger.warn({ type: cb.payload.type, attempts: cb.attempts, err: err.message }, 'callback failed, will retry');
    }
  }
  saveState();
}

export function kick() {
  if (stopped || running) return;
  if (timer) { clearTimeout(timer); timer = null; }
  running = true;
  (async () => {
    for (;;) {
      if (stopped) break;
      const now = Date.now();
      const due = state.callbacks.filter((c) => c.nextAt <= now).slice(0, CONCURRENCY);
      if (!due.length) break;
      await Promise.all(due.map(attempt));
    }
  })()
    .catch((err) => logger.error({ err }, 'callback loop error'))
    .finally(() => {
      running = false;
      if (stopped || !state.callbacks.length) return;
      const next = Math.min(...state.callbacks.map((c) => c.nextAt));
      timer = setTimeout(kick, Math.max(1000, next - Date.now()));
      timer.unref?.();
    });
}

export function stopCallbacks() {
  stopped = true;
  if (timer) clearTimeout(timer);
}
