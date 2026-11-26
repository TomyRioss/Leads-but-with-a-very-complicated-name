import { expect, test, type Page } from "@playwright/test";

// Responsive de las páginas con sesión (/negocios, /campanas, /propuestas, /historial) y del sidebar.
// Sesión y API simuladas en el navegador: ningún request toca PocketBase (e2e corre contra producción).
// Datos largos a propósito: nombres, dominios y mails sin cortes son los que rompen el layout.
const LONG = "Distribuidora Integral de Insumos Gastronómicos y Ferreteros del Litoral Sociedad Anónima";
const user = { id: "resp-e2e", email: "una.direccion.de.correo.muy.larga@empresa-con-dominio-largo.com.ar", name: "R", credits: 123456, role: "user", access: "ok", trialEndsAt: "" };

const businesses = Array.from({ length: 3 }, (_, index) => ({
  id: `b${index + 1}`, name: index ? `Negocio ${index + 1} con nombre largo` : LONG, domain: "distribuidora-integral-insumos-gastronomicos-litoral.com.ar",
  summary: "Catálogo digital para comercios que venden por WhatsApp, con stock sincronizado y pedidos automáticos para cada sucursal.",
  location: "Ciudad Autónoma de Buenos Aires, Gran Buenos Aires, Argentina", country: "Argentina", headline: "Catálogo digital sin código para distribuidoras",
  valueProps: ["Se arma en minutos con importación desde Excel", "Supercalifragilisticoexpialidosoconpalabrasinterminablesqueno"],
  buyerSearches: ["software de pedidos mayoristas por whatsapp", "sistemadegestiónsinespaciosmuylargoparaprobarcortes"],
  competitors: Array.from({ length: 6 }, (_, k) => ({ name: `Competidor ${k + 1} con nombre largo SRL`, domain: `competidor-numero-${k + 1}-dominio-largo.com.ar` })),
  created: "2026-11-20T10:00:00.000Z", onboardingStep: index === 2 ? "plan" : "done",
}));
const campaigns = Array.from({ length: 5 }, (_, index) => ({
  id: `c${index + 1}`, businessId: "b1", name: index ? `Campaña ${index + 1} ferreterías` : "Cafeterías de especialidad y panaderías artesanales del conurbano bonaerense",
  icon: "utensils", fit: 90 - index * 8, pitch: "Menú **digital** con pedidos por WhatsApp", pain: "Cartas de papel desactualizadas", criteria: ["Tiene Instagram activo"],
  examples: ["Cafés de especialidad"], keywords: ["cafetería de especialidad", "panadería artesanal", "rotisería con delivery"], batchIds: ["bt1"], leadCount: 1234, created: "2026-11-20T10:00:00.000Z",
}));
const leads = Array.from({ length: 12 }, (_, index) => ({
  id: `l${index + 1}`, batch: "bt1", name: index ? `Café ${index + 1} de especialidad` : LONG, maps_url: "", address: "Avenida Presidente Figueroa Alcorta 3415, Palermo Chico, CABA",
  review_count: "1234", average_rating: "4.6", phone: "+54 9 11 5555-0000", email: `contacto.comercial${index}@cafe-de-especialidad-largo.com.ar`, website: "https://www.cafe-de-especialidad-con-dominio-muy-largo.com.ar",
  social_profiles: "", category: "Cafetería", source_reviews: [], source_context: {}, pain_points: "", enrichment: "", pain_points_detail: null, enrichment_detail: null,
  created_at: "2026-11-21T10:00:00.000Z", created: "", whatsapp: "5491155550000", whatsapp_status: "verified",
}));
const proposals = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`, businessId: "b1", campaignId: "c1", leadId: `l${index + 1}`, leadName: index ? `Café ${index + 1}` : LONG, channel: index % 2 ? "gmail" : "whatsapp",
  to: index % 2 ? `contacto.comercial.ventas${index}@cafe-de-especialidad-con-dominio-largo.com.ar` : "5491155550000",
  subject: index % 2 ? "Menú digital con pedidos por WhatsApp para su local de Palermo y sucursales" : "", body: "Hola equipo, ¿cómo están? Les escribo por el menú digital.",
  status: ["draft", "sent", "failed"][index % 3], error: "", sentAt: index % 3 === 1 ? "2026-11-21T12:00:00.000Z" : "", created: "",
}));
const batches = Array.from({ length: 6 }, (_, index) => ({
  id: `bt${index + 1}`, keywords: ["cafetería de especialidad", "panadería artesanal"], country: "Argentina", province: "Ciudad Autónoma de Buenos Aires", district: "Palermo Chico",
  requested_count: 100, result_count: 87, status: "completed", created_at: `2026-11-${String(20 - index).padStart(2, "0")}T10:00:00.000Z`, created: "", kind: "business",
}));

async function mockApi(page: Page, empty = false) {
  await page.addInitScript((email) => { try { localStorage.setItem(`leadta:whatsNew:whatsapp-gmail:${email}`, "1"); } catch { /* storage bloqueado */ } }, user.email);
  // Primero el comodín: las rutas registradas después tienen prioridad.
  await page.route(/\/api\//, (route) => route.fulfill({ status: 404, json: { error: "not_found" } }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user } }));
  await page.route("**/api/subscriptions", (route) => route.fulfill({ json: { subscription: null } }));
  await page.route(/\/api\/businesses(\?|$)/, (route) => route.fulfill({ json: { businesses: empty ? [] : businesses, activeId: empty ? "" : "b1" } }));
  await page.route(/\/api\/sales-campaigns(\?|$)/, (route) => route.fulfill({ json: { campaigns: empty ? [] : campaigns } }));
  await page.route(/\/api\/sales-campaigns\/[^/]+\/leads/, (route) => route.fulfill({ json: { leads } }));
  await page.route(/\/api\/proposals(\?|$)/, (route) => route.fulfill({ json: { proposals: empty ? [] : proposals } }));
  await page.route(/\/api\/history/, (route) => route.fulfill({ json: { leads: empty ? [] : leads, page: 1, totalItems: empty ? 0 : 1200, totalPages: empty ? 1 : 12 } }));
  await page.route(/\/api\/batches/, (route) => route.fulfill({ json: { batches: empty ? [] : batches, totalPages: 1 } }));
  await page.route(/\/api\/leads\?/, (route) => route.fulfill({ json: { leads } }));
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`).toBeLessThanOrEqual(innerWidth + 1);
}

