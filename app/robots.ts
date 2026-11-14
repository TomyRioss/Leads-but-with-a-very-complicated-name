import type { MetadataRoute } from "next";

const origin = process.env.APP_URL?.trim() || "https://leadta.app";
const privatePaths = ["/buscar", "/historial", "/lead-suite", "/owner", "/verificar"];

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
