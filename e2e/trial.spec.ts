import { expect, test, type Page } from "@playwright/test";

// Prueba de 7 días: sesión simulada en el navegador (sin cuentas reales ni escrituras en PocketBase).
const expiredUser = { id: "trial-e2e", email: "trial@example.com", name: "Trial", credits: 0, role: "user", access: "expired", trialEndsAt: "2026-12-03T03:00:00.000Z" };

async function mockSession(page: Page, user: unknown) {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user } }));
}

test("PRUEBA VENCIDA: página privada lleva a planes con aviso", async ({ page }) => {
  await mockSession(page, expiredUser);
  await page.goto("/lead-suite");
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("status").filter({ hasText: "Tu prueba de 7 días terminó" })).toBeVisible();
});

test("PRUEBA ACTIVA: planes sin aviso de vencimiento", async ({ page }) => {
  await mockSession(page, { ...expiredUser, access: "trial" });
  await page.goto("/pricing");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByText("Tu prueba de 7 días terminó")).toHaveCount(0);
});

test("EXPLORAR PROPUESTAS: aviso de 7 días en la vista y en el popup de envío", async ({ page }) => {
  await page.addInitScript(() => {
    const lead = { id: "l1", name: "Café Uno", category: "Café", address: "Calle 1, Bogotá, Colombia", phone: "", whatsapp: "573000000000", email: "", website: "", maps_url: "", average_rating: "4.5", review_count: "10" };
    const run = {
      token: "", input: { mode: "web", url: "https://loruppa.com" }, campaignId: "cafes",
      product: { name: "Loruppa", domain: "loruppa.com", summary: "Catálogo digital.", location: "Colombia", country: "Colombia" },
      competitors: { headline: "Catálogo digital", valueProps: [], buyerSearches: [], competitors: [{ name: "Wix", domain: "wix.com" }] },
      campaigns: [{ id: "cafes", name: "Cafés", icon: "store", fit: 90, pitch: "", pain: "", criteria: [], examples: [], keywords: ["café"] }],
      leads: [lead],
      proposals: [{ leadId: "l1", channel: "whatsapp", to: "573000000000", subject: "", body: "Hola, cómo están?" }],
    };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.origin).pathname === "/api/explore") return new Response(JSON.stringify(run), { headers: { "Content-Type": "application/json" } });
      return original(input, init);
    };
  });
  await page.goto("/explorar");
  const trial = "7 Días de Prueba con $10 USD de uso GRATIS.";
  const view = page.getByRole("region", { name: "Propuestas listas para enviar" });
  await expect(view.getByText("Probá Leadta 7 días gratis")).toBeVisible();
  await expect(view.getByRole("button", { name: "Empezar gratis" })).toBeVisible();
  await page.getByRole("button", { name: "Crear cuenta Gratis" }).click();
  await expect(page.getByRole("dialog").getByText(trial)).toBeVisible();
});
