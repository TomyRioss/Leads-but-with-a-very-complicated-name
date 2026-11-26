import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

// Responsive de /explorar (5 pasos, vacío, diálogo de registro, edición) y /onboarding (todos los pasos, planes).
// Todo /api/* se simula en el navegador: ningún request llega al servidor (PocketBase de producción).
// RESP_SHOT_DIR=<carpeta> recorre 6 anchos, guarda capturas y un report.jsonl con desbordes y áreas táctiles chicas.

const SHOT_DIR = process.env.RESP_SHOT_DIR ?? "";
const WIDTHS = SHOT_DIR ? [360, 390, 768, 1024, 1280, 1440] : [360, 768, 1280];
const HEIGHT = 900;

// ─── Datos largos para estresar el layout ─────────────────────────────────

const LONG = "Distribuidora Integral de Insumos Gastronómicos del Litoral";
const DOMAIN = "distribuidoraintegralinsumosgastronomicoslitoral.com.ar";

const product = {
  name: LONG,
  domain: DOMAIN,
  summary: "Vende al por mayor insumos descartables, vajilla, equipamiento de cocina industrial y productos de limpieza a restaurantes, cafeterías, hoteles y servicios de catering de toda la región, con entrega en 24 horas y cuenta corriente para clientes frecuentes.",
  location: "Rosario, Santa Fe, Argentina y Montevideo, Uruguay",
  country: "Argentina",
};

const competitors = {
  headline: "Abastecimiento integral para cocinas profesionales con entrega en el día y cuenta corriente",
  valueProps: [
    "Catálogo de más de 4.000 productos para gastronomía profesional con precios mayoristas actualizados todas las semanas",
    "Entrega en 24 horas en Rosario, Gran Rosario y localidades cercanas sin pedido mínimo",
    "Cuenta corriente y ejecutivo de cuentas dedicado para restaurantes y hoteles",
  ],
  buyerSearches: ["proveedor mayorista de descartables para restaurantes en Rosario", "vajilla y equipamiento de cocina industrial con envío en el día", "insumos de limpieza profesional para hoteles"],
  competitors: [
    { name: "Mayorista Gastronómico Central del Litoral", domain: "mayoristagastronomicocentraldellitoral.com.ar" },
    { name: "Descartables Rosario", domain: "descartablesrosario.com.ar" },
    { name: "Equipamientos Hoteleros del Paraná", domain: "equipamientoshoteleros.com" },
    { name: "Makro", domain: "makro.com.ar" },
    { name: "Vajilla Pro", domain: "vajillapro.com" },
    { name: "Insumos Gastronómicos Santa Fe", domain: "insumosgastronomicossantafe.com.ar" },
  ],
};

const campaigns = [
  { id: "restaurantes", name: "Restaurantes y parrillas de alta rotación", icon: "utensils", fit: 92 },
  { id: "hoteles", name: "Hoteles boutique y apart hoteles", icon: "building", fit: 81 },
  { id: "catering", name: "Servicios de catering para eventos corporativos", icon: "briefcase", fit: 74 },
  { id: "cafeterias", name: "Cafeterías de especialidad", icon: "store", fit: 63 },
].map((item) => ({
  ...item,
  pitch: "Les ofrecés **reposición en 24 horas** de descartables y vajilla con **cuenta corriente**, para que nunca frenen el servicio por falta de insumos.",
  pain: "Se quedan sin insumos en medio del servicio y pierden tiempo comprando en varios proveedores minoristas.",
  criteria: ["Más de 40 cubiertos por turno", "Abren todos los días de la semana", "Compran insumos al menos dos veces por mes"],
  examples: ["Parrillas", "Bodegones", "Restaurantes de pastas", "Cervecerías artesanales"],
  keywords: ["restaurante"],
}));

