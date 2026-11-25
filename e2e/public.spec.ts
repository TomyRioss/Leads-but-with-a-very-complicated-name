import { expect, test } from "@playwright/test";

test("VER LANDING", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("IR A PLANES DESDE LANDING", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("IR A BLOG DESDE LANDING", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Blog" }).click();
  await expect(page).toHaveURL(/\/blog$/);
});

test("IR A LOGIN DESDE LANDING", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("IR A REGISTRO DESDE LANDING", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
});

test("CAMBIAR IDIOMA", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: /idioma|language/i }).click();
  await page.getByRole("option", { name: /English/ }).click();
  await expect(page).toHaveURL(/\/en$/);
});

test("LINKS LEGALES DEL FOOTER", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
  await expect(footer.getByRole("link", { name: "Política de privacidad" })).toHaveAttribute("href", "/privacidad");
});

test("VER PLANES Y PRECIOS", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Elige tu plan mensual" })).toBeVisible();
  await expect(page.getByText("Uso aún más extendido del agente IA", { exact: true })).toBeVisible();
});

test.describe("CAMBIAR MONEDA DE PRECIOS", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "AR" } });
  // Sin toggle: ARS principal y USD secundario siempre visibles, para cualquier país.
  test("muestra ARS y USD a la vez", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("$25.000 ARS", { exact: true })).toBeVisible();
    await expect(page.getByText("aprox. $15 USD", { exact: true })).toBeVisible();
  });
});

test("SUSCRIBIRSE A PLAN", async ({ page, request }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("button", { name: "Suscribirme" }).first()).toBeVisible();
  expect((await request.post("/api/subscriptions", { data: {} })).status()).toBe(401);
});

test("LEER BLOG", async ({ page }) => {
  await page.goto("/blog");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("LEER ARTÍCULO DEL BLOG", async ({ page }) => {
  // Sin PocketBase no hay artículos: un slug inexistente debe responder 404 sin romper.
  const response = await page.goto("/blog/articulo-inexistente-e2e");
  expect(response?.status()).toBe(404);
});

test("VER TÉRMINOS", async ({ page }) => {
  expect((await page.goto("/terminos"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("VER PRIVACIDAD", async ({ page }) => {
  expect((await page.goto("/privacidad"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("PÁGINA 404", async ({ page }) => {
  expect((await page.goto("/no-existe-e2e"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Este lead se nos escapó" })).toBeVisible();
});

// Explorar: no se corre IA ni Apify (el entorno e2e usa producción). Se prueba la UI y el rechazo sin Turnstile.
test("DESCRIBIR PRODUCTO EN LANDING", async ({ page }) => {
  await page.goto("/");
  // Web es el modo por defecto; Texto sigue disponible.
  await page.getByPlaceholder("Pega tu web, ej. loruppa.com").fill("loruppa.com");
  await expect(page.getByText("Investigar con IA")).toBeVisible();
  await page.getByRole("button", { name: "Texto", exact: true }).click();
  await expect(page.getByPlaceholder("Cuéntanos sobre tu producto...")).toBeVisible();
});

test("VENDO SERVICIOS", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Vendo servicios" }).click();
  const dialog = page.getByRole("dialog", { name: "Cuéntanos sobre tu negocio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Generar mis campañas/ })).toBeDisabled();
});

test("EXPLORAR SIN CORRIDA", async ({ page }) => {
  await page.goto("/explorar");
  await expect(page.getByText("Todavía no empezaste una exploración")).toBeVisible();
});

test("API EXPLORAR RECHAZA SIN TURNSTILE", async ({ request }) => {
  const res = await request.post("/api/explore/start", { data: { input: { mode: "text", description: "Una app de turnos" }, turnstileToken: "" } });
  expect([400, 403]).toContain(res.status());
});

test("CORREGIR DATOS DEL PASO 1", async ({ request }) => {
  // Sin cookie de corrida no se escribe nada (el entorno e2e usa producción).
  const res = await request.patch("/api/explore", { data: { summary: "Prueba", location: "Argentina" } });
  expect(res.status()).toBe(404);
});

test("NAVEGAR DESDE UN MODAL NO BLOQUEA LA PÁGINA", async ({ page }) => {
  // Next deja la página anterior oculta pero montada: el modal abierto no debe seguir bloqueando los clics.
  await page.goto("/");
  await page.mouse.wheel(0, 400);
  const popup = page.locator("dialog[open]");
  await expect(popup).toBeVisible({ timeout: 15_000 });
  await popup.locator('a[href*="terminos"]').click();
  await expect(page).toHaveURL(/terminos/);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("link").first().click({ trial: true });
});
