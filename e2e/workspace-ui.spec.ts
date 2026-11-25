import { expect, test, type Page, type Route } from "@playwright/test";

// Mis negocios / Mis campañas / Mis propuestas (contrato lib/workspace/types.ts).
// Sesión y API simuladas en el navegador: ningún request toca PocketBase (e2e corre contra producción).
const user = { id: "ws-e2e", email: "ws@example.com", name: "WS", credits: 120, role: "user", access: "ok", trialEndsAt: "" };

const business = {
  id: "b1", name: "Loruppa", domain: "loruppa.com", summary: "Catálogo digital para comercios.", location: "Colombia", country: "Colombia",
  headline: "Catálogo digital sin código", valueProps: ["Se arma en minutos", "Pedidos por WhatsApp", "Sin comisiones"],
  buyerSearches: ["catálogo online", "menú digital"], competitors: [{ name: "Wix", domain: "wix.com" }, { name: "Tiendanube", domain: "tiendanube.com" }],
  created: "2026-11-20T10:00:00.000Z",
};
const campaigns = [
  { id: "c1", businessId: "b1", name: "Cafeterías", icon: "utensils", fit: 92, pitch: "Menú **digital** con pedidos", pain: "Cartas de papel desactualizadas", criteria: ["Tiene Instagram", "Atiende en mesa"], examples: ["Cafés de especialidad"], keywords: ["cafetería"], batchIds: ["bt1"], leadCount: 2, created: "2026-11-20T10:00:00.000Z" },
  { id: "c2", businessId: "b1", name: "Ferreterías", icon: "wrench", fit: 71, pitch: "Catálogo con **stock**", pain: "Consultas repetidas por WhatsApp", criteria: ["Vende al público"], examples: [], keywords: ["ferretería"], batchIds: [], leadCount: 0, created: "2026-11-20T10:00:00.000Z" },
];
const lead = (id: string, name: string) => ({ id, batch: "bt1", name, maps_url: "", address: "Calle 1, Bogotá", review_count: "10", average_rating: "4.6", phone: "+57 300 000 0000", email: `${id}@example.com`, website: "", social_profiles: "", category: "Cafetería", source_reviews: [], source_context: {}, pain_points: "", enrichment: "", pain_points_detail: null, enrichment_detail: null, created_at: "", created: "", whatsapp: "573000000000" });
const proposals = [
  { id: "p1", businessId: "b1", campaignId: "c1", leadId: "l1", leadName: "Café Uno", channel: "whatsapp", to: "573000000000", subject: "", body: "Hola, ¿cómo están?", status: "draft", error: "", sentAt: "", created: "" },
  { id: "p2", businessId: "b1", campaignId: "c1", leadId: "l2", leadName: "Café Dos", channel: "gmail", to: "dos@example.com", subject: "Menú digital", body: "Hola equipo", status: "sent", error: "", sentAt: "2026-11-21T12:00:00.000Z", created: "" },
];

type Overrides = Partial<Record<"businesses" | "campaigns" | "proposals", unknown[]>> & { send?: { status: number; json: unknown }; search?: { status: number; json: unknown } };

