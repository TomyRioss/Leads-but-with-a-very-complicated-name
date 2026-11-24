import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/warmup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // ponytail: 1 reintento local absorbe la compilación en frío de `next dev` bajo carga paralela.
  retries: process.env.CI ? 2 : 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    locale: "es-AR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Mismo bridge que `npm run dev`: túnel SSH hermes-vps → PocketBase REAL (producción) en 127.0.0.1:18098,
    // con Next en el puerto 3100. Los tests que escriban datos los escriben en prod.
    command: "node scripts/dev-with-pocketbase-bridge.mjs",
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PORT: String(PORT), NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "" },
  },
});
