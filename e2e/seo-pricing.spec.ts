import { expect, test } from "@playwright/test";

type JsonLdNode = { "@type"?: string | string[]; "@graph"?: JsonLdNode[]; [key: string]: unknown };

const hasType = (node: JsonLdNode, type: string) =>
  Array.isArray(node["@type"]) ? node["@type"].includes(type) : node["@type"] === type;

for (const path of ["/pricing", "/en/pricing"]) {
  test(`SEO DE PRICING: JSON-LD DE PLANES Y BREADCRUMB (${path})`, async ({ page }) => {
    await page.goto(path);
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
    const nodes = raw
      .flatMap((text) => {
        const parsed = JSON.parse(text) as JsonLdNode | JsonLdNode[];
        return Array.isArray(parsed) ? parsed : [parsed];
      })
      .flatMap((node) => [node, ...(Array.isArray(node["@graph"]) ? node["@graph"] : [])]);

    const app = nodes.find((node) => hasType(node, "SoftwareApplication"));
    expect(app).toBeTruthy();
    const offers = app?.offers as JsonLdNode[];
    expect(Array.isArray(offers)).toBe(true);
    expect(offers.length).toBeGreaterThanOrEqual(2);
    for (const offer of offers) {
      expect(offer["@type"]).toBe("Offer");
      expect(String(offer.price ?? "")).not.toBe("");
      expect(String(offer.priceCurrency ?? "")).not.toBe("");
    }
    expect(nodes.some((node) => hasType(node, "BreadcrumbList"))).toBe(true);
  });

  test(`SEO DE PRICING: JERARQUÍA DE TÍTULOS (${path})`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "Starter", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Growth", exact: true })).toBeVisible();
    await expect(page.locator("h3", { hasText: /^Starter$/ })).toHaveCount(0);
  });

  test(`SEO DE PRICING: FOOTER CON LINKS LEGALES (${path})`, async ({ page }) => {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href$="/terminos"]').first()).toBeVisible();
    await expect(footer.locator('a[href$="/privacidad"]').first()).toBeVisible();
  });
}
