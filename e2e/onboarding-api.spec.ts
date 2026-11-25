import { expect, test } from "@playwright/test";

// Onboarding de negocios y negocio activo: sin sesión cada ruta responde 401 (nunca crea datos: e2e corre contra prod).
const ID = "aaaaaaaaaaaaaaa";
const routes: [string, "GET" | "POST" | "PATCH", string, unknown][] = [
  ["INICIAR ONBOARDING DE NEGOCIO", "POST", "/api/onboarding", { mode: "text", description: "Panadería artesanal" }],
  ["VER ONBOARDING DE NEGOCIO", "GET", `/api/onboarding/${ID}`, undefined],
  ["GUARDAR PASO DEL ONBOARDING", "PATCH", `/api/onboarding/${ID}`, { step: "plan", data: {} }],
  ["ELEGIR NEGOCIO ACTIVO", "PATCH", "/api/businesses/active", { businessId: ID }],
  ["MIS NEGOCIOS (con activo)", "GET", "/api/businesses", undefined],
  ["ONBOARDING PENDIENTE AL ENTRAR", "GET", "/api/onboarding/pending", undefined],
];

for (const [feature, method, path, data] of routes) {
  test(`${feature} exige sesión`, async ({ request }) => {
    const response = await request.fetch(path, { method, data });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
}
