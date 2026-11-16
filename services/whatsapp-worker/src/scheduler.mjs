// "Programados" clock: every minute asks the Next.js app to send the scheduled messages that are due.
// One call at a time (the next tick waits for the previous one), so the app's dispatcher never runs twice at once.
import { config, logger } from './config.mjs';

const INTERVAL_MS = 60_000;
const TIMEOUT_MS = 290_000; // the app route allows 300 s
const dispatchUrl = new URL('/api/scheduled/dispatch', config.callbackUrl).toString();

let timer = null;
let stopped = false;

async function tick() {
  timer = null;
  if (stopped) return;
  try {
    const res = await fetch(dispatchUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) logger.warn({ status: res.status }, 'scheduled dispatch failed');
    else if (body.sent || body.failed) logger.info(body, 'scheduled dispatch');
  } catch (err) {
    logger.warn({ err: err.message }, 'scheduled dispatch error');
  } finally {
    if (!stopped) {
      timer = setTimeout(tick, INTERVAL_MS);
      timer.unref?.();
    }
  }
}

export function startScheduler() {
  if (timer || stopped) return;
  timer = setTimeout(tick, INTERVAL_MS);
  timer.unref?.();
}

export function stopScheduler() {
  stopped = true;
  if (timer) clearTimeout(timer);
}
