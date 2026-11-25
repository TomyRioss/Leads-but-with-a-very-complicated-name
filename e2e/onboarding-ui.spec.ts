import { expect, test, type Page, type Route } from "@playwright/test";

// Onboarding de negocio (/onboarding) y selector de negocio del sidebar. Todo /api/* se simula en el navegador:
// ningún request llega al servidor (que habla con PocketBase de producción).

const user = { id: "onb-e2e", email: "onb@example.com", name: "Onb", credits: 50, role: "user", access: "trial", trialEndsAt: "2026-12-03T03:00:00.000Z" };

type Business = Record<string, unknown> & { id: string; name: string; onboardingStep: string };

const STEPS = ["company", "customers", "confirm", "plan", "channels", "capacity"];

function makeBusiness(id: string, name: string, domain: string, step = "company"): Business {
  return {
    id, name, domain, summary: `${name} vende un catálogo digital para negocios.`, location: "Bogotá", country: "Colombia",
    headline: "", valueProps: [], buyerSearches: [], competitors: [{ name: "Wix", domain: "wix.com" }], created: "2026-11-25T10:00:00.000Z",
    markets: [{ country: "Colombia", region: "" }], businessTypes: ["Cafés"], channels: [], onboardingStep: step,
  };
}

type Api = { patches: { step: string; data: Record<string, unknown> }[]; posts: unknown[]; active: unknown[]; unhandled: string[] };

async function mockApi(page: Page, options: { businesses?: Business[]; activeId?: string; pendingId?: string; proposals?: unknown[] } = {}): Promise<Api> {
  const api: Api = { patches: [], posts: [], active: [], unhandled: [] };
  // Sin el aviso de novedades del sidebar (tapa la página).
  await page.addInitScript((email) => localStorage.setItem(`leadta:whatsNew:whatsapp-gmail:${email}`, "1"), user.email);
  const store = new Map<string, Business>((options.businesses ?? []).map((b) => [b.id, b]));
  let activeId = options.activeId ?? "";
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === "/api/auth/me") return json(route, { user });
    if (pathname === "/api/subscriptions" && method === "GET") return json(route, { subscription: null });
    if (pathname === "/api/integrations/google/status") return json(route, { configured: true, connected: false, email: "", files: [], fullAccess: false, features: { drive: false, gmail: false, calendar: false } });
    if (pathname === "/api/integrations/whatsapp/status") return json(route, { configured: true, status: "disconnected", qrDataUrl: null, phone: null, sentThisMonth: 0, monthlyLimit: 100, queued: 0 });
    if (pathname === "/api/lead-suite/chat/usage") return json(route, { gmail: { used: 3, limit: 50 }, whatsapp: { used: 12, limit: 100 }, ai: { used: 4, limit: 20 } });
    if (pathname === "/api/businesses" && method === "GET") return json(route, { businesses: [...store.values()], activeId });
    if (pathname === "/api/businesses/active" && method === "PATCH") {
      const body = request.postDataJSON() as { businessId: string };
      api.active.push(body);
      activeId = body.businessId;
      return json(route, { activeId });
    }
    if (pathname === "/api/onboarding/pending") return json(route, { businessId: options.pendingId ?? "" });
    if (pathname === "/api/proposals" && method === "GET") return json(route, { proposals: options.proposals ?? [] });
    if (pathname === "/api/onboarding" && method === "POST") {
      api.posts.push(request.postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 600));
      const created = makeBusiness("biz-new", "Loruppa", "loruppa.com");
      store.set(created.id, created);
      if (!activeId) activeId = created.id;
      return json(route, { business: created });
    }
    const match = pathname.match(/^\/api\/onboarding\/([^/]+)$/);
    if (match) {
      const current = store.get(decodeURIComponent(match[1]));
      if (!current) return json(route, { error: "not_found" }, 404);
      if (method === "GET") return json(route, { business: current });
      if (method === "PATCH") {
        const body = request.postDataJSON() as { step: string; data: Record<string, unknown> };
        api.patches.push(body);
        const next = STEPS[STEPS.indexOf(body.step) + 1] ?? "done";
        const updated = { ...current, ...body.data, onboardingStep: next };
        store.set(updated.id, updated);
        return json(route, { business: updated });
      }
    }
    api.unhandled.push(`${method} ${pathname}`);
    return json(route, { error: "not_found" }, 404);
  });
  return api;
}

const continueButton = (page: Page) => page.getByRole("button", { name: "Continuar" });

