import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { renderFeedbackHtml, renderFeedbackThanksEmail, renderLeadSuiteWeeklyReportEmail, renderVerificationEmail, renderWelcomeEmail } from "@/lib/server/email-templates";
import type { WeeklyReport } from "@/lib/lead-suite";
import type { Locale } from "@/lib/server/locale";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

const verificationSender = "Leadta <noreply@leadta.app>";
const welcomeSender = "Tomas Rios <tomas@leadta.app>";
const verificationLifetimeSeconds = 60 * 60 * 24;
const resendUrl = "https://api.resend.com/emails";

type UserEmailRecord = {
  id: string;
  email: string;
  name?: string;
  verified?: boolean;
  verification_sent_at?: string;
  welcome_email_sent_at?: string;
};

function appOrigin() {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}

function signatureFor(payload: string) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.RESEND_API_KEY;
  if (!secret) throw new Error("RESEND_API_KEY is not configured.");
  return createHmac("sha256", secret).update(`leadta-email-verification-v1.${payload}`).digest("base64url");
}

export function createEmailVerificationToken(user: Pick<UserEmailRecord, "id" | "email">, locale: Locale) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email.toLowerCase(),
    locale,
    exp: Math.floor(Date.now() / 1000) + verificationLifetimeSeconds,
  })).toString("base64url");
  return `${payload}.${signatureFor(payload)}`;
}

export function readEmailVerificationToken(token: string): { id: string; email: string; locale: Locale } | null {
  if (token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(signatureFor(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      id?: unknown;
      email?: unknown;
      locale?: unknown;
      exp?: unknown;
    };
    if (
      typeof data.id !== "string" || !/^[a-zA-Z0-9]{8,32}$/.test(data.id) ||
      typeof data.email !== "string" || !/^\S+@\S+\.\S+$/.test(data.email) ||
      (data.locale !== "es" && data.locale !== "en") ||
      typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)
    ) return null;
    return { id: data.id, email: data.email.toLowerCase(), locale: data.locale };
  } catch {
    return null;
  }
}

async function sendEmail(input: { from: string; to: string; subject: string; text: string; html: string; idempotencyKey: string; replyTo?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");

  const response = await fetch(resendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Resend rejected the email (${response.status}).`);
}

export async function sendVerificationEmail(user: Pick<UserEmailRecord, "id" | "email" | "name">, locale: Locale) {
  const token = createEmailVerificationToken(user, locale);
  const { subject, text, html } = renderVerificationEmail({ name: user.name, locale, origin: appOrigin(), token });
  await sendEmail({
    from: verificationSender,
    to: user.email,
    subject,
    text,
    html,
    idempotencyKey: `leadta-verification-${user.id}-${createHash("sha256").update(token).digest("hex")}`,
  });
}

export async function sendWelcomeEmail(user: Pick<UserEmailRecord, "id" | "email">, locale: Locale) {
  await sendEmail({ from: welcomeSender, to: user.email, ...renderWelcomeEmail(locale), idempotencyKey: `leadta-welcome-${user.id}` });
}

const supportSender = "Leadta Soporte <support@leadta.app>";
const feedbackInbox = "tomyrios2006@gmail.com";

/** Aviso interno de un comentario nuevo; el texto ya viene armado (con metadata) desde la ruta. */
export async function sendFeedbackNotification(input: { subject: string; text: string; idempotencyKey: string; replyTo: string }) {
  const html = `<pre style="font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${renderFeedbackHtml(input.text)}</pre>`;
  await sendEmail({ from: supportSender, to: feedbackInbox, subject: input.subject, text: input.text, html, idempotencyKey: input.idempotencyKey, replyTo: input.replyTo });
}

export async function sendFeedbackThanksEmail(input: { to: string; locale: Locale; credits: number; issueId: string }) {
  await sendEmail({ from: supportSender, to: input.to, ...renderFeedbackThanksEmail(input.locale, input.credits), idempotencyKey: `leadta-feedback-thanks-${input.issueId}` });
}

export async function getEmailUser(id: string) {
  return pocketBaseFetch<UserEmailRecord>(`/api/collections/users/records/${encodeURIComponent(id)}?fields=id,email,name,verified,verification_sent_at,welcome_email_sent_at`);
}

export async function updateEmailUser(id: string, data: Record<string, unknown>) {
  return pocketBaseFetch<UserEmailRecord>(`/api/collections/users/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function findEmailUser(email: string) {
  const filter = new URLSearchParams({
    filter: `email = ${JSON.stringify(email)}`,
    perPage: "1",
    fields: "id,email,name,verified,verification_sent_at,welcome_email_sent_at",
  });
  const response = await pocketBaseFetch<{ items: UserEmailRecord[] }>(`/api/collections/users/records?${filter.toString()}`);
  return response.items[0] || null;
}

const reportSender = "Leadta <noreply@leadta.app>";

export async function sendLeadSuiteWeeklyReport(input: { userId: string; to: string; name?: string; locale: Locale; report: WeeklyReport }) {
  const { report } = input;
  const email = renderLeadSuiteWeeklyReportEmail({
    locale: input.locale,
    origin: appOrigin(),
    name: input.name,
    weekStart: report.weekStart,
    summary: report.summary,
    suggestions: report.suggestions,
    contacts: report.metrics.contactsInRange,
    leads: report.metrics.leadsContactedInRange,
    replyRate: report.metrics.replyRate,
    pendingFollowUps: report.metrics.pendingFollowUps.length,
  });
  await sendEmail({ from: reportSender, to: input.to, ...email, idempotencyKey: `leadta-lead-suite-weekly-${input.userId}-${report.weekStart.slice(0, 10)}` });
}
