import type { MetadataRoute } from "next";

const origin = process.env.APP_URL?.trim() || "https://leadta.app";
const privatePaths = ["/negocios", "/campanas", "/propuestas", "/historial", "/lead-suite", "/verificar", "/restablecer"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", ...privatePaths, ...privatePaths.map((path) => `/en${path}`)],
    },
    sitemap: `${new URL(origin).origin}/sitemap.xml`,
  };
}
