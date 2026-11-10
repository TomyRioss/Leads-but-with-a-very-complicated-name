import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import nextEnv from "@next/env";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
nextEnv.loadEnvConfig(projectRoot);

const pocketBaseUrl = process.env.POCKETBASE_URL || "http://127.0.0.1:18098";
const pocketBase = new URL(pocketBaseUrl);
const localPort = Number(pocketBase.port || (pocketBase.protocol === "https:" ? 443 : 80));
const sshHost = process.env.LEADTA_SSH_HOST || "hermes-vps";
let tunnel;
let next;

async function pocketBaseIsReady() {
  try {
    const response = await fetch(new URL("/api/health", pocketBaseUrl), {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000),
  ]);
}

async function startBridge() {
  if (await pocketBaseIsReady()) {
    console.log(`PocketBase del VPS disponible en ${pocketBaseUrl}`);
    return;
  }

  tunnel = spawn("ssh", [
    "-N",
    "-T",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-L", `127.0.0.1:${localPort}:127.0.0.1:${localPort}`,
    sshHost,
  ], { cwd: projectRoot, stdio: "inherit", windowsHide: true, detached: true });

  let tunnelError;
  tunnel.once("error", (error) => { tunnelError = error; });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (tunnelError) throw new Error(`No se pudo iniciar el túnel SSH: ${tunnelError.message}`);
    if (tunnel.exitCode !== null) throw new Error(`SSH terminó con código ${tunnel.exitCode}. Revisá el alias ${sshHost} en ~/.ssh/config.`);
    if (await pocketBaseIsReady()) {
      console.log(`Túnel SSH conectado a PocketBase en ${pocketBaseUrl}`);
      return;
    }
    await delay(1000);
  }

  throw new Error(`PocketBase del VPS no respondió en ${pocketBaseUrl}. Revisá el VPS y el alias SSH ${sshHost}.`);
}

async function main() {
  try {
    await startBridge();

    const devPort = Number(process.env.PORT || 3000);
    try {
      const existingDev = await fetch(`http://127.0.0.1:${devPort}/api/status`, {
        signal: AbortSignal.timeout(1500),
      });
      if (existingDev.ok) {
        tunnel?.unref();
        tunnel = undefined;
        console.log(`Next.js ya está activo en el puerto ${devPort}. El túnel SSH queda abierto.`);
        return;
      }
    } catch {
      // No existing dev server is listening on the requested port.
    }

    next = spawn(process.execPath, [path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "dev"], {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
    });

    next.once("error", (error) => {
      console.error(`No se pudo iniciar Next.js: ${error.message}`);
      process.exitCode = 1;
    });
    const code = await new Promise((resolve) => next.once("exit", resolve));
    process.exitCode = typeof code === "number" ? code : 1;
  } finally {
    await stopProcess(tunnel);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stopProcess(next).then(() => stopProcess(tunnel));
  });
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await stopProcess(tunnel);
  process.exitCode = 1;
});
