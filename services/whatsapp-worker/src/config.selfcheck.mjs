// Selfcheck without network: node services/whatsapp-worker/src/config.selfcheck.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// pino is only installed inside the worker image; stub it so config.mjs loads here.
const HOOKS = `export async function resolve(s, c, next) {
  if (s === 'pino') return { url: 'data:text/javascript,export default () => ({ child: () => ({}) })', shortCircuit: true };
  return next(s, c);
}`;
const REGISTER = `import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(HOOKS)}));`;
const configUrl = new URL('./config.mjs', import.meta.url).href;

function load(callbackUrl) {
  return spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(REGISTER)}`, '--input-type=module', '-e',
      `const m = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(['https://ejemplo.com','http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000','http://ejemplo.com','ftp://localhost','nope'].map(m.callbackUrlError)));`],
    {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: { ...process.env, WHATSAPP_WORKER_SECRET: 'x'.repeat(32), WHATSAPP_CALLBACK_URL: callbackUrl },
    },
  );
}

// Pure validation.
const ok = load('https://ejemplo.com/api/whatsapp/callback');
assert.equal(ok.status, 0, ok.stderr);
const [httpsOk, localhost, ipv4, ipv6, remoteHttp, ftp, invalid] = JSON.parse(ok.stdout.trim());
assert.equal(httpsOk, null);
assert.equal(localhost, null);
assert.equal(ipv4, null);
assert.equal(ipv6, null);
assert.match(remoteHttp, /must use https/);
assert.match(ftp, /must use https/);
assert.match(invalid, /valid URL/);

// Loading config with a non-local http URL exits with a clear message.
const bad = load('http://ejemplo.com/api/whatsapp/callback');
assert.equal(bad.status, 1);
assert.match(bad.stderr, /\[config\] WHATSAPP_CALLBACK_URL must use https/);

console.log('config selfcheck OK');