async function mockWorkspace(page: Page, overrides: Overrides = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript((email) => localStorage.setItem(`leadta:whatsNew:whatsapp-gmail:${email}`, "1"), user.email);
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user } }));
  await page.route("**/api/subscriptions", (route) => route.fulfill({ json: { subscription: null } }));
  await page.route(/\/api\/(businesses|sales-campaigns|proposals)(\/|\?|$)/, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({ method, path: url.pathname + url.search, body: request.postDataJSON?.() ?? null });
    const path = url.pathname;
    if (path === "/api/businesses") return route.fulfill({ json: { businesses: overrides.businesses ?? [business] } });
    if (path === "/api/sales-campaigns") {
      const list = (overrides.campaigns ?? campaigns) as typeof campaigns;
      const filter = url.searchParams.get("business");
      return route.fulfill({ json: { campaigns: filter ? list.filter((item) => item.businessId === filter) : list } });
    }
    const leadsMatch = /^\/api\/sales-campaigns\/([^/]+)\/leads$/.exec(path);
    if (leadsMatch) return route.fulfill({ json: { leads: leadsMatch[1] === "c1" ? [lead("l1", "Café Uno"), lead("l2", "Café Dos")] : [] } });
    if (/^\/api\/sales-campaigns\/[^/]+\/search$/.test(path)) {
      const reply = overrides.search ?? { status: 200, json: { batchId: "bt2", created: 3, credits: 90 } };
      return route.fulfill({ status: reply.status, json: reply.json });
    }
    if (path === "/api/proposals") return route.fulfill({ json: { proposals: overrides.proposals ?? proposals } });
    const patchMatch = /^\/api\/proposals\/([^/]+)$/.exec(path);
    if (patchMatch && method === "PATCH") {
      const current = proposals.find((item) => item.id === patchMatch[1])!;
      return route.fulfill({ json: { proposal: { ...current, ...(request.postDataJSON() as object) } } });
    }
    const sendMatch = /^\/api\/proposals\/([^/]+)\/send$/.exec(path);
    if (sendMatch) {
      const reply = overrides.send ?? { status: 200, json: { proposal: { ...proposals.find((item) => item.id === sendMatch[1])!, status: "sent", sentAt: "2026-11-25T12:00:00.000Z" } } };
      return route.fulfill({ status: reply.status, json: reply.json });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return calls;
}

test("VER MIS NEGOCIOS: ficha y competidores desde el sidebar", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/negocios");
  const card = page.getByRole("article", { name: "Loruppa" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Catálogo digital para comercios.")).toBeVisible();
  await expect(card.getByText("Tiendanube", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mis negocios" })).toHaveAttribute("aria-current", "page");
});

test("VER MIS NEGOCIOS: estado vacío lleva a explorar", async ({ page }) => {
  await mockWorkspace(page, { businesses: [] });
  await page.goto("/negocios");
  await expect(page.getByRole("heading", { name: "Todavía no tenés negocios" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Explorar un negocio" })).toHaveAttribute("href", "/");
});

test("VER CAMPAÑAS DE UN NEGOCIO: el botón filtra por negocio", async ({ page }) => {
  const calls = await mockWorkspace(page);
  await page.goto("/negocios");
  await page.getByRole("link", { name: "Ver campañas" }).click();
  await expect(page).toHaveURL(/\/campanas\?business=b1$/);
  await expect(page.getByText("Negocio: Loruppa")).toBeVisible();
  expect(calls.some((call) => call.path === "/api/sales-campaigns?business=b1")).toBe(true);
});

test("VER MIS CAMPAÑAS: tarjetas con afinidad y cantidad de leads", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/campanas");
  await expect(page.getByRole("button", { name: /Cafeterías/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Cafeterías/ }).getByText("2 leads")).toBeVisible();
  await expect(page.getByRole("button", { name: /Ferreterías/ }).getByText("Sin leads")).toBeVisible();
});

test("VER LEADS DE UNA CAMPAÑA: elegir una campaña carga sus leads", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/campanas");
  await expect(page.getByRole("heading", { name: "Leads de Cafeterías" })).toBeVisible();
  await expect(page.getByText("Café Uno").first()).toBeVisible();
  await page.getByRole("button", { name: /Ferreterías/ }).click();
  await expect(page.getByRole("heading", { name: "Leads de Ferreterías" })).toBeVisible();
  await expect(page.getByText("No encontramos clientes para esta campaña.")).toBeVisible();
});

test("BUSCAR MÁS LEADS DE UNA CAMPAÑA: éxito y error de créditos", async ({ page }) => {
  const calls = await mockWorkspace(page);
  await page.goto("/campanas");
  await page.getByRole("button", { name: "Buscar más leads" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregamos 3 leads nuevos." })).toBeVisible();
  expect(calls.some((call) => call.method === "POST" && call.path === "/api/sales-campaigns/c1/search")).toBe(true);
  await expect(page.getByRole("button", { name: /Cafeterías/ }).getByText("5 leads")).toBeVisible();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockWorkspace(page, { search: { status: 402, json: { error: "insufficient_credits" } } });
  await page.reload();
  await page.getByRole("button", { name: "Buscar más leads" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No tenés créditos suficientes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Comprar créditos" })).toHaveAttribute("href", "/pricing");
});

test("VER MIS PROPUESTAS: desde la campaña, con estados", async ({ page }) => {
  const calls = await mockWorkspace(page);
  await page.goto("/campanas");
  await page.getByRole("link", { name: "Ver propuestas" }).click();
  await expect(page).toHaveURL(/\/propuestas\?campaign=c1$/);
  await expect(page.getByText("Campaña: Cafeterías")).toBeVisible();
  const list = page.getByRole("list", { name: "Propuestas" });
  await expect(list.getByText("Borrador")).toBeVisible();
  await expect(list.getByText("Enviada")).toBeVisible();
  expect(calls.some((call) => call.path === "/api/proposals?campaign=c1")).toBe(true);
});

test("EDITAR PROPUESTA: guardar manda PATCH y las enviadas son de solo lectura", async ({ page }) => {
  const calls = await mockWorkspace(page);
  await page.goto("/propuestas");
  const save = page.getByRole("button", { name: "Guardar", exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel("Mensaje").fill("Hola, les escribo por el menú digital.");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();
  expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ body: "Hola, les escribo por el menú digital." });

  await page.getByRole("button", { name: /Café Dos/ }).click();
  await expect(page.getByLabel("Mensaje")).toHaveJSProperty("readOnly", true);
  await expect(page.getByText("Las propuestas enviadas no se pueden editar.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
});

test("ENVIAR PROPUESTA: éxito marca Enviada", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/propuestas");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Propuesta enviada." })).toBeVisible();
  await expect(page.getByRole("list", { name: "Propuestas" }).getByText("Enviada")).toHaveCount(2);
});

test("ENVIAR PROPUESTA: sin WhatsApp conectado lleva a Integraciones", async ({ page }) => {
  await mockWorkspace(page, { send: { status: 409, json: { error: "needs_whatsapp" } } });
  await page.goto("/propuestas");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Conectá tu WhatsApp para enviar esta propuesta." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir a Integraciones" })).toHaveAttribute("href", "/integraciones");
});

test("MIS NEGOCIOS en inglés", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/en/negocios");
  await expect(page.getByRole("heading", { name: "My businesses" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View campaigns" })).toBeVisible();
});

for (const path of ["/buscar", "/personas"]) {
  test(`${path} ya no existe (404)`, async ({ request }) => {
    expect((await request.get(path)).status()).toBe(404);
  });
}
