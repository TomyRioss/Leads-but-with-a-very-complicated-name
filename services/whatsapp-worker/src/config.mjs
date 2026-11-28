import path from 'node:path';
import pino from 'pino';

function int(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Callbacks carry the shared secret, so plain http is only allowed for local development.
export function callbackUrlError(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'WHATSAPP_CALLBACK_URL is required and must be a valid URL';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return null;
  return 'WHATSAPP_CALLBACK_URL must use https (http only for localhost, 127.0.0.1 or [::1])';
}

const secret = process.env.WHATSAPP_WORKER_SECRET ?? '';
const callbackUrl = process.env.WHATSAPP_CALLBACK_URL ?? '';
const errors = [];
if (secret.length < 32) errors.push('WHATSAPP_WORKER_SECRET is required (min 32 chars)');
const callbackError = callbackUrlError(callbackUrl);
if (callbackError) errors.push(callbackError);
if (errors.length) {
  for (const e of errors) console.error(`[config] ${e}`);
  process.exit(1);
}

const minDelay = int('MIN_DELAY_S', 45, 1, 3600);
const maxDelay = int('MAX_DELAY_S', 120, 1, 3600);
if (maxDelay < minDelay) {
  console.error('[config] MAX_DELAY_S must be >= MIN_DELAY_S');
  process.exit(1);
}

export const config = Object.freeze({
  secret,
  callbackUrl,
  port: int('PORT', 8787, 1, 65535),
  dataDir: path.resolve(process.env.DATA_DIR || '/data'),
  // Safety cap = highest plan (Growth, lib/plans.ts). The app enforces each user's plan cap before queueing.
  monthlyLimit: 500,
  minDelayMs: minDelay * 1000,
  maxDelayMs: maxDelay * 1000,
  timeZone: 'America/Argentina/Buenos_Aires',
  logLevel: process.env.LOG_LEVEL || 'warn',
});

export const logger = pino({ level: config.logLevel });

// Baileys logs JIDs at info level; keep it at warn unless explicitly debugging.
export const baileysLogger = logger.child(
  { module: 'baileys' },
  { level: ['debug', 'trace'].includes(config.logLevel) ? config.logLevel : 'warn' },
);
