import { expect, test, type Page } from "@playwright/test";

// Responsive: /lead-suite y /owner sin desborde horizontal en 360, 768 y 1280 px.
// Sesión y API simuladas en el navegador (page.route): ningún request toca PocketBase (e2e corre contra producción).
const WIDTHS = [360, 768, 1280] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
}

// ───────── /lead-suite ─────────
const LONG_NAME = "Panadería y Confitería Artesanal Los Hermanos Rodríguez Fernández de San Isidro";
const LONG_TEXT = "Hola, les escribo porque vi que tienen una carta muy linda y quería contarles sobre una herramienta para recibir pedidos por WhatsApp sin comisiones ni intermediarios. ¿Les interesa una demo de 10 minutos esta semana?";
const lsUser = { id: "ls-e2e", email: "una.direccion.de.correo.muy.larga@empresa-ejemplo.com.ar", name: "LS", credits: 120, role: "user", access: "ok", trialEndsAt: "" };
const LEAD_STATUSES = ["not_contacted", "contacted", "replied", "meeting", "won", "lost"] as const;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const lsLead = (i: number) => ({ id: `l${i}`, name: i % 3 === 0 ? `${LONG_NAME} ${i}` : `Café ${i}`, category: i % 2 ? "Panadería y pastelería artesanal" : "Cafetería", city: i % 2 ? "San Isidro, Provincia de Buenos Aires" : "CABA", phone: "+54 11 5555 0000", website: "", batchId: "b1", contactStatus: LEAD_STATUSES[i % LEAD_STATUSES.length], lastContactedAt: daysAgo(i) });
const lsContact = (i: number) => ({ id: `c${i}`, leadId: `l${i}`, leadName: `${LONG_NAME} ${i}`, channel: ["whatsapp", "email", "phone", "instagram"][i % 4], message: LONG_TEXT, status: ["contacted", "replied", "meeting", "won", "lost"][i % 5], notes: "Pidió que lo llamemos después de las 18 h; el dueño decide los martes.", contactedAt: daysAgo(i), created: daysAgo(i) });
const lsMetrics = (empty: boolean) => ({ range: { from: daysAgo(30), to: daysAgo(0) }, totalContactedLeads: empty ? 0 : 21, contactsInRange: empty ? 0 : 34, leadsContactedInRange: empty ? 0 : 18, byChannel: { whatsapp: 10, email: 8, phone: 3, instagram: 2, linkedin: 1, in_person: 0, other: 0 }, byStatus: { not_contacted: 4, contacted: 10, replied: 5, meeting: 3, won: 2, lost: 1 }, byWeek: [], byCategory: [], byHour: Array(24).fill(0), replyRate: 0.38, pendingFollowUps: empty ? [] : [1, 2, 3, 4, 5].map(lsLead) });
const heatGrid = Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => (day * hour) % 7));
const lsInsights = (empty: boolean) => ({
  refreshesLeft: 2,
  analysis: { observations: ["WhatsApp tuvo una tasa de respuesta del 52% contra 18% del email en los últimos 30 días; conviene priorizarlo.", "Las respuestas llegan más rápido entre las 9 y las 11."], source: "model", insufficient: empty, generatedAt: daysAgo(0) },
  metrics: {
    range: { from: daysAgo(30), to: daysAgo(0) }, timeZone: "America/Argentina/Buenos_Aires", totalContacts: empty ? 0 : 34,
    kpis: { contacts: { value: 34, previous: 20 }, replyRate: { value: 0.38, previous: 0.3 }, avgReplyHours: { value: 5.4, previous: 7 }, bestChannel: { channel: "whatsapp", replyRate: 0.52, leads: 12 }, bestHour: { hour: 10, replyRate: 0.6, leads: 8 }, overdue: 7 },
    trendUnit: "day", trend: Array.from({ length: 30 }, (_, i) => ({ date: daysAgo(30 - i).slice(0, 10), sent: i % 5, replies: i % 3 })),
    funnel: [{ stage: "contacted", count: 21, rateFromPrev: null }, { stage: "replied", count: 8, rateFromPrev: 0.38 }, { stage: "meeting", count: 3, rateFromPrev: 0.37 }, { stage: "won", count: 2, rateFromPrev: 0.66 }],
    channels: ["whatsapp", "email", "phone", "instagram"].map((channel, i) => ({ channel, sent: 20 - i * 2, leads: 10 - i, replied: 5 - i, replyRate: 0.5 - i * 0.05 })),
    heat: { sent: heatGrid, replies: heatGrid },
    categories: [{ name: "Panadería y pastelería artesanal con cafetería", leads: 12, replied: 6, replyRate: 0.5 }],
    cities: [{ name: "San Isidro, Provincia de Buenos Aires", leads: 9, replied: 4, replyRate: 0.44 }],
    overdue: [1, 2, 3].map((i) => ({ id: `l${i}`, name: `${LONG_NAME} ${i}`, category: "Panadería y pastelería artesanal", lastContactedAt: daysAgo(9), days: 9 + i })),
  },
});
const lsScheduled = { freeLeft: 3, items: [0, 1, 2].map((i) => ({ id: `s${i}`, channel: i % 2 ? "email" : "whatsapp", leadId: `l${i}`, leadName: `${LONG_NAME} ${i}`, recipient: i % 2 ? "contacto.comercial.sucursal.norte@panaderia-los-hermanos.com.ar" : "+54 9 11 5555 0000", subject: "Propuesta para recibir pedidos por WhatsApp", body: LONG_TEXT, sendAt: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(), status: ["scheduled", "queued", "failed"][i], error: i === 2 ? "send_failed" : "", sentAt: "" })) };
// Respuesta simulada de Leadtita: envío en lote para revisar (BatchReview + SchedulePicker) y borradores con fuentes.
const lsChatStream = () => `event: complete\ndata: ${JSON.stringify({
  reply: `Preparé **7 mensajes** de WhatsApp para los leads que respondieron pero no agendaron. Revisalos antes de enviar.\n\n| Lead | Canal | Estado |\n| --- | --- | --- |\n| ${LONG_NAME} | WhatsApp | Respondió |\n| Café 2 | Email | Sin respuesta |`,
  actions: [
    { type: "pending_change", token: "tok1", change: { kind: "send_whatsapp_batch", leadName: LONG_NAME, data: { channel: "whatsapp", message: LONG_TEXT }, extra: { count: 7 }, review: Array.from({ length: 7 }, (_, i) => ({ leadId: `l${i}`, leadName: `${LONG_NAME} ${i}`, to: "+54 9 11 5555 0000", subject: "", text: LONG_TEXT })) } },
    { type: "message_suggestions", leadId: "l1", leadName: LONG_NAME, sendChannels: { whatsapp: true, email: true }, hasRecipient: { whatsapp: true, email: true }, painSources: [{ tag: "Demoras en la atención por WhatsApp", detail: "Tardan en responder pedidos.", sources: [{ label: "Comentario de cliente", quote: "Escribí tres veces para encargar una torta y nunca me contestaron a tiempo.", url: "https://example.com/a" }] }], messages: [{ channel: "whatsapp", subject: "", text: LONG_TEXT }, { channel: "email", subject: "Pedidos por WhatsApp sin comisiones para su panadería", text: LONG_TEXT }] },
  ],
})}\n\n`;

