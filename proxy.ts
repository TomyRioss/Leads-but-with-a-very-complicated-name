import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // 149e9513-…: Vercel BotID's proxy path; the locale rewrite would break it.
  matcher: "/((?!api|trpc|_next|_vercel|149e9513-01fa-4fb0-aad4-566afd725d1b|(?:[^/]+/)?(?:opengraph|twitter)-image|.*\\..*).*)",
};
