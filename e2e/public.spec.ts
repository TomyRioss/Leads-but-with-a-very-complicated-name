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
});

test.describe("CAMBIAR MONEDA DE PRECIOS", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "AR" } });
  test("alterna entre moneda local y USD", async ({ page }) => {
    await page.goto("/pricing");
    const usd = page.getByRole("button", { name: "USD", exact: true });
    await usd.click();
    await expect(usd).toHaveAttribute("aria-pressed", "true");
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
