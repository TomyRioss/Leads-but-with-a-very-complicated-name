import { expect, test } from "@playwright/test";

test("INICIAR SESIÓN", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Ingresa a Leadta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
  expect([400, 429]).toContain((await request.post("/api/auth/login", { data: {} })).status());
});

test("INICIAR SESIÓN CON GOOGLE", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Continuar con Google" })).toHaveAttribute("href", /\/api\/auth\/google/);
  const response = await request.get("/api/auth/google", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("accounts.google.com");
});

test("REGISTRAR USUARIO", async ({ page, request }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear cuenta" })).toBeVisible();
  expect([400, 429]).toContain((await request.post("/api/auth/register", { data: {} })).status());
});

test("VERIFICAR EMAIL", async ({ page }) => {
  await page.goto("/verificar");
  await expect(page.getByRole("heading", { name: "Enlace inválido o vencido" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reenviar enlace" })).toBeVisible();
});

test("RESTABLECER CONTRASEÑA", async ({ page, request }) => {
  await page.goto("/restablecer");
  await expect(page.getByRole("heading", { name: "Enlace inválido o vencido" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute("href", "/login");
  expect([400, 429]).toContain((await request.post("/api/auth/password-reset", { data: {} })).status());
});

test("CERRAR SESIÓN", async ({ request }) => {
  expect((await request.post("/api/auth/logout")).status()).toBe(200);
});

test("CONSULTAR SESIÓN", async ({ request }) => {
  expect((await request.get("/api/auth/me")).status()).toBe(200);
});
