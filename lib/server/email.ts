import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

const sender = "Tomas Rios <tomas@leadta.app>";
const verificationLifetimeSeconds = 60 * 60 * 24;
const resendUrl = "https://api.resend.com/emails";

type Locale = "es" | "en";
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
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("APP_URL debe usar HTTPS.");
  return url.origin;
}

function signatureFor(payload: string) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.RESEND_API_KEY;
  if (!secret) throw new Error("Falta configurar RESEND_API_KEY.");
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

async function sendEmail(input: { to: string; subject: string; text: string; html: string; idempotencyKey: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Falta configurar RESEND_API_KEY.");

  const response = await fetch(resendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: sender,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Resend rechazó el email (${response.status}).`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

export async function sendVerificationEmail(user: Pick<UserEmailRecord, "id" | "email" | "name">, locale: Locale) {
  const token = createEmailVerificationToken(user, locale);
  const verifyUrl = new URL(locale === "en" ? "/en/verificar" : "/verificar", appOrigin());
  verifyUrl.searchParams.set("token", token);
  const greeting = locale === "en" ? "Verify your email" : "Confirmá tu correo";
  const intro = locale === "en"
    ? "Confirm your email address to activate your Leadta account and its trial credits."
    : "Confirmá tu dirección de correo para activar tu cuenta de Leadta y tus créditos de prueba.";
  const button = locale === "en" ? "Verify email" : "Confirmar correo";
  const expiration = locale === "en" ? "This link expires in 24 hours." : "Este enlace vence en 24 horas.";
  const safeName = user.name ? ` ${escapeHtml(user.name)}` : "";

  await sendEmail({
    to: user.email,
    subject: locale === "en" ? "Verify your email for Leadta" : "Confirmá tu correo para Leadta",
    text: `${greeting}${user.name ? `, ${user.name}` : ""}.\n\n${intro}\n\n${verifyUrl}\n\n${expiration}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#202320;line-height:1.6"><p>${greeting}${safeName}.</p><p>${intro}</p><p><a href="${escapeHtml(verifyUrl.toString())}" style="display:inline-block;background:#c9e94f;color:#202320;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700">${button}</a></p><p style="color:#676e67;font-size:14px">${expiration}</p></div>`,
    idempotencyKey: `leadta-verification-${user.id}-${createHash("sha256").update(token).digest("hex")}`,
  });
}

export async function sendWelcomeEmail(user: Pick<UserEmailRecord, "id" | "email">) {
  const demoUrl = "https://wa.me/5491134083140?text=Hola%2C%20quiero%20agendar%20una%20llamada%20o%20demo%20de%20Leadta.";
  const text = [
    "Hola, cómo estás?",
    "",
    "Gracias por unirte a nuestra plataforma, soy Tomas Rios, uno de los Founders de Leadta!",
    "",
    "Ya podes comenzar a usar Leadta con créditos de prueba, igualmente te ánimo a hablarme por este correo o a mi telefono (accesible mediante el botón de agendar llamada/demo).",
    "",
    "Estoy dando Asesoría en Ventas Gratuita para los Early Adopters cómo vos y también comentarte cómo son nuestros planes pagos, dependen de tus necesidades pero el más chico que tenemos está en $15 USD/mes!",
    "",
    "¡Espero la herramienta te sirva, estoy a tú dispoción!",
    "Tomas Rios.",
    "",
    `Agendar llamada/demo: ${demoUrl}`,
  ].join("\n");
  const html = [
    "<p>Hola, cómo estás?</p>",
    "<p>Gracias por unirte a nuestra plataforma, soy Tomas Rios, uno de los Founders de Leadta!</p>",
    "<p>Ya podes comenzar a usar Leadta con créditos de prueba, igualmente te ánimo a hablarme por este correo o a mi telefono (accesible mediante el botón de agendar llamada/demo).</p>",
    "<p>Estoy dando Asesoría en Ventas Gratuita para los Early Adopters cómo vos y también comentarte cómo son nuestros planes pagos, dependen de tus necesidades pero el más chico que tenemos está en $15 USD/mes!</p>",
    "<p>¡Espero la herramienta te sirva, estoy a tú dispoción!<br>Tomas Rios.</p>",
    `<p><a href="${demoUrl}" style="display:inline-block;background:#c9e94f;color:#202320;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700">Agendar llamada/demo</a></p>`,
  ].join("");

  await sendEmail({
    to: user.email,
    subject: "¡Gracias por unirte a Leadta!",
    text,
    html,
    idempotencyKey: `leadta-welcome-${user.id}`,
  });
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
