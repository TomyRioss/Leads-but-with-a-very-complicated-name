import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SocialNetwork } from "@/lib/types";

// Lectura directa del sitio propio del lead: sin modelo, sin costo. Solo datos presentes en el HTML.
export type FoundValue = { value: string; source_url: string };
export type ScrapedContacts = {
  email?: FoundValue;
  phone?: FoundValue;
  whatsapp?: FoundValue;
  socials: Partial<Record<SocialNetwork, FoundValue>>;
  pagesRead: string[];
};

const maxBytes = 1_000_000;
const pageTimeoutMs = 6_000;
const maxRedirects = 3;
const maxExtraPages = 3;

export const socialHosts: Record<SocialNetwork, string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.me"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  linkedin: ["linkedin.com", "lnkd.in"],
};

const hostMatches = (hostname: string, hosts: string[]) => hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

export function isValidEmail(value: string): boolean {
  if (value.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/.test(value)) return false;
  // Falsos positivos típicos del HTML: assets "logo@2x.png" y dominios de plantillas o trackers.
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(value)) return false;
  return !/@(example\.|sentry|wixpress\.com|domain\.com|email\.com|tusitio|yourdomain)/i.test(value);
}

/** Deja `+` inicial y dígitos; exige entre 8 y 15 dígitos (E.164). */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return `${trimmed.startsWith("+") || trimmed.startsWith("00") ? "+" : ""}${digits.replace(/^00/, "")}`;
}

/** Perfil de red oficial: https, host de la red, con ruta y sin links de compartir/posts. */
export function socialNetworkOf(rawUrl: string): SocialNetwork | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || /sharer|\/share|intent|plugins|dialog|\/p\/|\/reel|\/watch|embed|\/tr$|login|policy|legal/i.test(path)) return null;
  return (Object.keys(socialHosts) as SocialNetwork[]).find((network) => hostMatches(url.hostname, socialHosts[network])) ?? null;
}

function decodeEntities(value: string) {
  return value.replace(/&#64;|&#x40;/gi, "@").replace(/&amp;/g, "&").replace(/&#46;/g, ".");
}

/** Extrae contactos de un HTML. Pura: la usa el self-check. */
export function extractContacts(html: string, pageUrl: string) {
  const source = decodeEntities(html);
  const hrefs = [...source.matchAll(/href\s*=\s*["']([^"'<>]+)["']/gi)].map((match) => match[1].trim());
  const emails: string[] = [];
  const phones: string[] = [];
  const whatsapps: string[] = [];
  const socials = new Map<SocialNetwork, string>();
  const links: string[] = [];
  for (const href of hrefs) {
    if (/^mailto:/i.test(href)) {
      emails.push(decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase());
      continue;
    }
    if (/^tel:/i.test(href)) {
      phones.push(decodeURIComponent(href.slice(4)));
      continue;
    }
    const wa = href.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"']*&)?phone=)\+?(\d{8,15})/i);
    if (wa) {
      whatsapps.push(`+${wa[1]}`);
      continue;
    }
    let absolute: URL;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      continue;
    }
    const network = socialNetworkOf(absolute.toString());
    if (network) {
      if (!socials.has(network)) socials.set(network, `https://${absolute.host}${absolute.pathname.replace(/\/+$/, "")}`);
      continue;
    }
    links.push(absolute.toString());
  }
  // Emails escritos como texto (sin mailto), fuera de scripts y estilos.
  const visible = source.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  for (const match of visible.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g)) emails.push(match[0].toLowerCase());
  return {
    email: emails.find(isValidEmail) ?? "",
    phone: phones.map(normalizePhone).find(Boolean) ?? "",
    whatsapp: whatsapps.map(normalizePhone).find(Boolean) ?? "",
    socials,
    links,
  };
}

/** Links internos que suelen tener datos de contacto. */
export function contactPageLinks(links: string[], pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const picked = new Set<string>();
  for (const link of links) {
    const url = new URL(link);
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    if (!/contact|contacto|nosotros|about|quienes|somos|legal|aviso|ubicacion|sucursal/i.test(url.pathname)) continue;
    url.hash = "";
    if (url.toString() !== base.toString()) picked.add(url.toString());
    if (picked.size >= maxExtraPages) break;
  }
  return [...picked];
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// ponytail: valida DNS antes del fetch; queda la ventana de DNS rebinding entre lookup y conexión. Si importa, fijar la IP con un Agent propio.
async function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Unsupported port");
  if (url.username || url.password) throw new Error("Credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("Private address");
}

async function fetchPublicHtml(rawUrl: string): Promise<{ url: string; html: string } | null> {
  let url = new URL(rawUrl);
  const signal = AbortSignal.timeout(pageTimeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicUrl(url);
    const response = await fetch(url, { redirect: "manual", signal, cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; leadta-enrichment)", Accept: "text/html" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel();
    return { url: url.toString(), html: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes)) };
  }
  return null;
}

/** Lee el home y hasta 3 páginas de contacto del sitio. Nunca lanza: devuelve lo que pudo leer. */
export async function scrapeWebsite(website: string, networks: SocialNetwork[]): Promise<ScrapedContacts> {
  const result: ScrapedContacts = { socials: {}, pagesRead: [] };
  const absorb = (page: { url: string; html: string }) => {
    const found = extractContacts(page.html, page.url);
    result.pagesRead.push(page.url);
    if (!result.email && found.email) result.email = { value: found.email, source_url: page.url };
    if (!result.phone && found.phone) result.phone = { value: found.phone, source_url: page.url };
    if (!result.whatsapp && found.whatsapp) result.whatsapp = { value: found.whatsapp, source_url: page.url };
    for (const [network, url] of found.socials) {
      if (networks.includes(network) && !result.socials[network]) result.socials[network] = { value: url, source_url: page.url };
    }
    return found.links;
  };
  try {
    if (!/^https?:\/\//i.test(website.trim())) return result;
    const home = await fetchPublicHtml(website.trim());
    if (!home) return result;
    const extra = contactPageLinks(absorb(home), home.url);
    const pages = await Promise.allSettled(extra.map(fetchPublicHtml));
    for (const page of pages) if (page.status === "fulfilled" && page.value) absorb(page.value);
  } catch {
    // Sitio caído, bloqueado o privado: se sigue con la búsqueda del modelo.
  }
  return result;
}
