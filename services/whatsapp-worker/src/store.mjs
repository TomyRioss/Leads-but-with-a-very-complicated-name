// JSON persistence with atomic writes (temp file + rename).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, logger } from './config.mjs';

const QUEUE_FILE = path.join(config.dataDir, 'queue.json');
const SAVE_DEBOUNCE_MS = 250;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.error({ err, file }, 'failed to read json, using empty state');
    return fallback;
  }
}

function writeJsonSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

/** Debounced atomic writer for one file. */
function makeWriter(file, getData) {
  let timer = null;
  let writing = null;
  let dirty = false;
  const run = async () => {
    timer = null;
    if (writing) { dirty = true; return; }
    dirty = false;
    writing = writeJson(file, getData())
      .catch((err) => logger.error({ err, file }, 'failed to persist json'))
      .finally(() => {
        writing = null;
        if (dirty) schedule();
      });
  };
  const schedule = () => { if (!timer) timer = setTimeout(run, SAVE_DEBOUNCE_MS); };
  const flushSync = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    writeJsonSync(file, getData());
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } dirty = false; };
  return { schedule, flushSync, cancel, isPending: () => !!timer || dirty };
}

/**
 * state = {
 *   users: { [userId]: { queue: Item[], sentRefs: string[], day: string, sentToday: number, nextAt: number } },
 *   callbacks: { id, payload, attempts, nextAt }[]
 * }
 */
const loaded = readJson(QUEUE_FILE, {});
export const state = {
  users: loaded.users && typeof loaded.users === 'object' ? loaded.users : {},
  callbacks: Array.isArray(loaded.callbacks) ? loaded.callbacks : [],
};

const queueWriter = makeWriter(QUEUE_FILE, () => state);
export const saveState = () => queueWriter.schedule();

// ---- per-user contacts: DATA_DIR/users/<userId>/contacts.json ----
// { phones: { [digits]: leadId }, lids: { [lidUser]: leadId }, replied: { [leadId]: true } }
const MAX_CONTACTS = 5000;
const contactsCache = new Map(); // userId -> { data, writer }

function contactsFile(userId) {
  return path.join(config.dataDir, 'users', userId, 'contacts.json');
}

function contactsEntry(userId) {
  let entry = contactsCache.get(userId);
  if (!entry) {
    const raw = readJson(contactsFile(userId), {});
    const data = { phones: raw.phones || {}, lids: raw.lids || {}, replied: raw.replied || {} };
    entry = { data, writer: makeWriter(contactsFile(userId), () => data) };
    contactsCache.set(userId, entry);
  }
  return entry;
}

function trim(obj) {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length - MAX_CONTACTS; i++) delete obj[keys[i]];
}

export function rememberContact(userId, { leadId, phones, lid }) {
  const { data, writer } = contactsEntry(userId);
  for (const p of phones) {
    delete data.phones[p]; // re-insert to keep recency order
    data.phones[p] = leadId;
  }
  if (lid) { delete data.lids[lid]; data.lids[lid] = leadId; }
  trim(data.phones);
  trim(data.lids);
  writer.schedule();
}

export function findLead(userId, { phone, lid }) {
  const { data } = contactsEntry(userId);
  return (phone && data.phones[phone]) || (lid && data.lids[lid]) || null;
}

export function hasReplied(userId, leadId) {
  return !!contactsEntry(userId).data.replied[leadId];
}

export function markReplied(userId, leadId) {
  const { data, writer } = contactsEntry(userId);
  data.replied[leadId] = true;
  trim(data.replied);
  writer.schedule();
}

export async function dropContacts(userId) {
  const entry = contactsCache.get(userId);
  contactsCache.delete(userId);
  if (entry) entry.writer.cancel();
  await fsp.rm(path.join(config.dataDir, 'users', userId), { recursive: true, force: true });
}

export function flushAllSync() {
  queueWriter.flushSync();
  for (const { writer } of contactsCache.values()) {
    if (writer.isPending()) writer.flushSync();
  }
}
