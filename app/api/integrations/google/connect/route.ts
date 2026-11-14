import { NextResponse, type NextRequest } from "next/server";
import { parseGoogleFeatures } from "@/lib/server/google-connections";
import { NONCE_COOKIE, STATE_TTL_SECONDS, appOrigin, createState, driveScopes, isConfigured, noStore, redirectUri, redirectWithFlash, requireUser, safeReturnTo } from "../_shared";

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const user = await requireUser(request);
  if (!user) return noStore(NextResponse.redirect(new URL("/buscar", origin)));
  const features = parseGoogleFeatures(request.nextUrl.searchParams.get("features"));
  if (!isConfigured()) return redirectWithFlash(returnTo, "not_configured", features[0] ?? "drive");

  const { state, nonce } = createState(user.id, returnTo);
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    // Consentimiento incremental: Drive base + las features pedidas (?features=gmail,calendar); include_granted_scopes conserva lo ya concedido.
    scope: driveScopes(features).join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: user.email,
    state,
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: "/api/integrations/google", maxAge: STATE_TTL_SECONDS });
  return noStore(response);
}
