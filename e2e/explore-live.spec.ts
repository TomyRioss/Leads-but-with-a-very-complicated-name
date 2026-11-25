import { expect, test } from "@playwright/test";

// /explorar con la API simulada en el navegador (fetch con stream NDJSON): no crea corridas en PocketBase ni gasta IA.
// Cubre: ficha armándose en vivo, ficha terminada visible 5 s antes de avanzar y error traducido (no "step_failed").
test("EXPLORAR 5 PASOS: ficha en vivo, pausa de 5 s y error legible", async ({ page }) => {
  await page.addInitScript(() => {
    const run = { token: "", input: { mode: "web", url: "https://loruppa.com" }, campaignId: "", product: null, competitors: null, campaigns: null, leads: null, proposals: null };
    const product = { name: "Loruppa", domain: "loruppa.com", summary: "Catálogo digital y link para la bio de un negocio.", location: "Colombia", country: "Colombia" };
    const text = JSON.stringify({ name: product.name, summary: product.summary, location: product.location, country: product.country });
    const lines = (messages: unknown[], delay: number) => new ReadableStream({
      async start(controller) {
        for (const message of messages) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
        }
        controller.close();
      },
    });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.origin).pathname;
      if (path === "/api/explore") return new Response(JSON.stringify(run), { headers: { "Content-Type": "application/json" } });
      if (path === "/api/explore/research") {
        // Texto en 12 pedazos cada 400 ms: la ficha se ve a medio escribir antes del resultado final.
        const chunks = Array.from({ length: 12 }, (_, index) => ({ t: text.slice(Math.floor((index * text.length) / 12), Math.floor(((index + 1) * text.length) / 12)) }));
        return new Response(lines([...chunks, { data: product }], 400));
      }
      if (path === "/api/explore/competitors") return new Response(lines([{ error: "step_failed" }], 100));
      return original(input, init);
    };
  });

  await page.goto("/explorar");
  const header = page.getByRole("heading", { level: 1 });
  await expect(header).toHaveText("Esto encontramos sobre tu empresa");

  // En vivo: el nombre aparece mientras el paso sigue corriendo y antes del badge "Encontrado".
  await expect(page.getByRole("heading", { name: "Loruppa" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Investigando" })).toBeVisible();
  await expect(page.getByText("Encontrado")).toHaveCount(0);

  // Terminado: la ficha queda a la vista con su badge mientras el paso 2 ya corrió (y falló) de fondo.
  await expect(page.getByText("Encontrado")).toBeVisible();
  const doneAt = Date.now();
  await page.waitForTimeout(3000);
  await expect(header).toHaveText("Esto encontramos sobre tu empresa");

  // Pasados los 5 s avanza al paso 2 y muestra el error traducido, nunca el código.
  await expect(header).toHaveText("Tu producto y tus competidores", { timeout: 6000 });
  expect(Date.now() - doneAt).toBeGreaterThanOrEqual(4500);
  await expect(page.getByRole("alert").filter({ hasText: "Reintentar" })).toContainText("No pudimos completar este paso.");
  await expect(page.getByText("step_failed")).toHaveCount(0);
});
