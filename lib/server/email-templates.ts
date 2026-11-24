import { getTranslator, localizedPath, type Locale } from "./locale";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

const button = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;background:#c9e94f;color:#202320;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700">${label}</a>`;

export function renderVerificationEmail(input: { name?: string; locale: Locale; origin: string; token: string }) {
  const t = getTranslator(input.locale, "Email");
  const url = new URL(localizedPath(input.locale, "/verificar"), input.origin);
  url.searchParams.set("token", input.token);
  const greeting = t(input.name ? "verifyGreetingNamed" : "verifyGreeting", { name: input.name ?? "" });
  const htmlGreeting = t(input.name ? "verifyGreetingNamed" : "verifyGreeting", { name: escapeHtml(input.name ?? "") });
  const intro = t("verifyIntro");
  const expiration = t("verifyExpiration");
  return {
    url: url.toString(),
    subject: t("verifySubject"),
    text: `${greeting}\n\n${intro}\n\n${url}\n\n${expiration}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#202320;line-height:1.6"><p>${htmlGreeting}</p><p>${intro}</p><p>${button(url.toString(), t("verifyButton"))}</p><p style="color:#676e67;font-size:14px">${expiration}</p></div>`,
  };
}

export function renderPasswordResetEmail(input: { name?: string; locale: Locale; origin: string; token: string }) {
  const t = getTranslator(input.locale, "Email");
  const url = new URL(localizedPath(input.locale, "/restablecer"), input.origin);
  url.searchParams.set("token", input.token);
  const greeting = t(input.name ? "resetGreetingNamed" : "resetGreeting", { name: input.name ?? "" });
  const htmlGreeting = t(input.name ? "resetGreetingNamed" : "resetGreeting", { name: escapeHtml(input.name ?? "") });
  const intro = t("resetIntro");
  const expiration = t("resetExpiration");
  return {
    subject: t("resetSubject"),
    text: `${greeting}

${intro}

${url}

${expiration}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#202320;line-height:1.6"><p>${htmlGreeting}</p><p>${intro}</p><p>${button(url.toString(), t("resetButton"))}</p><p style="color:#676e67;font-size:14px">${expiration}</p></div>`,
  };
}

export function renderWelcomeEmail(locale: Locale) {
  const t = getTranslator(locale, "Email");
  const demoUrl = `https://wa.me/5491134083140?text=${encodeURIComponent(t("welcomeDemoMessage"))}`;
  const paragraphs = [t("welcomeP1"), t("welcomeP2"), t("welcomeP3"), t("welcomeP4")];
  const signoff = [t("welcomeSignoff"), t("welcomeSignature")];
  return {
    subject: t("welcomeSubject"),
    text: [...paragraphs.flatMap((p) => [p, ""]), ...signoff, "", `${t("welcomeCta")}: ${demoUrl}`].join("\n"),
    html: [...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`), `<p>${signoff.map(escapeHtml).join("<br>")}</p>`, `<p>${button(demoUrl, escapeHtml(t("welcomeCta")))}</p>`].join(""),
  };
}

export const renderFeedbackHtml = escapeHtml;

export function renderFeedbackThanksEmail(locale: Locale, credits: number) {
  const t = getTranslator(locale, "Email");
  const paragraphs = [t("feedbackThanksP1"), t("feedbackThanksP2", { credits }), t("feedbackThanksP3")];
  const signoff = [t("feedbackThanksSignoff"), t("welcomeSignature")];
  return {
    subject: t("feedbackThanksSubject"),
    text: [...paragraphs.flatMap((p) => [p, ""]), ...signoff].join("\n"),
    html: [...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`), `<p>${signoff.map(escapeHtml).join("<br>")}</p>`].join(""),
  };
}

const weeklyReportCopy = {
  es: { subject: "Tu reporte semanal de Lead Suite", greeting: "Hola", greetingNamed: "Hola {name}", intro: "Así te fue la semana del {week}:", contacts: "Contactos", leads: "Leads contactados", replyRate: "Tasa de respuesta", pending: "Seguimientos pendientes", suggestions: "Sugerencias", cta: "Abrir Lead Suite" },
  en: { subject: "Your Lead Suite weekly report", greeting: "Hi", greetingNamed: "Hi {name}", intro: "Here's how the week of {week} went:", contacts: "Contacts", leads: "Leads contacted", replyRate: "Reply rate", pending: "Pending follow-ups", suggestions: "Suggestions", cta: "Open Lead Suite" },
} as const;

