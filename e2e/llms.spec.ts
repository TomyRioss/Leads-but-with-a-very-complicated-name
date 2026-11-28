import { expect, test } from "@playwright/test";
import { publicPlans, subscriptionPlans } from "../lib/plans";

// Solo GET: el entorno e2e usa producción.
const plans = publicPlans(subscriptionPlans);
const lowestPriceUsd = String(Math.min(...plans.map((plan) => plan.priceUsd)));

type JsonLdNode = { "@type"?: string | string[]; offers?: unknown };
type Offer = { price?: string | number; priceCurrency?: string };

test("VER LLMS.TXT", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).not.toMatch(/reseñas/i);
  expect(body).not.toMatch(/google maps/i);
  expect(body).toContain("/api/mcp");
});

test("VER LLMS-FULL.TXT", async ({ request }) => {
  const res = await request.get("/llms-full.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/text\/markdown/);
  const body = await res.text();
  expect(plans.some((plan) => body.includes(plan.name))).toBe(true);
  expect(body).not.toMatch(/reseñas/i);
  expect(body).not.toMatch(/google maps/i);
});

test("LANDING CONSERVA CANONICAL Y HREFLANG", async ({ page }) => {
  await page.goto("/");
  const head = page.locator("head");
  const canonical = head.locator('link[rel="canonical"]');
  await expect(canonical).toHaveCount(1);
  await expect(canonical).toHaveAttribute("href", /^(https?:\/\/[^/]+)?\/$/);
  await expect(head.locator('link[rel="alternate"][hreflang="es"]')).toHaveCount(1);
  const en = head.locator('link[rel="alternate"][hreflang="en"]');
  await expect(en).toHaveCount(1);
  await expect(en).toHaveAttribute("href", /\/en$/);
  await expect(head.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  await expect(head.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", /\/llms-full\.txt$/);
});

test("BLOG ENLAZA LLMS-FULL.TXT", async ({ page }) => {
  await page.goto("/blog");
  const head = page.locator("head");
  await expect(head.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", /\/llms-full\.txt$/);
  await expect(head.locator('link[rel="canonical"]')).toHaveCount(1);
});

test("PRECIO EN DATOS ESTRUCTURADOS DE LANDING", async ({ page }) => {
  await page.goto("/");
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  const nodes = scripts.flatMap((text) => {
    const data = JSON.parse(text) as JsonLdNode & { "@graph"?: JsonLdNode[] };
    return data["@graph"] ?? [data];
  });
  const app = nodes.find((node) => [node["@type"]].flat().includes("SoftwareApplication"));
  expect(app).toBeDefined();
  const offers = [app?.offers].flat() as Offer[];
  const lowest = offers.reduce<Offer | undefined>((min, offer) => (!min || Number(offer.price) < Number(min.price) ? offer : min), undefined);
  expect(String(lowest?.price)).toBe(lowestPriceUsd);
  expect(lowest?.priceCurrency).toBe("USD");
});