const leads = Array.from({ length: 12 }, (_, index) => ({
  id: `lead-${index}`,
  name: index % 2 ? `Parrilla y Restaurante El Gran Fogón de la Costanera ${index}` : `Bodegón Los Primos ${index}`,
  category: "Restaurante",
  description: "Restaurante familiar con parrilla a la leña, menú ejecutivo al mediodía, salón para 120 cubiertos y servicio de delivery propio en toda la zona centro.",
  address: "Av. Wheelwright 1520, S2000 Rosario, Santa Fe, Argentina",
  country_code: "AR",
  city: "Rosario",
  district: "Centro",
  phone: "+54 341 555-0101",
  whatsapp: index % 3 ? "+54 9 341 555-0101" : "",
  email: index % 2 ? `reservas.administracion.${index}@elgranfogondelacostanera.com.ar` : "",
  website: index % 2 ? "https://www.elgranfogondelacostanera.com.ar/reservas" : "",
  maps_url: "https://example.com/lead",
  average_rating: "4.6",
  review_count: String(1200 + index * 340),
}));

const proposals = leads.map((lead, index) => ({
  leadId: lead.id,
  channel: index % 2 ? "gmail" : "whatsapp",
  to: index % 2 ? lead.email : lead.whatsapp || lead.phone,
  subject: index % 2 ? "Reposición de descartables y vajilla en 24 horas con cuenta corriente para su restaurante" : "",
  body: `Hola, equipo de ${lead.name}.\n\nSoy de ${LONG}. Trabajamos con restaurantes de Rosario que necesitan reponer descartables, vajilla y productos de limpieza sin frenar el servicio.\n\nEntregamos en 24 horas y ofrecemos cuenta corriente. ¿Les interesa recibir el catálogo con precios mayoristas?\n\nSaludos.`,
}));

const fullRun = { token: "", input: { mode: "web", url: `https://${DOMAIN}` }, campaignId: "restaurantes", product, competitors, campaigns, leads, proposals };

const user = { id: "resp-e2e", email: "resp@example.com", name: "Resp", credits: 50, role: "user", access: "trial", trialEndsAt: "2026-12-03T03:00:00.000Z" };

const business = {
  id: "biz-resp", name: LONG, domain: DOMAIN, summary: product.summary, location: product.location, country: "Argentina",
  headline: "", valueProps: [], buyerSearches: [], competitors: competitors.competitors, created: "2026-11-25T10:00:00.000Z",
  markets: [
    { country: "Argentina", region: "Rosario y Gran Rosario, provincia de Santa Fe" },
    { country: "Uruguay", region: "" },
    { country: "Argentina", region: "Ciudad Autónoma de Buenos Aires" },
  ],
  businessTypes: ["Restaurantes y parrillas de alta rotación", "Hoteles boutique", "Catering para eventos corporativos", "Cafeterías"],
  channels: ["whatsapp", "gmail"], onboardingStep: "company",
};

// ─── Mocks ─────────────────────────────────────────────────────────────────

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
const hang = () => new Promise<void>(() => {});

async function mockExplore(page: Page, run: unknown, status = 200) {
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/explore") return status === 200 ? json(route, run) : json(route, { error: "x" }, status);
    if (pathname.startsWith("/api/explore/")) return hang(); // paso en curso: nunca termina
    if (pathname === "/api/auth/me") return json(route, { user: null }, 401);
    return json(route, {});
  });
}

async function mockOnboarding(page: Page, step: string, options: { loadStatus?: number } = {}) {
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/auth/me") return json(route, { user });
    if (pathname === "/api/subscriptions") return json(route, { subscription: null });
    if (pathname === "/api/market") return json(route, { market: "AR" });
    if (pathname === "/api/status") return json(route, { environment: "dev" });
    if (pathname === "/api/integrations/google/status") return json(route, { configured: true, connected: false, email: "", features: { gmail: false } });
    if (pathname.startsWith("/api/integrations/whatsapp")) return json(route, { configured: true, status: "disconnected", qrDataUrl: null, phone: null, sentThisMonth: 0, monthlyLimit: 100, queued: 0 });
    if (pathname === "/api/lead-suite/chat/usage") return json(route, { gmail: { used: 3, limit: 50 }, whatsapp: { used: 12, limit: 100 }, ai: { used: 4, limit: 20 } });
    if (pathname === "/api/onboarding" && request.method() === "POST") return hang(); // investigando
    if (pathname === `/api/onboarding/${business.id}`) {
      return options.loadStatus ? json(route, { error: "" }, options.loadStatus) : json(route, { business: { ...business, onboardingStep: step } });
    }
    if (pathname === "/api/businesses") return json(route, { businesses: [business], activeId: business.id });
    return json(route, {});
  });
}