test("ONBOARDING NEGOCIO: paso 0 investiga y los pasos 1-6 guardan lo esperado", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/onboarding?new=1");

  await expect(page.getByRole("heading", { name: "Contanos de tu negocio" })).toBeVisible();
  await page.getByLabel("Tu sitio web").fill("loruppa.com");
  await page.getByRole("button", { name: "Analizar mi negocio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Estamos investigando tu negocio" })).toBeVisible();
  expect(api.posts).toEqual([{ mode: "web", url: "https://loruppa.com" }]);

  // 1: empresa
  await expect(page.getByRole("heading", { name: "¿Es tu empresa?" })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\?business=biz-new$/);
  await expect(page.getByText("Paso 1 de 6")).toBeVisible();
  await page.getByLabel("Nombre").fill("Loruppa Pro");
  await page.getByLabel("Qué hacés").fill("Catálogos digitales para cafés.");
  await page.getByRole("button", { name: "Quitar Wix" }).click();
  await page.getByRole("textbox", { name: "Agregar competidor" }).fill("shopify.com");
  await page.getByRole("textbox", { name: "Agregar competidor" }).press("Enter");
  await continueButton(page).click();

  // 2: clientes
  await expect(page.getByRole("heading", { name: "¿Quiénes son tus clientes?" })).toBeVisible();
  expect(api.patches[0]).toEqual({ step: "company", data: { name: "Loruppa Pro", summary: "Catálogos digitales para cafés.", competitors: [{ name: "Shopify", domain: "shopify.com" }] } });
  await page.getByRole("textbox", { name: "País" }).fill("Argentina");
  await page.getByLabel("Región o ciudad (opcional)").fill("Córdoba");
  await page.getByRole("button", { name: "Agregar mercado" }).click();
  await page.getByRole("textbox", { name: "Agregar rubro" }).fill("Panaderías");
  await page.getByRole("textbox", { name: "Agregar rubro" }).press("Enter");
  await continueButton(page).click();

  // 3: confirmar (bloquea hasta las dos marcas)
  await expect(page.getByRole("heading", { name: "¿Te entendimos bien?" })).toBeVisible();
  expect(api.patches[1]).toEqual({ step: "customers", data: { markets: [{ country: "Colombia", region: "" }, { country: "Argentina", region: "Córdoba" }], businessTypes: ["Cafés", "Panaderías"] } });
  await expect(page.getByRole("heading", { name: "¿Esto vende Loruppa Pro?" })).toBeVisible();
  // aria-disabled: se ve deshabilitado pero el clic avisa qué falta (force salta el chequeo de Playwright).
  await expect(continueButton(page)).toHaveAttribute("aria-disabled", "true");
  await continueButton(page).click({ force: true });
  await expect(page.getByRole("alert").filter({ hasText: "Confirmá las dos tarjetas para continuar." })).toBeVisible();
  expect(api.patches).toHaveLength(2);
  await page.getByRole("checkbox", { name: "Sí, esto vendo" }).click();
  await continueButton(page).click({ force: true });
  expect(api.patches).toHaveLength(2);
  await page.getByRole("checkbox", { name: "Sí, estos son mis mercados" }).click();
  await continueButton(page).click();

  // 4: plan
  await expect(page.getByRole("heading", { name: "Tu plan" })).toBeVisible();
  expect(api.patches[2]).toEqual({ step: "confirm", data: { offerConfirmed: true, marketsConfirmed: true } });
  await expect(page.getByText("Prueba gratis de 7 días")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver planes" })).toHaveAttribute("href", /\/pricing$/);
  await continueButton(page).click();

  // 5: canales
  await expect(page.getByRole("heading", { name: "¿Por dónde contactamos a tus clientes?" })).toBeVisible();
  expect(api.patches[3]).toEqual({ step: "plan", data: {} });
  await continueButton(page).click({ force: true });
  await expect(page.getByRole("alert").filter({ hasText: "Elegí al menos un canal." })).toBeVisible();
  await page.getByRole("button", { name: /Gmail/ }).first().click();
  await expect(page.getByRole("link", { name: "Conectar Gmail" })).toHaveAttribute("href", /returnTo=%2Fonboarding/);
  await page.getByRole("button", { name: /WhatsApp/ }).first().click();
  await continueButton(page).click();

  // 6: capacidad (solo lectura) → Empezar
  await expect(page.getByRole("heading", { name: "Tu capacidad de envío" })).toBeVisible();
  expect(api.patches[4]).toEqual({ step: "channels", data: { channels: ["gmail", "whatsapp"] } });
  await expect(page.getByText("12 de 100 usados")).toBeVisible();
  await expect(page.locator("main input, main textarea")).toHaveCount(0);
  await page.getByRole("button", { name: "Empezar" }).click();
  await expect(page).toHaveURL(/\/leadtita$/);
  expect(api.patches[5]).toEqual({ step: "capacity", data: {} });
});

