import { expect, test } from "@playwright/test";

// Sin sesión (PocketBase inaccesible en e2e): cada funcionalidad privada debe bloquear el acceso.
const privateApis: [string, "GET" | "POST", string][] = [
  ["CHAT LEADTITA", "POST", "/api/lead-suite/chat"],
  ["CONVERSACIONES DE LEADTITA", "GET", "/api/leadtita/conversations"],
  ["LEAD SUITE DASHBOARD", "GET", "/api/lead-suite/dashboard"],
  ["CONTACTOS DE LEAD SUITE", "GET", "/api/lead-suite/contacts"],
  ["PROGRAMAR MENSAJES", "GET", "/api/scheduled"],
  ["VER HISTORIAL DE LOTES", "GET", "/api/history"],
  ["PANEL OWNER", "GET", "/api/owner/me"],
  ["ENVIAR FEEDBACK", "POST", "/api/feedback"],
  ["SERVIDOR MCP", "POST", "/api/mcp"],
];

for (const [feature, method, path] of privateApis) {
  test(`${feature} exige sesión`, async ({ request }) => {
    const response = await request.fetch(path, { method, data: method === "POST" ? {} : undefined });
    expect(response.status()).toBe(401);
  });
}

test("EXPORTAR LEADS CSV/XLSX exige sesión", async ({ request }) => {
  expect((await request.get("/api/export/csv")).status()).toBe(401);
  expect((await request.get("/api/export/xlsx")).status()).toBe(401);
});

test("REEMPLAZAR LEADS SIN WHATSAPP exige sesión", async ({ request }) => {
  const response = await request.post("/api/lead-suite/leads/whatsapp", { data: { batchId: "abcdefghijklmno", action: "replace" } });
  expect(response.status()).toBe(401);
});

test("CONECTAR INTEGRACIONES (GOOGLE / WHATSAPP) exige sesión", async ({ page, request }) => {
  expect((await request.get("/api/integrations/google/status")).status()).toBe(401);
  expect((await request.get("/api/integrations/whatsapp/status")).status()).toBe(401);
  await page.goto("/integraciones");
  await expect(page).not.toHaveURL(/\/integraciones/);
});

test("CHAT LEADTITA redirige sin sesión", async ({ page }) => {
  await page.goto("/leadtita");
  await expect(page).not.toHaveURL(/\/leadtita/);
});

test("AUTORIZAR CLIENTE OAUTH (MCP) pide login", async ({ page }) => {
  await page.goto("/oauth/authorize");
  await expect(page).toHaveURL(/\/login\?next=%2Foauth%2Fauthorize/);
});

test("SERVIDOR MCP publica metadata OAuth", async ({ request }) => {
  const response = await request.get("/.well-known/oauth-authorization-server");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toHaveProperty("authorization_endpoint");
});

test("WEBHOOK DE PAGOS MERCADO PAGO rechaza eventos sin firma válida", async ({ request }) => {
  const data = { type: "subscription_authorized_payment", data: { id: "123" } };
  const unsigned = await request.post("/api/mercadopago/webhook?data.id=123&type=subscription_authorized_payment", { data });
  const forged = await request.post("/api/mercadopago/webhook?data.id=123&type=subscription_authorized_payment", {
    data,
    headers: { "x-signature": `ts=${Date.now()},v1=${"0".repeat(64)}`, "x-request-id": "e2e" },
  });
  // 503 only when MP_ACCESS_TOKEN / MP_WEBHOOK_SECRET are not set in this environment.
  expect([401, 503]).toContain(unsigned.status());
  expect([401, 503]).toContain(forged.status());
});

test("CONFIRMAR SUSCRIPCIÓN (back_url de Mercado Pago) sin sesión redirige a login", async ({ request }) => {
  const response = await request.get("/api/subscriptions/confirm?preapproval_id=abc123", { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/login$/);
});

test("SUSCRIBIRSE A PLAN sin sesión responde 401", async ({ request }) => {
  const response = await request.post("/api/subscriptions", { data: { planId: "starter" } });
  expect(response.status()).toBe(401);
});

test("ESTADO DEL SERVICIO", async ({ request }) => {
  expect((await request.get("/api/status")).ok()).toBe(true);
});