// ─── Estados ───────────────────────────────────────────────────────────────

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation").getByRole("button", { name });

type State = { name: string; open: (page: Page, width: number) => Promise<void> };

const exploreAt = (name: string, step: RegExp | null, title: string): State => ({
  name,
  open: async (page) => {
    await mockExplore(page, fullRun);
    await page.goto("/explorar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Propuestas listas para enviar");
    if (step) await stepButton(page, step).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  },
});

const EXPLORE_STATES: State[] = [
  {
    name: "explore-empty",
    open: async (page) => {
      await mockExplore(page, null, 404);
      await page.goto("/explorar");
      await expect(page.getByRole("heading", { name: "Todavía no empezaste una exploración" })).toBeVisible();
    },
  },
  exploreAt("explore-research", /Investigar tu empresa/, "Esto encontramos sobre tu empresa"),
  exploreAt("explore-competitors", /Explorar competidores/, "Tu producto y tus competidores"),
  exploreAt("explore-campaigns", /Definir campañas/, "Campañas recomendadas"),
  exploreAt("explore-leads", /Buscar clientes potenciales/, "Tus clientes potenciales"),
  {
    name: "explore-leads-loading",
    open: async (page) => {
      await mockExplore(page, { ...fullRun, leads: null, proposals: null });
      await page.goto("/explorar");
      await expect(page.getByRole("status").filter({ hasText: "Buscando negocios" })).toBeVisible();
    },
  },
  exploreAt("explore-proposals", null, "Propuestas listas para enviar"),
  {
    name: "explore-signup",
    open: async (page) => {
      await exploreAt("", null, "Propuestas listas para enviar").open(page, 0);
      await page.getByRole("button", { name: "Empezar gratis" }).click();
      await expect(page.getByRole("dialog", { name: "Crea tu cuenta para enviar" })).toBeVisible();
    },
  },
  {
    name: "explore-edit",
    open: async (page, width) => {
      await exploreAt("", /Investigar tu empresa/, "Esto encontramos sobre tu empresa").open(page, 0);
      // La edición vive en la barra lateral de escritorio (lg); en móvil no se muestra.
      if (width >= 1024) {
        await page.getByRole("button", { name: "¿Los datos están mal?" }).click();
        await expect(page.getByRole("button", { name: "Guardar" })).toBeVisible();
      }
    },
  },
];

