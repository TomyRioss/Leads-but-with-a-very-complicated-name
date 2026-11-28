import { expect, test, type Page } from "@playwright/test";

// Responsive de /leadtita (chat, panel de leads, pantalla de canales) e /integraciones (tarjetas y modales).
// Sesión y API simuladas en el navegador: ningún request toca PocketBase (e2e corre contra producción) y no se envían mensajes.
const user = { id: "resp-e2e", email: "responsive@example.com", name: "Responsive", credits: 120, role: "user", access: "ok", trialEndsAt: "" };
const LONG_WORD = "Supercalifragilisticoespialidosoextraordinariamentelargopalabrasinespacios";
const LONG_URL = "https://www.ejemplo-de-un-dominio-muy-largo.com.ar/catalogo/productos/categoria/subcategoria/item?utm_source=leadtita&utm_medium=chat&utm_campaign=responsive";
const leads = Array.from({ length: 20 }, (_, index) => ({ id: `l${index}`, name: `Panadería y Confitería Artesanal La Esquina del Barrio Norte ${LONG_WORD.slice(0, index)}`, category: "Cafetería de especialidad", city: "San Miguel de Tucumán", saved: index % 2 === 0, contactStatus: index % 4 === 0 ? "contacted" : null }));
const messages = [
  { id: 1, role: "user", content: `Buscame cafeterías con este link ${LONG_URL} y ${LONG_WORD}`, at: 1 },
  { id: 2, role: "assistant", content: `Mirá: ${LONG_URL}\n\n${LONG_WORD}${LONG_WORD}\n\n| Nombre | Dirección | Teléfono | Sitio web |\n|---|---|---|---|\n| Café Uno | Avenida Siempre Viva 742 | +54 11 5555 5555 | ${LONG_URL} |\n\n\`\`\`\nconst url = "${LONG_URL}${LONG_URL}";\n\`\`\``, at: 2 },
];

type Scenario = { wa?: "connected" | "disconnected" | "qr"; google?: "on" | "off"; history?: boolean; leadsOpen?: boolean };