const PAGES = [
  { name: "MIS NEGOCIOS", path: "/negocios", ready: (page: Page) => page.getByRole("article", { name: LONG }) },
  { name: "MIS CAMPAÑAS", path: "/campanas", ready: (page: Page) => page.locator("#campaign-leads-title") },
  { name: "MIS PROPUESTAS", path: "/propuestas", ready: (page: Page) => page.getByLabel("Mensaje") },
  { name: "HISTORIAL", path: "/historial", ready: (page: Page) => page.locator(".history-sheet") },
];

for (const width of [360, 768, 1280]) {
  test.describe(`responsive ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { name, path, ready } of PAGES) {
      test(`${name}: sin scroll horizontal con datos largos`, async ({ page }) => {
        await mockApi(page);
        await page.goto(path);
        await expect(ready(page)).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });

      test(`${name}: sin scroll horizontal en estado vacío`, async ({ page }) => {
        await mockApi(page, true);
        await page.goto(path);
        await expect(page.getByRole("main").getByRole("heading", { level: 2 }).first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }

    test("SIDEBAR: menú y selector de negocio entran en pantalla", async ({ page }) => {
      await mockApi(page);
      await page.goto("/negocios");
      await expect(page.getByRole("article", { name: LONG })).toBeVisible();
      const toggle = page.locator(".side-nav-toggle");
      if (await toggle.isVisible()) await toggle.click();
      await page.locator(".side-nav-business > button").click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      await expectNoHorizontalOverflow(page);
    });
  });
}
