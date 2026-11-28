import { expect, test } from "@playwright/test";

for (const path of ["/", "/pricing"]) {
  test(`TWITTER TITLE IGUAL AL TITLE EN ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(/.+/);
    const title = await page.title();
    expect(title.trim()).not.toBe("");
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", title);
  });
}

test("LOGIN NO INDEXABLE PERO SEGUIBLE", async ({ page }) => {
  await page.goto("/login");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
  expect(await robots.getAttribute("content")).not.toMatch(/nofollow/);
});

test("SITEMAP INCLUYE /en", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toMatch(/<loc>[^<]*\/en<\/loc>/);
});

test("ROBOTS NOMBRA GPTBOT Y BLOQUEA /api/", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.ok()).toBe(true);
  const body = await res.text();
  expect(body).toContain("GPTBot");
  expect(body).toContain("Disallow: /api/");
});

test("LOGO EN /en/pricing VUELVE A /en", async ({ page }) => {
  await page.goto("/en/pricing");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Leadta, inicio" }),
  ).toHaveAttribute("href", "/en");
});
