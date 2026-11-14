/**
 * Fuente única de verdad para funcionalidades restringidas al entorno dev (ENVIROMENT=dev).
 * Sin "server-only" ni dependencias: se usa desde rutas, server components y scripts.
 */

export function isDevEnvironment(): boolean {
  return process.env.ENVIROMENT?.trim().toLowerCase() === "dev";
}

/**
 * Dev features: funcionalidades en prueba que saldrán a producción pronto.
 * Para lanzar una, sacala de esta lista.
 */
export const DEV_FEATURES = ["people_search"] as const;
export type DevFeature = (typeof DEV_FEATURES)[number];

export function isDevFeatureEnabled(name: DevFeature | string): boolean {
  return !(DEV_FEATURES as readonly string[]).includes(name) || isDevEnvironment();
}

/** Dev features habilitadas en este entorno (vacío en prod). Lo expone /api/status. */
export function enabledDevFeatures(): DevFeature[] {
  return isDevEnvironment() ? [...DEV_FEATURES] : [];
}

/**
 * Dev only: herramientas de desarrollo que nunca salen a producción.
 * - small_batches: lotes de 1–2 resultados.
 * - referrals: "Recomendar Leadta" en el menú de cuenta.
 * - analysis_diagnostics: panel de diagnóstico + limitaciones del análisis.
 * - technical_errors: detalle técnico en mensajes de error.
 */
export const DEV_ONLY = ["small_batches", "referrals", "analysis_diagnostics", "technical_errors"] as const;
export type DevOnly = (typeof DEV_ONLY)[number];

// ponytail: todas las dev only comparten el mismo gate; el nombre documenta el uso.
export function isDevOnlyEnabled(name: DevOnly): boolean {
  void name;
  return isDevEnvironment();
}
