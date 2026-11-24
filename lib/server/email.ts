import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { renderFeedbackHtml, renderFeedbackThanksEmail, renderLeadSuiteWeeklyReportEmail, renderPasswordResetEmail, renderSubscriptionReceiptEmail, renderVerificationEmail, renderWelcomeEmail } from "@/lib/server/email-templates";
import { renderReceiptPdf } from "@/lib/server/receipt-pdf";
import type { WeeklyReport } from "@/lib/lead-suite";
import type { Locale } from "@/lib/server/locale";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

const verificationSender = "Leadta <noreply@leadta.app>";
const welcomeSender = "Tomas Rios <tomas@leadta.app>";
const verificationLifetimeSeconds = 60 * 60 * 24;
const passwordResetLifetimeSeconds = 60 * 60;
const resendUrl = "https://api.resend.com/emails";

type UserEmailRecord = {
  id: string;
  email: string;
  name?: string;
  verified?: boolean;
  updated?: string;
  verification_sent_at?: string;
  welcome_email_sent_at?: string;
};

function appOrigin() {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}

type TokenPurpose = "email-verification" | "password-reset";

/** The purpose is part of the signed input, so a verification token never passes as a reset token (or vice versa). */
function signatureFor(payload: string, purpose: TokenPurpose) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.RESEND_API_KEY;
  if (!secret) throw new Error("RESEND_API_KEY is not configured.");
  return createHmac("sha256", secret).update(`leadta-${purpose}-v1.${payload}`).digest("base64url");
}

function signToken(data: Record<string, unknown>, purpose: TokenPurpose) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${signatureFor(payload, purpose)}`;
}

/** Payload of a well-signed, unexpired token with a valid user id and email; null otherwise. */
function readToken(token: string, purpose: TokenPurpose): (Record<string, unknown> & { id: string; email: string }) | null {
  if (token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(signatureFor(payload, purpose));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof data.id !== "string" || !/^[a-zA-Z0-9]{8,32}$/.test(data.id) ||
      typeof data.email !== "string" || !/^\S+@\S+\.\S+$/.test(data.email) ||
      typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)
    ) return null;
    return { ...data, id: data.id, email: data.email.toLowerCase() };
  } catch {
    return null;
  }
}

export function createEmailVerificationToken(user: Pick<UserEmailRecord, "id" | "email">, locale: Locale) {
  return signToken({
    id: user.id,
    email: user.email.toLowerCase(),
    locale,
    exp: Math.floor(Date.now() / 1000) + verificationLifetimeSeconds,
  }, "email-verification");
}

export function readEmailVerificationToken(token: string): { id: string; email: string; locale: Locale } | null {
  const data = readToken(token, "email-verification");
  if (!data || (data.locale !== "es" && data.locale !== "en")) return null;
  return { id: data.id, email: data.email, locale: data.locale };
}

/**
 * `v` is the record's `updated` timestamp when the link was sent. Setting the new password changes it,
 * so a link works once (and dies if the account changes meanwhile).
 */
export function createPasswordResetToken(user: Pick<UserEmailRecord, "id" | "email" | "updated">) {
  return signToken({
    id: user.id,
    email: user.email.toLowerCase(),
    v: user.updated ?? "",
    exp: Math.floor(Date.now() / 1000) + passwordResetLifetimeSeconds,
  }, "password-reset");
}

export function readPasswordResetToken(token: string): { id: string; email: string; v: string } | null {
  const data = readToken(token, "password-reset");
  return data && typeof data.v === "string" ? { id: data.id, email: data.email, v: data.v } : null;
}

async function sendEmail(input: { from: string; to: string | string[]; subject: string; text: string; html: string; idempotencyKey: string; replyTo?: string; attachments?: { filename: string; content: string }[] }) {
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
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
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

export async function sendPasswordResetEmail(user: Pick<UserEmailRecord, "id" | "email" | "name" | "updated">, locale: Locale) {
  const token = createPasswordResetToken(user);
  await sendEmail({
    from: verificationSender,
    to: user.email,
    ...renderPasswordResetEmail({ name: user.name, locale, origin: appOrigin(), token }),
    idempotencyKey: `leadta-password-reset-${user.id}-${createHash("sha256").update(token).digest("hex")}`,
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

// ponytail: remitente en leadta.app porque es el único dominio verificado en Resend (leadta.com daría 403).
const staffSender = "Leadta Staff <staff@leadta.app>";
const staffInboxes = ["tomyrios2006@gmail.com", "enzogalante7@gmail.com"];

/** Aviso interno de registro nuevo o de saldo bajo, con link directo al WhatsApp del usuario. */
export async function sendStaffAlert(input: { kind: "signup" | "low-credits"; user: { id: string; email: string; name?: string; phone?: string }; credits?: number }) {
  const { user } = input;
  const digits = user.phone?.replace(/\D/g, "") ?? "";
  const whatsapp = digits ? `https://wa.me/${digits}` : "";
  const subject = input.kind === "signup" ? `Nuevo registro: ${user.email}` : `Créditos bajos (${input.credits}): ${user.email}`;
  const lines = [
    input.kind === "signup" ? "Se registró un usuario nuevo." : `Un usuario quedó con menos de 15 créditos (le quedan ${input.credits}).`,
    `Nombre: ${user.name || "-"}`,
    `Email: ${user.email}`,
    `Teléfono: ${user.phone || "sin teléfono"}`,
    ...(whatsapp ? [`WhatsApp: ${whatsapp}`] : []),
  ];
  const html = lines.map((line) => renderFeedbackHtml(line).replace(/https:\/\/wa\.me\/\d+/, (url) => `<a href="${url}">${url}</a>`)).join("<br>");
  // La Idempotency-Key de Resend (24 h) evita repetir el aviso: bajos créditos 1 por día y usuario, registro 1 por usuario.
  const idempotencyKey = input.kind === "signup" ? `leadta-staff-signup-${user.id}` : `leadta-staff-low-credits-${user.id}-${new Date().toISOString().slice(0, 10)}`;
  await sendEmail({ from: staffSender, to: staffInboxes, subject, text: lines.join("\n"), html, idempotencyKey });
}

