import { isDevOnlyEnabled } from "@/lib/env-features";

/** Mensaje para la interfaz: el detalle técnico solo se muestra en dev (dev only `technical_errors`); en prod es el genérico ya traducido. */
export function uiError(detail: string, generic: string): string {
  return isDevOnlyEnabled("technical_errors") ? detail : generic;
}