test("ONBOARDING NEGOCIO: ?business= retoma en su paso y Atrás vuelve", async ({ page }) => {
  await mockApi(page, { businesses: [makeBusiness("biz-1", "Loruppa", "loruppa.com", "plan")], activeId: "biz-1" });
  await page.goto("/onboarding?business=biz-1");
  await expect(page.getByRole("heading", { name: "Tu plan" })).toBeVisible();
  await expect(page.getByText("Paso 4 de 6")).toBeVisible();
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByRole("heading", { name: "¿Te entendimos bien?" })).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).last().click();
  await expect(page.getByRole("heading", { name: "¿Quiénes son tus clientes?" })).toBeVisible();
});

test("ONBOARDING NEGOCIO: error de la API se muestra legible", async ({ page }) => {
  const api = await mockApi(page, { businesses: [makeBusiness("biz-1", "Loruppa", "loruppa.com", "company")], activeId: "biz-1" });
  await page.route((url) => url.pathname === "/api/onboarding/biz-1", (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 429, json: { error: "rate_limited" } })
    : route.fallback());
  await page.goto("/onboarding?business=biz-1");
  await continueButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Hiciste muchos intentos seguidos" })).toBeVisible();
  expect(api.patches).toHaveLength(0);
});

test("SELECTOR DE NEGOCIO: lista negocios y cambiar llama PATCH active", async ({ page }) => {
  const api = await mockApi(page, {
    businesses: [makeBusiness("biz-1", "Loruppa", "loruppa.com", "done"), makeBusiness("biz-2", "Cafetal", "", "customers")],
    activeId: "biz-1",
  });
  await page.goto("/negocios");
  const trigger = page.getByRole("button", { name: /Negocio activo: Loruppa/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Tus negocios" });
  await expect(menu.getByRole("menuitem", { name: /Cafetal/ }).first()).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Completar el onboarding de Cafetal" })).toHaveAttribute("href", /\/onboarding\?business=biz-2$/);
  await expect(menu.getByRole("menuitem", { name: "Completar el onboarding de Loruppa" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Nuevo negocio" })).toHaveAttribute("href", /\/onboarding\?new=1$/);
  await menu.getByRole("menuitem", { name: "Cafetal", exact: true }).click();
  await expect.poll(() => api.active).toEqual([{ businessId: "biz-2" }]);
  await expect(page.getByRole("button", { name: /Negocio activo: Cafetal/ })).toBeVisible();
});

test("SELECTOR DE NEGOCIO: sin negocios muestra Crear negocio", async ({ page }) => {
  await mockApi(page, { businesses: [] });
  await page.goto("/negocios");
  await expect(page.getByRole("link", { name: "Crear negocio" })).toHaveAttribute("href", /\/onboarding\?new=1$/);
});

test("DESPUÉS DE /explorar: al entrar con un negocio a medio onboarding va a /onboarding", async ({ page }) => {
  await mockApi(page, { businesses: [makeBusiness("biz-1", "Loruppa", "loruppa.com", "confirm")], activeId: "biz-1", pendingId: "biz-1" });
  await page.goto("/login");
  await expect(page).toHaveURL(/\/onboarding\?business=biz-1$/);
  await expect(page.getByRole("heading", { name: "¿Te entendimos bien?" })).toBeVisible();
});

test("SIN ONBOARDING PENDIENTE: al entrar va a /leadtita", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/leadtita$/);
});

test("ONBOARDING NEGOCIO: con propuestas, Empezar lleva a Mis propuestas del negocio", async ({ page }) => {
  const api = await mockApi(page, { businesses: [makeBusiness("biz-1", "Loruppa", "loruppa.com", "capacity")], activeId: "biz-1", proposals: [{ id: "p1" }] });
  await page.goto("/onboarding?business=biz-1");
  await page.getByRole("button", { name: "Empezar" }).click();
  await expect(page).toHaveURL(/\/propuestas\?business=biz-1$/);
  expect(api.patches.at(-1)).toEqual({ step: "capacity", data: {} });
});
