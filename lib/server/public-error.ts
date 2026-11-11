/** Mensaje para la interfaz: el detalle técnico solo se muestra con ENVIROMENT=dev; en prod es el genérico ya traducido. */
export function uiError(detail: string, generic: string): string {
  return process.env.ENVIROMENT?.trim().toLowerCase() === "dev" ? detail : generic;
}
