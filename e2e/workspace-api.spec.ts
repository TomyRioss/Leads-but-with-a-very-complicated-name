import { expect, test } from "@playwright/test";

// Mis negocios / Mis campañas / Mis propuestas: sin sesión cada ruta responde 401 (nunca crea datos: e2e corre contra prod).
const ID = "aaaaaaaaaaaaaaa";
const routes: [string, "GET" | "POST" | "PATCH", string][] = [
  ["MIS NEGOCIOS", "GET", "/api/businesses"],
  ["MIS CAMPAÑAS", "GET", "/api/sales-campaigns"],
  ["MIS CAMPAÑAS (por negocio)", "GET", `/api/sales-campaigns?business=${ID}`],
  ["LEADS DE UNA CAMPAÑA", "GET", `/api/sales-campaigns/${ID}/leads`],
  ["BUSCAR MÁS LEADS DE UNA CAMPAÑA", "POST", `/api/sales-campaigns/${ID}/search`],
  ["MIS PROPUESTAS", "GET", `/api/proposals?campaign=${ID}`],
  ["EDITAR PROPUESTA", "PATCH", `/api/proposals/${ID}`],
  ["ENVIAR PROPUESTA", "POST", `/api/proposals/${ID}/send`],
];

for (const [feature, method, path] of routes) {
  test(`${feature} exige sesión`, async ({ request }) => {
    const response = await request.fetch(path, { method, data: method === "GET" ? undefined : {} });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
}
