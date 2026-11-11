import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

type Messages = Record<string, Record<string, unknown>>;

// Archivos por namespace: messages/<archivo>/<locale>.json se mergea encima de messages/<locale>.json.
const extraFiles = ["landing", "onboarding", "pricing", "search", "account", "owner", "errors"] as const;

// Merge profundo de 2 niveles (namespace → claves): un archivo puede agregar claves a un namespace del base sin pisar las existentes.
function mergeMessages(base: Messages, extra: Messages) {
  const result: Messages = { ...base };
  for (const [namespace, value] of Object.entries(extra)) {
    result[namespace] = { ...result[namespace], ...value };
  }
  return result;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const [base, ...extras] = await Promise.all([
    import(`../messages/${locale}.json`),
    ...extraFiles.map((file) => import(`../messages/${file}/${locale}.json`)),
  ]);
  return {
    locale,
    messages: extras.reduce<Messages>((merged, extra) => mergeMessages(merged, extra.default), base.default),
  };
});
