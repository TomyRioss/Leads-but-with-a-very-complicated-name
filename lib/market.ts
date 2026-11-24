export function getMarketCountry(headers: Headers): string | null {
  for (const name of ["x-vercel-ip-country", "cf-ipcountry", "x-country-code"]) {
    const normalized = headers.get(name)?.trim().toUpperCase();
    if (normalized && /^[A-Z]{2}$/.test(normalized)) return normalized;
  }

  return null;
}

/** Currencies configured in the Rebill plans; every other country sees USD. */
const CURRENCY_BY_COUNTRY: Record<string, string> = { AR: "ARS", MX: "MXN", CO: "COP", CL: "CLP", BR: "BRL" };

export const marketCurrency = (headers: Headers) => CURRENCY_BY_COUNTRY[getMarketCountry(headers) ?? ""] ?? "USD";

/** Returns true only when a trusted hosting proxy identifies the request as Argentina. */
export function isArgentinaMarket(headers: Headers): boolean {
  return getMarketCountry(headers) === "AR";
}
