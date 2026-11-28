import type { MetadataRoute } from "next";

const origin = process.env.APP_URL?.trim() || "https://leadta.app";
// Las rutas privadas emiten meta noindex: no se bloquean acá para que el crawler pueda leerlo.
const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "CCBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow: "/api/" })),
    ],
    sitemap: `${new URL(origin).origin}/sitemap.xml`,
  };
}