export const receiptCopy = {
  es: { subject: "Tu suscripción a Leadta está activa", greeting: "Hola", greetingNamed: "Hola {name}", thanks: "¡Gracias por suscribirte a Leadta! Tu pago fue aprobado y tus créditos ya están disponibles.", receipt: "Recibo", customer: "Cliente", attached: "Adjuntamos tu recibo en PDF.", plan: "Plan", credits: "Créditos acreditados", amount: "Monto", date: "Fecha", reference: "Referencia", renewal: "La suscripción se renueva automáticamente cada mes. Podés cancelarla cuando quieras desde tu cuenta.", cta: "Ir a Leadtita", help: "Cualquier duda, respondé a este correo o escribinos a support@leadta.app.", signoff: "Un abrazo,", signature: "El equipo de Leadta" },
  en: { subject: "Your Leadta subscription is active", greeting: "Hi", greetingNamed: "Hi {name}", thanks: "Thank you for subscribing to Leadta! Your payment was approved and your credits are ready.", receipt: "Receipt", customer: "Customer", attached: "Your receipt is attached as a PDF.", plan: "Plan", credits: "Credits added", amount: "Amount", date: "Date", reference: "Reference", renewal: "Your subscription renews automatically every month. You can cancel any time from your account.", cta: "Go to Leadtita", help: "Any questions, reply to this email or write to support@leadta.app.", signoff: "Best,", signature: "The Leadta team" },
} as const;

/** Confirmation + receipt + thanks for an approved subscription charge. */
export function renderSubscriptionReceiptEmail(input: { locale: Locale; origin: string; name?: string; planName: string; credits: number; amount: string; date: string; reference: string }) {
  const c = receiptCopy[input.locale === "en" ? "en" : "es"];
  const url = new URL(localizedPath(input.locale, "/leadtita"), input.origin).toString();
  const greeting = input.name ? c.greetingNamed.replace("{name}", input.name) : c.greeting;
  const rows: [string, string][] = [[c.plan, input.planName], [c.credits, String(input.credits)], [c.amount, input.amount], [c.date, input.date], [c.reference, input.reference]];
  return {
    subject: c.subject,
    text: [`${greeting},`, "", c.thanks, "", `${c.receipt}:`, ...rows.map(([k, v]) => `${k}: ${v}`), "", c.attached, c.renewal, "", `${c.cta}: ${url}`, "", c.help, "", c.signoff, c.signature].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#202320;line-height:1.6"><p>${escapeHtml(greeting)},</p><p>${escapeHtml(c.thanks)}</p><p style="font-weight:700;margin-bottom:4px">${escapeHtml(c.receipt)}</p><table style="border-collapse:collapse;margin:0 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#676e67">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:700">${escapeHtml(v)}</td></tr>`).join("")}</table><p style="color:#676e67;font-size:14px">${escapeHtml(c.attached)} ${escapeHtml(c.renewal)}</p><p>${button(url, escapeHtml(c.cta))}</p><p style="color:#676e67;font-size:14px">${escapeHtml(c.help)}</p><p>${escapeHtml(c.signoff)}<br>${escapeHtml(c.signature)}</p></div>`,
  };
}

export function renderLeadSuiteWeeklyReportEmail(input: { locale: Locale; origin: string; name?: string; weekStart: string; summary: string; suggestions: string[]; contacts: number; leads: number; replyRate: number; pendingFollowUps: number }) {
  const c = weeklyReportCopy[input.locale === "en" ? "en" : "es"];
  const url = new URL(localizedPath(input.locale, "/lead-suite"), input.origin).toString();
  const greeting = input.name ? c.greetingNamed.replace("{name}", input.name) : c.greeting;
  const intro = c.intro.replace("{week}", input.weekStart.slice(0, 10));
  const stats: [string, string][] = [[c.contacts, String(input.contacts)], [c.leads, String(input.leads)], [c.replyRate, `${Math.round(input.replyRate * 100)}%`], [c.pending, String(input.pendingFollowUps)]];
  return {
    subject: c.subject,
    text: [`${greeting},`, "", intro, "", input.summary, "", ...stats.map(([k, v]) => `${k}: ${v}`), "", `${c.suggestions}:`, ...input.suggestions.map((s) => `- ${s}`), "", `${c.cta}: ${url}`].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#202320;line-height:1.6"><p>${escapeHtml(greeting)},</p><p>${escapeHtml(intro)}</p><p>${escapeHtml(input.summary)}</p><table style="border-collapse:collapse;margin:16px 0">${stats.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#676e67">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:700">${escapeHtml(v)}</td></tr>`).join("")}</table><p style="font-weight:700;margin-bottom:4px">${escapeHtml(c.suggestions)}</p><ul style="padding-left:20px;margin-top:0">${input.suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul><p>${button(url, escapeHtml(c.cta))}</p></div>`,
  };
}