export async function sendFeedbackThanksEmail(input: { to: string; locale: Locale; credits: number; issueId: string }) {
  await sendEmail({ from: supportSender, to: input.to, ...renderFeedbackThanksEmail(input.locale, input.credits), idempotencyKey: `leadta-feedback-thanks-${input.issueId}` });
}

export async function getEmailUser(id: string) {
  return pocketBaseFetch<UserEmailRecord>(`/api/collections/users/records/${encodeURIComponent(id)}?fields=id,email,name,verified,updated,verification_sent_at,welcome_email_sent_at`);
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
    fields: "id,email,name,verified,updated,verification_sent_at,welcome_email_sent_at",
  });
  const response = await pocketBaseFetch<{ items: UserEmailRecord[] }>(`/api/collections/users/records?${filter.toString()}`);
  return response.items[0] || null;
}

/** Confirmation + receipt for one approved charge; the payment id is the idempotency key, so retried webhooks never resend it. */
export async function sendSubscriptionReceiptEmail(input: { to: string; name?: string; locale: Locale; planName: string; credits: number; amount: string; date: string; paymentId: string }) {
  const receipt = { locale: input.locale, name: input.name, planName: input.planName, credits: input.credits, amount: input.amount, date: input.date, reference: input.paymentId };
  const email = renderSubscriptionReceiptEmail({ ...receipt, origin: appOrigin() });
  const pdf = await renderReceiptPdf({ ...receipt, email: input.to });
  await sendEmail({ from: verificationSender, to: input.to, ...email, idempotencyKey: `leadta-subscription-receipt-${input.paymentId}`, attachments: [{ filename: `leadta-${input.locale === "en" ? "receipt" : "recibo"}-${input.paymentId}.pdf`, content: Buffer.from(pdf).toString("base64") }] });
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