const onboardingAt = (name: string, step: string, heading: string, after?: (page: Page) => Promise<void>): State => ({
  name,
  open: async (page) => {
    await mockOnboarding(page, step);
    await page.goto(`/onboarding?business=${business.id}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await after?.(page);
  },
});

const ONBOARDING_STATES: State[] = [
  {
    name: "onboarding-start",
    open: async (page) => {
      await mockOnboarding(page, "company");
      await page.goto("/onboarding?new=1");
      await expect(page.getByRole("heading", { name: "Contanos de tu negocio" })).toBeVisible();
    },
  },
  {
    name: "onboarding-researching",
    open: async (page) => {
      await mockOnboarding(page, "company");
      await page.goto("/onboarding?new=1");
      await page.getByLabel("Tu sitio web").fill(DOMAIN);
      await page.getByRole("button", { name: "Analizar mi negocio" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Estamos investigando tu negocio" })).toBeVisible();
    },
  },
  onboardingAt("onboarding-company", "company", "¿Es tu empresa?"),
  onboardingAt("onboarding-customers", "customers", "¿Quiénes son tus clientes?"),
  onboardingAt("onboarding-confirm", "confirm", "¿Te entendimos bien?", async (page) => {
    await page.getByRole("button", { name: "Continuar" }).click({ force: true });
  }),
  onboardingAt("onboarding-plan", "plan", "Tu plan", async (page) => {
    await expect(page.getByText("Elegí un plan ahora")).toBeVisible();
    await expect(page.locator("main .animate-spin")).toHaveCount(0);
  }),
  onboardingAt("onboarding-channels", "channels", "¿Por dónde contactamos a tus clientes?"),
  onboardingAt("onboarding-capacity", "capacity", "Tu capacidad de envío", async (page) => {
    await expect(page.getByText("12 / 100")).toBeVisible();
  }),
  {
    name: "onboarding-error",
    open: async (page) => {
      await mockOnboarding(page, "company", { loadStatus: 500 });
      await page.goto(`/onboarding?business=${business.id}`);
      await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    },
  },
];

// ─── Mediciones ────────────────────────────────────────────────────────────

/** Elementos que pasan el borde derecho del viewport sin un ancestro que los recorte o scrollee. */
function measure() {
  const vw = window.innerWidth;
  const clips = (el: Element) => {
    const style = getComputedStyle(el);
    return style.overflowX !== "visible";
  };
  const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 4).join(".")} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const offenders: string[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || rect.right <= vw + 1) continue;
    let parent = el.parentElement;
    let clipped = false;
    while (parent && parent !== document.body) {
      if (clips(parent)) { clipped = true; break; }
      parent = parent.parentElement;
    }
    const parentRect = el.parentElement?.getBoundingClientRect();
    if (!clipped && !(parentRect && parentRect.right > vw + 1)) offenders.push(`${describe(el)} right=${Math.round(rect.right)}`);
  }
  const small: string[] = [];
  for (const el of document.querySelectorAll("button, a[href], input, textarea, select, [role=checkbox], [role=radio]")) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
    if (el.closest(".sr-only")) continue;
    if (rect.height < 40 || rect.width < 40) small.push(`${describe(el)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
  }
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw, offenders, small };
}

async function noHorizontalOverflow(page: Page, label: string) {
  const result = await page.evaluate(measure);
  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/${label}.png`, fullPage: true });
    appendFileSync(`${SHOT_DIR}/report.jsonl`, `${JSON.stringify({ label, ...result })}\n`);
  }
  expect(result.scrollWidth, `${label}: ${result.offenders.join(" | ")}`).toBeLessThanOrEqual(result.innerWidth + 1);
}

for (const state of [...EXPLORE_STATES, ...ONBOARDING_STATES]) {
  for (const width of WIDTHS) {
    test(`RESPONSIVE ${state.name} @${width}: sin desborde horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await state.open(page, width);
      await noHorizontalOverflow(page, `${state.name}-${width}`);
    });
  }
}

test("RESPONSIVE explorar paso 5 @1280: la oferta de prueba no se aplasta ni se superpone", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: HEIGHT });
  await EXPLORE_STATES.find((state) => state.name === "explore-proposals")!.open(page, 1280);
  const title = page.getByText(/Probá Leadta \d+ días gratis/);
  const button = page.getByRole("button", { name: "Empezar gratis" });
  const card = title.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  const [titleBox, buttonBox, cardBox] = await Promise.all([title.boundingBox(), button.boundingBox(), card.boundingBox()]);
  expect(titleBox && buttonBox && cardBox).toBeTruthy();
  const overlap = titleBox!.x < buttonBox!.x + buttonBox!.width && buttonBox!.x < titleBox!.x + titleBox!.width
    && titleBox!.y < buttonBox!.y + buttonBox!.height && buttonBox!.y < titleBox!.y + titleBox!.height;
  expect(overlap).toBe(false);
  expect(cardBox!.width).toBeGreaterThan(400);
  // El título entra en una línea (no "una palabra por renglón").
  expect(titleBox!.height).toBeLessThan(40);
});
