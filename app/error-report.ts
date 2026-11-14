"use client";

/** Contexto de un error visible al usuario, para precargar el modal de Comentarios. */
export type ErrorReportContext = {
  message: string;
  action?: string;
  status?: number;
  requestId?: string;
};

export type FeedbackPrefill = { kind: "comment" | "bug"; message: string };

export const OPEN_FEEDBACK_EVENT = "leadta:open-feedback";
export const errorReportEnabled = process.env.NODE_ENV === "production";

// Quita tokens, emails y parámetros de query que podrían ser sensibles.
function scrub(value: string) {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .slice(0, 1500);
}

export function buildErrorReport(context: ErrorReportContext) {
  const lines = [
    `Error: ${scrub(context.message)}`,
    `Página: ${location.pathname}`,
    context.action && `Acción: ${scrub(context.action)}`,
    context.status && `Status HTTP: ${context.status}`,
    context.requestId && `Request ID: ${scrub(context.requestId)}`,
    `Fecha: ${new Date().toISOString()}`,
    `Idioma: ${document.documentElement.lang || navigator.language}`,
    `User agent: ${navigator.userAgent}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function openErrorReport(context: ErrorReportContext) {
  const detail: FeedbackPrefill = { kind: "bug", message: `\n\n---\n${buildErrorReport(context)}` };
  window.dispatchEvent(new CustomEvent<FeedbackPrefill>(OPEN_FEEDBACK_EVENT, { detail }));
}
