import { expect, test, type Page } from "@playwright/test";

// Páginas públicas sin desborde horizontal en móvil, tablet y desktop.
const WIDTHS = [360, 768, 1280];
const ROUTES = ["/", "/en", "/pricing", "/blog", "/terminos", "/privacidad", "/no-existe"];

// Filtra las recargas completas del HMR de `next dev`: si otro proceso edita archivos, la recarga rompe la medición.
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/hmr/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      let kind = "";
      try { const data = JSON.parse(String(message)); kind = data.type ?? data.action ?? ""; } catch { /* no es JSON */ }
      if (!/reload|serverComponentChanges|serverError/i.test(kind)) ws.send(message);
    });
    ws.onMessage((message) => server.send(message));
  });
});

/** Desborde del documento y elementos con texto que salen del viewport (la landing usa overflow-x: clip, que oculta el scroll). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const scrollsX = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
    const offenders: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const hasText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!hasText) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || (rect.right <= width + 1 && rect.left >= -1)) continue;
      let parent = el.parentElement;
      let inScroller = false;
      while (parent) { if (scrollsX(parent)) { inScroller = true; break; } parent = parent.parentElement; }
      if (!inScroller) offenders.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 40)}" ${Math.round(rect.left)}..${Math.round(rect.right)}`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders };
  });
}

async function expectNoOverflow(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  const result = await overflow(page);
  expect(result.scrollWidth, `${path} @${width}`).toBeLessThanOrEqual(result.width + 1);
  expect(result.offenders, `${path} @${width}`).toEqual([]);
}

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`RESPONSIVE PÚBLICO ${route} @${width}`, async ({ page }) => {
      await expectNoOverflow(page, route, width);
    });
  }
}

for (const width of WIDTHS) {
  test(`RESPONSIVE PÚBLICO /blog/<slug> @${width}`, async ({ page }) => {
    await page.goto("/blog");
    const href = await page.locator('main a[href^="/blog/"]').first().getAttribute("href", { timeout: 20_000 }).catch(() => null);
    test.skip(!href, "El blog no tiene artículos publicados.");
    await expectNoOverflow(page, href!, width);
  });
}
