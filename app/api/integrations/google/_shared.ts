import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { INTEGRATION_FLASH_COOKIE, INTEGRATION_FLASH_MAX_AGE, serializeIntegrationFlash, type IntegrationFlashStatus } from "@/lib/integration-flash";

// Utilidades compartidas por las rutas de la integración con Google Drive (no es una ruta: el prefijo _ la excluye del router).

export const NONCE_COOKIE = "leadta_gdrive_nonce";
export const STATE_TTL_SECONDS = 600;
export const FILE_MIME_TYPES = [
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.document",
  "text/csv",
  "application/pdf",
  "text/markdown",
  "text/plain",
];

export function appOrigin() {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}

export { googleScopes as driveScopes, isGoogleDriveFullAccess as isFullAccess } from "@/lib/server/google-connections";

/** Integración usable: client OAuth del login con Google + clave de cifrado de tokens. */
export function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_ENCRYPTION_KEY);
}

export const redirectUri = () => new URL("/api/integrations/google/callback", appOrigin()).toString();

// Destinos permitidos después del consentimiento (evita open redirects).
const RETURN_PATHS = ["/leadtita", "/integraciones", "/en/leadtita", "/en/integraciones"];
export function safeReturnTo(value: string | null | undefined) {
  return RETURN_PATHS.includes(value ?? "") ? value as string : "/leadtita";
}

type StatePayload = { u: string; n: string; r: string; e: number };

// Firmado con el client secret del OAuth (secreto de servidor ya existente); ligado al usuario y a un nonce en cookie.
function sign(data: string) {
  return createHmac("sha256", `${process.env.GOOGLE_CLIENT_SECRET}:gdrive-state`).update(data).digest("base64url");
}

export function createState(userId: string, returnTo: string) {
  const nonce = randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ u: userId, n: nonce, r: returnTo, e: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS } satisfies StatePayload)).toString("base64url");
  return { state: `${payload}.${sign(payload)}`, nonce };
}

/** Pura salvo el secreto: valida firma, vencimiento, nonce de cookie y usuario. */
export function verifyState(state: string, nonce: string, userId: string): StatePayload | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !nonce) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StatePayload;
    const nonceOk = Buffer.from(data.n).length === Buffer.from(nonce).length && timingSafeEqual(Buffer.from(data.n), Buffer.from(nonce));
    if (!nonceOk || data.u !== userId || data.e < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Redirect to the clean `returnTo` carrying the OAuth result as a one-shot flash cookie (no query params). */
export function redirectWithFlash(returnTo: string, status: IntegrationFlashStatus, feature?: string) {
  const origin = appOrigin();
  const response = NextResponse.redirect(new URL(returnTo, origin));
  // Not httpOnly: the client reads it once and deletes it.
  response.cookies.set(INTEGRATION_FLASH_COOKIE, serializeIntegrationFlash({ provider: "google", status, feature }), { path: "/", sameSite: "lax", secure: origin.startsWith("https://"), maxAge: INTEGRATION_FLASH_MAX_AGE });
  return noStore(response);
}

export function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const json = (body: unknown, status = 200) => noStore(NextResponse.json(body, { status }));

/** Sesión leadta obligatoria. */
export async function requireUser(request: Request) {
  try {
    return (await getCurrentUser(request))?.user ?? null;
  } catch {
    return null;
  }
}

/** Mutaciones solo desde el propio sitio (defensa CSRF además de SameSite=Lax). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === appOrigin() || origin === new URL(request.url).origin;
}
