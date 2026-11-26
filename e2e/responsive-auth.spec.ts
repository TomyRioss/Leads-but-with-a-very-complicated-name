import { expect, test, type Page } from "@playwright/test";

// Pantallas de auth sin desborde horizontal en móvil, tablet y escritorio. No envía formularios con datos válidos.
const widths = [360, 768, 1280];
const user = { id: "u1", email: "test@example.com", role: "user", verified: true, credits: 0 };

type Screen = { name: string; path: string; signedIn?: boolean; heading: RegExp };
const screens: Screen[] = [
  { name: "login", path: "/login", heading: /Ingresa a Leadta/ },
  { name: "register", path: "/register", heading: /Crea tu cuenta/ },
  { name: "verificar", path: "/verificar", heading: /Enlace inválido/ },
  { name: "restablecer", path: "/restablecer", heading: /Enlace inválido/ },
  { name: "restablecer con token", path: "/restablecer?token=abc", heading: /contraseña nueva/ },
  { name: "oauth consent", path: "/oauth/authorize?client_id=x", signedIn: true, heading: /Claude/ },
];

async function mockApis(page: Page, signedIn: boolean) {
  // HMR conectado (la hidratación lo espera) pero sin recargas: el dev server compartido no corta la medición.
  await page.routeWebSocket(/hmr/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => { if (!/"type":"(reloadPage|turbopack-message)"/.test(String(message))) ws.send(message); });
    ws.onMessage((message) => server.send(message));
  });
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: signedIn ? user : null } }));
  await page.route(/\/api\/oauth\/authorize/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { clientName: "Claude Desktop", redirectHost: "claude.ai", scopes: ["read", "write", "credits", "send"] } })
      : route.abort(),
  );
}

for (const screen of screens) {
  for (const width of widths) {
    test(`${screen.name} sin desborde horizontal a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApis(page, Boolean(screen.signedIn));
      await page.goto(screen.path);
      await expect(page.locator("main h1").first()).toHaveText(screen.heading);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    });
  }
}