async function mockLeadSuite(page: Page, { empty = false } = {}) {
  await page.addInitScript((email) => { try { localStorage.setItem(`leadta:whatsNew:whatsapp-gmail:${email}`, "1"); } catch { /* sin storage */ } }, lsUser.email);
  // Catch-all primero: las rutas registradas después tienen prioridad. Nada llega al servidor real.
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: lsUser } }));
  await page.route("**/api/subscriptions", (route) => route.fulfill({ json: { subscription: null } }));
  await page.route("**/api/businesses**", (route) => route.fulfill({ json: { businesses: [{ id: "b1", name: "Loruppa Catálogo Digital para Comercios Gastronómicos", domain: "loruppa.com" }] } }));
  await page.route("**/api/leadtita/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/lead-suite/dashboard**", (route) => route.fulfill({ json: { metrics: lsMetrics(empty), recentContacts: empty ? [] : [1, 2, 3, 4].map(lsContact), latestReport: empty ? null : { weekStart: daysAgo(7), summary: "Esta semana contactaste 34 leads y respondieron 13. ".repeat(3), suggestions: ["Probá WhatsApp a la mañana, entre las 9 y las 11."], metrics: lsMetrics(false), sentAt: null } } }));
  await page.route("**/api/lead-suite/leads?**", (route) => {
    if (new URL(route.request().url()).searchParams.get("mention")) return route.fulfill({ json: { items: [1, 2, 3].map(lsLead) } });
    return route.fulfill({ json: empty ? { items: [], page: 1, totalPages: 1 } : { items: Array.from({ length: 25 }, (_, i) => lsLead(i + 1)), page: 1, totalPages: 3 } });
  });
  await page.route("**/api/lead-suite/contacts?**", (route) => route.fulfill({ json: { items: [1, 2].map(lsContact) } }));
  await page.route("**/api/lead-suite/insights**", (route) => route.fulfill({ json: lsInsights(empty) }));
  await page.route("**/api/lead-suite/chat/usage", (route) => route.fulfill({ json: { whatsapp: { used: 12, limit: 50 }, gmail: { used: 3, limit: 100 }, ai: { used: 40, limit: 200 } } }));
  await page.route("**/api/lead-suite/chat/message-models**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/integrations/whatsapp/status", (route) => route.fulfill({ json: { configured: true, status: "connected" } }));
  await page.route("**/api/integrations/google/status", (route) => route.fulfill({ json: { configured: true, email: lsUser.email, features: { gmail: true } } }));
  await page.route("**/api/scheduled", (route) => route.fulfill({ json: lsScheduled }));
  await page.route("**/api/lead-suite/chat", (route) => route.fulfill({ headers: { "content-type": "text/event-stream" }, body: lsChatStream() }));
}

