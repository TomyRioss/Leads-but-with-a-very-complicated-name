import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import createNextIntlPlugin from "next-intl/plugin";

// CSP is limited to framing/base/object on purpose: a script-src/default-src would break Google Picker,
// Mercado Pago and Vercel Analytics. withBotId appends its own (SAMEORIGIN) headers for its proxy path,
// which override these because later matches win.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@countrystatecity/countries"],
  outputFileTracingIncludes: {
    "/api/geography": ["./node_modules/@countrystatecity/countries/dist/data/**/*"],
    "/api/search": ["./node_modules/@countrystatecity/countries/dist/data/**/*"],
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withBotId(withNextIntl(nextConfig));
