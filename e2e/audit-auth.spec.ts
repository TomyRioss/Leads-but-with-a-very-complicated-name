import { expect, test } from "@playwright/test";

// Headless only. Never writes prod data: "example.invalid" emails have no account, so the
// verification route only runs a read-only lookup and sends nothing.

/** Fresh fake client IP per test so the in-memory per-IP limiter starts empty (also across retries). */
const fakeIp = () => `203.0.113.${Math.floor(Math.random() * 254) + 1}-${Date.now()}`;

test("REENVIAR VERIFICACIÓN: cuerpo inválido da error de validación", async ({ request }) => {
  const headers = { "x-forwarded-for": fakeIp() };
  const badEmail = await request.post("/api/auth/verification", { headers, data: { email: "no-es-un-email" } });
  expect(badEmail.status()).toBe(400);
  expect((await badEmail.json()).error).toBeTruthy();
  const badJson = await request.post("/api/auth/verification", { headers: { ...headers, "content-type": "application/json" }, data: "{" });
  expect(badJson.status()).toBe(400);
});

test("REENVIAR VERIFICACIÓN: límite por IP devuelve 429", async ({ request }) => {
  const headers = { "x-forwarded-for": fakeIp() };
  const send = () => request.post("/api/auth/verification", { headers, data: { email: `nadie-${Date.now()}@example.invalid` } });
  for (let i = 0; i < 5; i++) expect((await send()).status()).toBe(202);
  const limited = await send();
  expect(limited.status()).toBe(429);
  expect((await limited.json()).error).toBeTruthy();
});
