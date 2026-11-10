const GENERIC = "Ocurrió un problema. Intentá de nuevo en unos minutos.";

/** Mensaje para la interfaz: el detalle técnico solo se muestra con ENVIROMENT=dev; en prod es genérico. */
export function uiError(detail: string, generic = GENERIC): string {
  return process.env.ENVIROMENT?.trim().toLowerCase() === "dev" ? detail : generic;
}
