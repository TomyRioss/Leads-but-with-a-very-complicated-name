import { expect, test } from "@playwright/test";

// Panel owner > Analíticas > Generador de links con UTM. Todo /api/* se simula: nada llega a producción.
test("GENERAR LINK CON UTM: preset por red, campaña y link listo para copiar", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/owner/me") return route.fulfill({ json: { ok: true } });
    if (pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: "owner-e2e", email: "owner@example.com", credits: 0, role: "owner" } } });
    return route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  await page.goto("/owner?s=analiticas");

  const builder = page.getByRole("region", { name: "Generador de links con UTM" });
  await expect(builder).toBeVisible();
  const result = builder.locator("output");
  await expect(result).toHaveText("Completá URL, origen, medio y campaña.");

  await builder.getByRole("button", { name: "Facebook" }).click();
  await expect(builder.getByRole("button", { name: "Facebook" })).toHaveAttribute("aria-pressed", "true");
  await builder.getByLabel("Campaña (utm_campaign) *").fill("Black Friday 2026");
  await builder.getByLabel("Contenido (utm_content)").fill("Post 1");
  await expect(result).toHaveText("https://leadta.app/?utm_source=facebook&utm_medium=social&utm_campaign=black-friday-2026&utm_content=post-1");

  await builder.getByRole("button", { name: "Copiar" }).click();
  await expect(builder.getByRole("button", { name: "Copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("utm_campaign=black-friday-2026");

  await builder.getByLabel("URL destino *").fill("leadta");
  await expect(result).toHaveText("Completá URL, origen, medio y campaña.");
  await expect(builder.getByRole("button", { name: "Copiar" })).toBeDisabled();
});