async function mockApi(page: Page, scenario: Scenario) {
  await page.addInitScript(({ user, messages, scenario }) => {
    localStorage.setItem(`leadta:whatsNew:whatsapp-gmail:${user.email}`, "1");
    localStorage.setItem("leadta:leadtita-history-owner", user.id);
    localStorage.setItem("leadta:leadtita-leads-open", scenario.leadsOpen ? "1" : "0");
    if (scenario.history) localStorage.setItem(`leadta:leadtita-history:${user.id}`, JSON.stringify({ activeId: "conv1", conversations: [{ id: "conv1", title: "Responsive", updatedAt: Date.now(), messages }] }));
  }, { user, messages, scenario });
  await page.route(/\/api\//, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/auth/me") return json({ user });
    if (path === "/api/subscriptions") return json({ subscription: null });
    if (path === "/api/businesses") return json({ businesses: [{ id: "b1", name: "Negocio con un nombre extremadamente largo SRL", domain: "negocio.com" }], activeId: "b1" });
    if (path === "/api/integrations/whatsapp/status") return json({ configured: true, status: scenario.wa ?? "connected", qrDataUrl: scenario.wa === "qr" ? "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" : null, phone: "5491155555555", sentThisMonth: 12345, monthlyLimit: 99999, queued: 1234 });
    if (path === "/api/integrations/google/status") {
      const on = scenario.google !== "off";
      return json({ configured: true, connected: on, email: on ? "una.direccion.de.correo.muy.larga@empresa-ejemplo.com.ar" : "", files: on ? [{ id: "f1", name: `${LONG_WORD}.pdf`, mimeType: "application/pdf", url: LONG_URL }] : [], fullAccess: false, features: { drive: on, gmail: on, calendar: on } });
    }
    if (path === "/api/oauth/grants") return json({ items: [{ id: "g1", clientName: `Claude.ai ${LONG_WORD}`, scopes: ["read", "write", "credits", "send"], createdAt: "2026-11-01T10:00:00Z", lastUsedAt: "2026-11-20T10:00:00Z" }] });
    if (path === "/api/lead-suite/leads") return json({ items: leads });
    if (path === "/api/lead-suite/chat/message-models") return json({ items: [] });
    if (path === "/api/leadtita/conversations" && request.method() === "GET") return json({ conversations: scenario.history ? [{ id: "conv1", title: "Responsive", updatedAt: 1 }] : [] });
    if (path.startsWith("/api/leadtita/conversations")) return json({ ok: true });
    return json({}, 404);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  // The layout settles after the client-side session and status requests.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

const screens: { name: string; path: string; scenario: Scenario; ready: (page: Page) => Promise<void> }[] = [
  { name: "LEADTITA chat con mensajes largos", path: "/leadtita", scenario: { history: true }, ready: (page) => expect(page.locator(".ls-chat__md").first()).toBeVisible() },
  { name: "LEADTITA panel de leads abierto", path: "/leadtita", scenario: { history: true, leadsOpen: true }, ready: (page) => expect(page.locator(".leads-sidebar__item").first()).toBeVisible() },
  { name: "LEADTITA pantalla de canales", path: "/leadtita", scenario: { wa: "qr", google: "off" }, ready: (page) => expect(page.locator(".channel-setup .wa-qr")).toBeVisible() },
  { name: "INTEGRACIONES con todo conectado", path: "/integraciones", scenario: {}, ready: (page) => expect(page.locator(".apps-item").first()).toBeVisible() },
  { name: "INTEGRACIONES con QR de WhatsApp", path: "/integraciones", scenario: { wa: "qr", google: "off" }, ready: (page) => expect(page.locator(".wa-qr")).toBeVisible() },
];

for (const width of [360, 768, 1280]) {
  for (const screen of screens) {
    test(`${screen.name} sin scroll horizontal a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page, screen.scenario);
      await page.goto(screen.path);
      await screen.ready(page);
      await expectNoHorizontalOverflow(page);
    });
  }

  test(`MODAL DE INTEGRACIONES entra en pantalla a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, { wa: "qr", google: "off" });
    await page.goto("/integraciones");
    await expect(page.locator(".wa-qr")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("leadta:open-integrations")));
    const dialog = page.locator("dialog.integrations-dialog");
    await expect(dialog.locator(".wa-qr")).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect.poll(() => dialog.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
  });

  test(`MODAL DE FEEDBACK entra en pantalla a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, {});
    await page.goto("/integraciones");
    await expect(page.locator(".apps-item").first()).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("leadta:open-feedback")));
    const dialog = page.locator("dialog.feedback-dialog");
    await expect(dialog.locator("textarea")).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expectNoHorizontalOverflow(page);
  });
}

// Con barra superior (≤900px) el compositor quedaba debajo del pliegue: el chat no restaba su alto.
for (const [width, height] of [[390, 700], [768, 900]]) {
  test(`LEADTITA el campo del chat entra completo en pantalla (${width}x${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockApi(page, { history: true });
    await page.goto("/leadtita");
    const form = page.locator(".ls-chat__form").first();
    await expect(form).toBeVisible();
    await expect.poll(async () => (await form.boundingBox())!.y + (await form.boundingBox())!.height).toBeLessThanOrEqual(height + 1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  });
}

for (const width of [360, 390, 412]) {
  test(`LEADTITA la pestaña Lead Suite es solo icono en móvil (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, { history: true });
    await page.goto("/leadtita");
    const tab = page.getByRole("button", { name: "Lead Suite", exact: true });
    await expect(tab).toBeVisible();
    const box = (await tab.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(48);
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
  });
}

test("LEADTITA modelos con nombres largos no se salen del panel (360px)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await mockApi(page, { leadsOpen: true });
  await page.route("**/api/lead-suite/chat/message-models", (route) => route.fulfill({ json: { items: [{ id: "m1", name: `Modelo ${LONG_WORD}`, text: `${LONG_URL} ${LONG_WORD}`, isDefault: true }] } }));
  await page.goto("/leadtita");
  await page.getByRole("tab", { name: "Mensajes" }).click();
  const model = page.locator(".leads-sidebar__model").first();
  await expect(model).toBeVisible();
  const panel = (await page.locator(".leads-sidebar__models").boundingBox())!;
  const item = (await model.boundingBox())!;
  expect(item.x + item.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  await expect(page.locator(".leads-sidebar__default")).toBeInViewport({ ratio: 1 });
});

test("INTEGRACIONES el vencimiento del QR queda dentro de la tarjeta (360px)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await mockApi(page, { wa: "qr", google: "off" });
  await page.goto("/integraciones");
  const card = page.locator(".wa-card");
  await expect(card.locator(".wa-expiry")).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const expiry = (await card.locator(".wa-expiry").boundingBox())!;
  expect(expiry.x + expiry.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
});

test("CRÉDITOS EN NAVBAR MOBILE visibles arriba en mobile y ocultos en desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, {});
  await page.goto("/leadtita");
  const pill = page.locator(".side-nav-head a[href$='/pricing']");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("120");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(pill).toBeHidden();
});
