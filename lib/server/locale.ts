import { createTranslator } from "next-intl";
import { routing } from "../../i18n/routing";
import errorsEn from "../../messages/errors/en.json" with { type: "json" };
import errorsEs from "../../messages/errors/es.json" with { type: "json" };
import searchEn from "../../messages/search/en.json" with { type: "json" };
import searchEs from "../../messages/search/es.json" with { type: "json" };

export type Locale = (typeof routing.locales)[number];
type Namespace = "Errors" | "Email" | "Search";

// Solo se cargan los catálogos que usa el servidor (errores, emails y etiquetas de columnas), no los de toda la app.
const catalogs: Record<Locale, Record<string, unknown>> = {
  es: { ...errorsEs, ...searchEs },
  en: { ...errorsEn, ...searchEn },
};

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}

function cookieLocale(header: string | null) {
  const match = header?.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const value = match?.[1].trim();
  return isLocale(value) ? value : null;
}

function acceptedLocale(header: string | null) {
  if (!header) return null;
  const ranked = header.split(",").map((part) => {
    const [tag, ...params] = part.trim().split(";");
    const q = Number(params.map((param) => param.trim()).find((param) => param.startsWith("q="))?.slice(2) ?? 1);
    return { language: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
  }).filter((entry) => entry.q > 0).sort((a, b) => b.q - a.q);
  return ranked.map((entry) => entry.language).find(isLocale) ?? null;
}

/** Locale del request: cookie NEXT_LOCALE de next-intl, luego Accept-Language, luego el locale por defecto. */
export function resolveLocale(request: Request): Locale {
  return cookieLocale(request.headers.get("cookie")) ?? acceptedLocale(request.headers.get("accept-language")) ?? routing.defaultLocale;
}

/** Usa el locale explícito del body cuando es válido; si no, el del request. */
export function localeFrom(request: Request, explicit?: unknown): Locale {
  return isLocale(explicit) ? explicit : resolveLocale(request);
}

export type Translator = (key: string, values?: Record<string, string | number>) => string;

const translators = new Map<string, Translator>();

export function getTranslator(locale: Locale, namespace: Namespace): Translator {
  const id = `${locale}.${namespace}`;
  let translator = translators.get(id);
  if (!translator) {
    // Claves dinámicas: los catálogos no declaran tipos globales, así que se relaja el tipado de claves.
    const t = createTranslator({ locale, messages: catalogs[locale] as never, namespace: namespace as never }) as unknown as Translator;
    translator = (key, values) => t(key, values);
    translators.set(id, translator);
  }
  return translator;
}

/** Traductor del namespace "Errors" para el idioma del request. */
export function errorTranslator(request: Request, explicit?: unknown) {
  return getTranslator(localeFrom(request, explicit), "Errors");
}

/** Ruta con el prefijo de locale según `localePrefix` de i18n/routing.ts. */
export function localizedPath(locale: Locale, path: string) {
  const mode: string = typeof routing.localePrefix === "string" ? routing.localePrefix : routing.localePrefix?.mode ?? "always";
  return mode === "never" || (mode === "as-needed" && locale === routing.defaultLocale) ? path : `/${locale}${path}`;
}
