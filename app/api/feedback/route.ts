import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { sendFeedbackNotification } from "@/lib/server/email";
import { createFeedbackIssue, isLinearConfigured, type FeedbackKind } from "@/lib/server/linear";
import { errorTranslator, localeFrom } from "@/lib/server/locale";

// ponytail: límite en memoria por instancia (1 envío por minuto por usuario); pasar a un store compartido si hay abuso real.
const recentByUser = new Map<string, number>();
const cooldownMs = 60_000;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

/** Contexto técnico que manda el navegador: solo strings/números acotados, nunca objetos arbitrarios. */
function clientContext(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const errors = Array.isArray(input.recentErrors) ? input.recentErrors.slice(-10).map((item) => text(item, 400)).filter(Boolean) : [];
  return {
    url: text(input.url, 500),
    referrer: text(input.referrer, 500),
    viewport: text(input.viewport, 40),
    screen: text(input.screen, 40),
    devicePixelRatio: text(input.devicePixelRatio, 10),
    language: text(input.language, 40),
    languages: text(input.languages, 120),
    timezone: text(input.timezone, 80),
    platform: text(input.platform, 80),
    online: text(input.online, 10),
    colorScheme: text(input.colorScheme, 10),
    memory: text(input.memory, 20),
    connection: text(input.connection, 40),
    pageLoadedAt: text(input.pageLoadedAt, 40),
    recentErrors: errors,
  };
}

export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  if (!isLinearConfigured() && !process.env.RESEND_API_KEY) return NextResponse.json({ error: t("feedbackFailed") }, { status: 503 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kind: FeedbackKind = body?.kind === "bug" ? "bug" : "comment";
  const message = text(body?.message, 4000);
  if (message.length < 5) return NextResponse.json({ error: t("feedbackInvalid") }, { status: 400 });

  const now = Date.now();
  const last = recentByUser.get(session.user.id) ?? 0;
  if (now - last < cooldownMs) return NextResponse.json({ error: t("feedbackRateLimited") }, { status: 429 });
  recentByUser.set(session.user.id, now);
  if (recentByUser.size > 5000) recentByUser.clear();

  const locale = localeFrom(request, body?.locale);
  const context = clientContext(body?.context);
  const user = session.user;
  const sentAt = new Date(now).toISOString();
  const summary = message.replace(/\s+/g, " ").slice(0, 80);
  const title = `${kind === "bug" ? "Error reportado" : "Comentario"}: ${summary}${message.length > 80 ? "…" : ""}`;
  const metadata: [string, string][] = [
    ["Tipo", kind === "bug" ? "Error" : "Comentario"],
    ["Usuario", `${user.email} (${user.id})`],
    ["Nombre", user.name || "—"],
    ["Rol", user.role],
    ["Créditos", String(user.credits)],
    ["Idioma de la app", locale],
    ["Enviado", sentAt],
    ["Página", context.url || "—"],
    ["Referrer", context.referrer || "—"],
    ["User agent", text(request.headers.get("user-agent"), 400) || "—"],
    ["Plataforma", context.platform || "—"],
    ["Viewport / pantalla", `${context.viewport || "—"} / ${context.screen || "—"} @${context.devicePixelRatio || "?"}x`],
    ["Idiomas del navegador", context.languages || context.language || "—"],
    ["Zona horaria", context.timezone || "—"],
    ["Tema", context.colorScheme || "—"],
    ["Conexión / online", `${context.connection || "—"} / ${context.online || "—"}`],
    ["Memoria del dispositivo", context.memory || "—"],
    ["Página cargada", context.pageLoadedAt || "—"],
    ["Deploy", [process.env.VERCEL_ENV, process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7), text(request.headers.get("x-vercel-id"), 80)].filter(Boolean).join(" · ") || "local"],
  ];
  const errorsBlock = context.recentErrors.length ? context.recentErrors.map((item) => `- ${item}`).join("\n") : "Sin errores registrados en la página.";
  const quoted = message.split("\n").map((line) => `> ${line}`).join("\n");
  const description = [
    "## Mensaje",
    quoted,
    "",
    "## Metadata",
    ...metadata.map(([label, value]) => `- **${label}:** ${value.replace(/\n/g, " ")}`),
    "",
    "## Errores recientes del navegador",
    errorsBlock,
  ].join("\n");

  const [issue, email] = await Promise.allSettled([
    isLinearConfigured() ? createFeedbackIssue({ kind, title, description, user: { id: user.id, email: user.email, locale } }) : Promise.reject(new Error("LINEAR_API_KEY is not configured.")),
    sendFeedbackNotification({
      subject: `[Leadta] ${title}`,
      replyTo: user.email,
      idempotencyKey: `leadta-feedback-${user.id}-${now}`,
      text: [message, "", "— Metadata —", ...metadata.map(([label, value]) => `${label}: ${value}`), "", "— Errores recientes —", errorsBlock].join("\n"),
    }),
  ]);
  if (issue.status === "rejected") console.error("Feedback Linear issue failed:", issue.reason instanceof Error ? issue.reason.message.slice(0, 200) : "unknown");
  if (email.status === "rejected") console.error("Feedback email failed:", email.reason instanceof Error ? email.reason.message.slice(0, 200) : "unknown");
  if (issue.status === "rejected" && email.status === "rejected") {
    recentByUser.delete(user.id);
    return NextResponse.json({ error: t("feedbackFailed") }, { status: 502 });
  }
  return NextResponse.json({ ok: true, issue: issue.status === "fulfilled" ? issue.value.identifier : null });
}