const LS_SCREENS = [
  { name: "resumen", url: "/lead-suite", ready: ".ls-kpis" },
  { name: "resumen vacío", url: "/lead-suite", ready: ".ls-empty", empty: true },
  { name: "mis leads", url: "/lead-suite?tab=leads", ready: ".ls-leads" },
  { name: "métricas", url: "/lead-suite?tab=metrics", ready: ".lsm-grid" },
  { name: "reporte", url: "/lead-suite?tab=report", ready: ".ls-report" },
] as const;

for (const width of WIDTHS) {
  for (const screen of LS_SCREENS) {
    test(`RESPONSIVE lead-suite ${screen.name} @${width}: sin desborde horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockLeadSuite(page, { empty: "empty" in screen && screen.empty });
      await page.goto(screen.url);
      await expect(page.locator(screen.ready).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test(`RESPONSIVE lead-suite chat con lote y borradores @${width}: sin desborde ni contadores encima`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLeadSuite(page);
    // En móvil y tablet el chat es la pestaña "Leadtita"; en desktop está al costado.
    await page.goto(width > 1024 ? "/lead-suite" : "/lead-suite?tab=leadtita");
    const input = page.locator(".ls-chat textarea");
    await input.fill("Prepará mensajes de WhatsApp");
    await input.press("Enter");
    await expect(page.locator(".ls-batch__row").first()).toBeVisible();
    await expect(page.locator(".ls-chat__draft").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // Los contadores quedan arriba del log (en el flujo), nunca encima de los mensajes.
    const quotas = await page.locator(".ls-chat__quotas").boundingBox();
    const log = await page.locator(".ls-chat__log").boundingBox();
    expect(quotas && log && quotas.y + quotas.height <= log.y + 1).toBeTruthy();
    // El botón de enviar no queda tapado por los controles del compositor.
    const send = await page.locator(".ls-chat__send").boundingBox();
    const permission = await page.locator(".ls-chat__control--permission").boundingBox();
    expect(send && permission && permission.x + permission.width <= send.x + 1).toBeTruthy();
    // La tabla de markdown usa su propio ancho, no el min-width global de la tabla de leads.
    const table = await page.locator(".ls-chat__md table").boundingBox();
    const log2 = await page.locator(".ls-chat__log").boundingBox();
    expect(table && log2 && table.width <= log2.width).toBeTruthy();
  });
}

test("RESPONSIVE lead-suite diálogos @360: cargar contacto y programados entran en pantalla", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await mockLeadSuite(page);
  await page.goto("/lead-suite?tab=leads");
  await page.getByRole("button", { name: /Cargar contacto: Café 1$/ }).click();
  await expect(page.locator(".ls-contact-dialog[open]")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const dialog = await page.locator(".ls-contact-dialog[open]").boundingBox();
  expect(dialog && dialog.x >= 0 && dialog.x + dialog.width <= 361).toBeTruthy();
  await page.keyboard.press("Escape");
  await page.goto("/lead-suite?tab=leadtita");
  await page.locator(".ls-scheduled-button").click();
  await expect(page.locator(".ls-scheduled-dialog[open]")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const scheduled = await page.locator(".ls-scheduled-dialog[open]").boundingBox();
  expect(scheduled && scheduled.x >= 0 && scheduled.x + scheduled.width <= 361).toBeTruthy();
});

// ───────── /owner ─────────
const OW_LONG = "Necesitamos revisar urgentemente la configuración de la cuenta porque el cliente reportó que las búsquedas masivas de restaurantes en Córdoba devuelven resultados duplicados";
const owEmail = (i: number) => `contacto.comercial.departamento-ventas${i}@empresa-internacional-muy-larga.com.ar`;
const owDate = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const owRange = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));
const owPage = <T,>(items: T[], empty: boolean) => (empty ? { items: [], page: 1, totalPages: 1, totalItems: 0 } : { items, page: 1, totalPages: 3, totalItems: items.length * 3 });
const owUser = { id: "u0", email: owEmail(0), name: "Owner", credits: 999, role: "owner", access: "ok", trialEndsAt: "" };
const owUsers = owRange(25, (i) => ({ id: `u${i}`, email: owEmail(i), name: `María Fernanda de los Ángeles Rodríguez Etcheverry ${i}`, credits: 123456 + i, created: owDate(i), phone: "5493511234567", lastActivity: owDate(i), role: i === 0 ? "owner" : "user", ownerContacted: i % 2 === 0, subscription: i % 3 ? { id: `s${i}`, planId: "pro", status: "authorized", priceArs: 45000, monthlyCredits: 3000 } : null }));
const owUserDetail = { user: owUsers[1], subscriptions: [{ id: "s1", planId: "pro", status: "authorized", priceArs: 45000, monthlyCredits: 3000, externalReference: "ext-ref-0123456789abcdef", created: owDate(3) }], payments: owRange(5, (i) => ({ id: `p${i}`, paymentId: `12345678901234${i}`, status: "processed", amountArs: 45000, credits: 3000, created: owDate(i) })) };
const owOverview = { mrrArs: 123456789, activeSubscriptions: 12345, pausedSubscriptions: 234, totalUsers: 987654, newUsers30d: 4321, creditsInCirculation: 98765432, revenue30dArs: 987654321, planBreakdown: [{ planId: "pro", count: 1234, mrrArs: 55555555 }, { planId: "starter", count: 4321, mrrArs: 44444444 }] };
const owAudit = owRange(25, (i) => ({ id: `a${i}`, actorEmail: owEmail(i), action: ["user.credits_add", "subscription.status", "batch.delete", "user.update"][i % 4], targetType: "user", targetId: `u${i}`, targetLabel: owEmail(i + 1), details: { amount: 100, note: OW_LONG }, ip: "2800:810:4a5:1234:abcd:ef01:2345:6789", created: owDate(i) }));
const owEventTypes = ["signup", "verified", "leads", "people", "chat", "generated", "contact", "scheduled"];
const owEvents = { items: owRange(16, (i) => ({ id: `e${i}`, type: owEventTypes[i % 8], email: owEmail(i), count: 3 + i, date: owDate(Math.floor(i / 4)), status: ["sent", "failed", "completed", "replied"][i % 4], excerpt: OW_LONG, details: { name: "Juan Cruz Fernández", keywords: "restaurantes veganos con delivery y terraza en Nueva Córdoba", leadName: "Restaurante Parrilla y Pizzería La Esquina del Barrio" } })), hasMore: true };
const owAnalytics = (days: number) => ({
  days,
  traffic: { configured: true, totals: { pageviews: 1234567, visitors: 345678 }, daily: owRange(days, (i) => ({ date: owDate(days - i).slice(0, 10), pageviews: 1000 + i * 37, visitors: 300 + i * 11 })), topPages: owRange(8, (i) => ({ path: `/blog/como-conseguir-clientes-para-tu-agencia-de-marketing-digital-${i}`, pageviews: 9000 - i * 500, visitors: 4000 - i * 200 })), referrers: owRange(6, (i) => ({ domain: `subdominio-largo.buscador-de-referencias${i}.com.ar`, visitors: 900 - i * 50 })) },
  features: ["lead_search", "people_search", "pain_analysis"].map((id, i) => ({ id, count: 12345 - i * 1000, units: 99999, credits: 54321, usd: 123.45 })),
  credits: { total: 9876543, byFeature: ["lead_search", "people_search"].map((id) => ({ id, credits: 3333333, units: 222222 })) },
  ai: { available: true, totalUsd: 1234.5678, calls: 98765, promptTokens: 123456789, completionTokens: 23456789, daily: owRange(days, (i) => ({ date: owDate(days - i).slice(0, 10), usd: 10 + i, calls: 100 + i })), byFeature: ["leadtita_chat", "pain_analysis", "enrichment"].map((feature, i) => ({ feature, usd: 400 - i * 50, calls: 9000 - i * 1000 })), byModel: ["deepseek/deepseek-v4.1-flash", "openai/gpt-5.2-mini-2026-08-07"].map((model, i) => ({ model, usd: 500 - i * 100, calls: 40000 - i * 5000 })), topUsers: owRange(6, (i) => ({ userId: `u${i}`, email: owEmail(i), usd: 90 - i * 5, calls: 3000 - i * 100 })) },
});
const owSubscriptions = owRange(25, (i) => ({ id: `s${i}`, userId: `u${i}`, userEmail: owEmail(i), planId: ["pro", "starter", "business"][i % 3], status: ["authorized", "paused", "cancelled", "pending"][i % 4], priceArs: 145000, monthlyCredits: 30000, externalReference: `leadta-sub-0123456789abcdef0123456789abcdef-${i}`, created: owDate(i) }));
const owPayments = owRange(25, (i) => ({ id: `p${i}`, paymentId: `123456789012345${i}`, status: ["processed", "rejected", "pending", "refunded"][i % 4], amountArs: 1450000, credits: 300000, balanceBefore: 123456, userId: `u${i}`, userEmail: owEmail(i), subscriptionId: `sub-0123456789abcdef0123456789abcdef-${i}`, created: owDate(i) }));
const owCampaigns = owRange(5, (i) => ({ id: `cp${i}`, name: `Campaña de lanzamiento Black Friday y Cyber Monday para nuevos clientes ${i}`, label: "Oferta Única por tiempo limitado", message: `50% OFF en todos los servicios — ${OW_LONG}`, discountPercent: 50, allFeatures: i % 2 === 0, features: ["lead_search", "people_search"], startsAt: owDate(10 + i), endsAt: owDate(-10 + i * 5), active: i !== 3 }));
const owBatches = owRange(25, (i) => ({ id: `b${i}`, userId: `u${i}`, userEmail: owEmail(i), keywords: `restaurantes veganos con delivery, terraza y estacionamiento propio ${i}`, country: "Argentina", province: "Provincia de Buenos Aires", district: "Partido de General San Martín", requestedCount: 1000, resultCount: 987, status: ["running", "completed", "partial", "failed"][i % 4], createdAt: owDate(i) }));
const owFeedback = owRange(25, (i) => ({ id: `f${i}`, identifier: `FB-2026-${1000 + i}`, url: `https://leadta.com/lead-suite?tab=metrics&filtro=contactados&busqueda=restaurantes-veganos-${i}`, createdAt: owDate(i), state: i % 3 ? "open" : "closed", kind: i % 2 ? "bug" : "comment", message: `${OW_LONG} ${OW_LONG}`, user: i % 5 ? { id: `u${i}`, email: owEmail(i) } : null }));
const owBlog = owRange(25, (i) => ({ id: `bp${i}`, title: `Cómo conseguir clientes para tu agencia de marketing digital sin gastar en publicidad paga ${i}`, slug: `como-conseguir-clientes-para-tu-agencia-de-marketing-digital-${i}`, locale: i % 2 ? "en" : "es", excerpt: OW_LONG, coverUrl: null, coverAlt: "", seoTitle: "", seoDescription: "", tags: ["prospección", "ventas B2B"], status: i % 3 ? "published" : "draft", publishedAt: owDate(i), authorName: "Equipo Leadta", readingMinutes: 12, updated: owDate(i) }));
const owTraceTypes = ["conversation", "email_sent", "email_system", "batch", "people_search", "ai_usage", "payment"];
const owTrace = { items: owRange(14, (i) => ({ id: `t${i}`, type: owTraceTypes[i % 7], at: owDate(i % 5), userId: `u${i}`, userEmail: owEmail(i), title: `Conversación sobre prospección de restaurantes en Córdoba y envío masivo ${i}`, summary: OW_LONG, refId: `c${i}`, detail: { to: owEmail(i + 2), subject: "Propuesta comercial personalizada para su negocio", tokens: 123456, amountArs: 145000, status: "processed" } })), page: 1, totalPages: 4, totalItems: 100, unavailable: [] };
const owStaffReply = { reply: `**Resumen**: ${OW_LONG}\n\n| Usuario | Créditos | Plan |\n|---|---|---|\n| ${owEmail(1)} | 123456 | Pro |\n| ${owEmail(2)} | 654321 | Business |`, actions: [{ type: "pending_change", token: "tok1", change: { kind: "adjust_credits", target: owEmail(3), fields: [{ key: "credits", before: 123456, after: 999999 }, { key: "message", after: OW_LONG }], needsCard: true, destructive: false } }] };

async function mockOwner(page: Page, { empty = false } = {}) {
  // Catch-all primero: las rutas registradas después tienen prioridad. Escrituras (POST/PATCH/DELETE) se responden sin tocar el servidor.
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: owUser } }));
  await page.route("**/api/leadtita/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/owner/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/owner/assistant") return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: complete\ndata: ${JSON.stringify(owStaffReply)}\n\n` });
    if (route.request().method() !== "GET") return json({});
    if (path === "/api/owner/me") return json({ ok: true });
    if (path === "/api/owner/overview") return json(owOverview);
    if (path === "/api/owner/audit") return json(owPage(owAudit.slice(0, Number(url.searchParams.get("perPage")) || 25), empty));
    if (path === "/api/owner/events") return json(empty ? { items: [], hasMore: false } : owEvents);
    if (path === "/api/owner/analytics") return json(owAnalytics(Number(url.searchParams.get("days")) || 30));
    if (/^\/api\/owner\/users\/[^/]+$/.test(path)) return json(owUserDetail);
    if (path === "/api/owner/users") return json(owPage(owUsers, empty));
    if (path === "/api/owner/subscriptions") return json(owPage(owSubscriptions, empty));
    if (path === "/api/owner/payments") return json(owPage(owPayments, empty));
    if (path === "/api/owner/campaigns") return json({ items: empty ? [] : owCampaigns });
    if (path === "/api/owner/batches") return json(owPage(owBatches, empty));
    if (path === "/api/owner/feedback") return json(owPage(owFeedback, empty));
    if (path === "/api/owner/blog") return json(owPage(owBlog, empty));
    if (path === "/api/owner/traceability") return json(empty ? { items: [], page: 1, totalPages: 1, totalItems: 0, unavailable: [] } : owTrace);
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const OW_TABLE = "main tbody tr";
const OW_SECTIONS = [
  { key: "resumen", ready: "main dd" },
  { key: "analiticas", ready: "main dd" },
  { key: "usuarios", ready: OW_TABLE },
  { key: "suscripciones", ready: OW_TABLE },
  { key: "pagos", ready: OW_TABLE },
  { key: "campanas", ready: "main li:has-text('Campaña de lanzamiento')" },
  { key: "busquedas", ready: OW_TABLE },
  { key: "comentarios", ready: OW_TABLE },
  { key: "blog", ready: OW_TABLE },
  { key: "trazabilidad", ready: "main :text('Conversación sobre prospección')" },
  { key: "auditoria", ready: OW_TABLE },
] as const;

for (const width of WIDTHS) {
  for (const section of OW_SECTIONS) {
    test(`owner ${section.key} @ ${width}px: sin desborde horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockOwner(page);
      await page.goto(`/owner?s=${section.key}`);
      await expect(page.locator(section.ready).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      // Los números grandes de las tarjetas no se salen de su tarjeta.
      for (const value of await page.locator("main dl dd").all()) {
        expect(await value.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      }
    });

    test(`owner ${section.key} vacío @ ${width}px: sin desborde horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockOwner(page, { empty: true });
      await page.goto(`/owner?s=${section.key}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    });
  }

  test(`owner staff @ ${width}px: respuesta con tabla y tarjeta sin desborde`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockOwner(page);
    await page.goto("/owner?s=staff");
    const input = page.locator(".ls-chat--staff textarea");
    await input.fill("¿Quiénes tienen más créditos?");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: /Confirmar/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // La tabla del markdown entra en el chat: sin el min-width global de 1160px.
    const table = page.locator(".ls-chat__md table").first();
    expect(await table.evaluate((node) => node.getBoundingClientRect().width <= (node.parentElement?.clientWidth ?? 0) + 1)).toBe(true);
  });
}

test("owner usuarios @ 360px: las tarjetas de la tabla usan todo el ancho y el drawer entra en pantalla", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await mockOwner(page);
  await page.goto("/owner?s=usuarios");
  await expect(page.locator(OW_TABLE).first()).toBeVisible();
  // Sin el min-width global de la tabla: el contenedor no scrollea en horizontal en móvil.
  const wrap = page.locator("main table").first().locator("xpath=..");
  expect(await wrap.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.getByRole("button", { name: /Administrar/ }).nth(1).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const box = await drawer.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 361).toBeTruthy();
});

test("owner menú móvil @ 360px: el botón de menú conserva 40px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await mockOwner(page);
  await page.goto("/owner?s=suscripciones");
  const menu = page.getByRole("button", { name: "Abrir menú" });
  const box = await menu.boundingBox();
  expect(box && box.width >= 40 && box.height >= 40).toBeTruthy();
  await menu.click();
  await expect(page.locator("#owner-sidebar")).toBeInViewport();
  await expectNoHorizontalOverflow(page);
});
