// Pure helpers to clean and display lead websites (no dependencies; tested by lib/url-display.selfcheck.mjs).
// Provider URLs carry tracking like "?utm_source=GoogleMaps&utm_medium=MyBusiness": never show it.

const TRACKING_PARAMS = new Set([
  "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "yclid", "twclid", "ttclid", "li_fat_id",
  "srsltid", "igshid", "mc_cid", "mc_eid", "_ga", "_gl", "ref_src", "hsa_acc", "hsa_cam", "hsa_grp", "hsa_ad",
  "hsa_src", "hsa_tgt", "hsa_kw", "hsa_mt", "hsa_net", "hsa_ver",
]);

function isTrackingParam(name: string) {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || key.startsWith("pk_") || TRACKING_PARAMS.has(key);
}

/** Clean website URL: http(s) only, tracking params and tracking/empty fragments removed. Returns "" when invalid. */
export function cleanWebsiteUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (!url.hostname.includes(".")) return "";
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }
  // Fragments like "#utm_source=..." or ":~:text=" are tracking/highlight, not navigation.
  if (/^#(:~:|utm_|$)/i.test(url.hash) || /utm_|gclid|fbclid/i.test(url.hash)) url.hash = "";
  let result = url.toString();
  if (!url.search && !url.hash && url.pathname === "/") result = result.replace(/\/$/, "");
  return result;
}

/** Short label: domain + short path, no protocol, no www, no query/hash, truncated. "" when invalid. */
export function displayWebsite(raw: unknown, maxLength = 40): string {
  const clean = cleanWebsiteUrl(raw);
  if (!clean) return "";
  const url = new URL(clean);
  const host = url.hostname.replace(/^www\./i, "");
  const path = url.pathname.replace(/\/+$/, "");
  let label = path && path !== "/" ? `${host}${path}` : host;
  try { label = decodeURI(label); } catch { /* keep encoded */ }
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}
