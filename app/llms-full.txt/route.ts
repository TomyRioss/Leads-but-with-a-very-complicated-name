import { BLOG_LOCALES, type BlogLocale, type BlogPostSummary } from "@/lib/blog";
import { publicPlans, subscriptionPlans, type Plan } from "@/lib/plans";
import { listPublishedPosts } from "@/lib/server/blog";

// Contexto completo para LLMs y agentes (llms.txt extendido). Solo datos públicos.
// Con Cache Components el GET se prerenderiza: listPublishedPosts es "use cache" (cacheLife "hours", tag "blog"),
// así que la respuesta se revalida con el blog.

const origin = new URL(process.env.APP_URL?.trim() || "https://leadta.app").origin;
const url = (locale: BlogLocale, path: string) => `${origin}${locale === "es" ? "" : "/en"}${path === "/" && locale !== "es" ? "" : path}`;
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const number = (value: number) => value.toLocaleString("en-US");

const plan = (item: Plan) =>
  `### ${item.name}\n\n- Price: ${item.priceUsd} USD/month (${number(item.priceArs)} ARS/month in Argentina)\n- Credits: ${number(item.credits)} per month\n- Monthly limits: ${number(item.limits.whatsappMonthly)} WhatsApp messages, ${number(item.limits.emailMonthly)} emails, ${number(item.limits.scheduledMonthly)} scheduled messages`;

const post = (locale: BlogLocale, item: BlogPostSummary) =>
  `- [${oneLine(item.title)}](${url(locale, `/blog/${encodeURIComponent(item.slug)}`)})${item.excerpt ? `: ${oneLine(item.excerpt)}` : ""}`;

async function posts(locale: BlogLocale) {
  try {
    // ponytail: los 50 posts más recientes por idioma; paginar si el blog crece.
    return (await listPublishedPosts(locale, { page: 1, perPage: 50 })).items;
  } catch (error) {
    // Sin el blog igual se publican descripción y planes.
    console.error("[llms-full] blog unavailable", error instanceof Error ? error.name : "unknown");
    return [];
  }
}

export async function GET() {
  const blog = await Promise.all(BLOG_LOCALES.map(async (locale) => ({ locale, items: await posts(locale) })));
  const body = [
    "# Leadta",
    "",
    "> Leadta is a web app to find local businesses to contact: search by category and area, get leads with phone, email, website and social profiles, and reach them by WhatsApp or Gmail. Available in Spanish and English.",
    "",
    "## What it does",
    "",
    "- Business search by category and area; every batch is saved to the user's history.",
    "- Analysis of each business's public information to detect pains to address in the pitch.",
    "- Sending by WhatsApp and Gmail, with scheduled messages.",
    "- Lead Suite: a light CRM to record contacts and measure replies.",
    "- Export to CSV or XLSX.",
    "- Remote MCP server at " + `${origin}/api/mcp` + " (OAuth, paid plan required).",
    "",
    "## Plans",
    "",
    "Monthly plans; price and credits renew every month.",
    "",
    publicPlans(subscriptionPlans).map(plan).join("\n\n"),
    "",
    `Pricing: ${url("es", "/pricing")} (es), ${url("en", "/pricing")} (en)`,
    "",
    "## Pages",
    "",
    ...BLOG_LOCALES.flatMap((locale) => [`- [Home (${locale})](${url(locale, "/")})`, `- [Blog (${locale})](${url(locale, "/blog")})`]),
    `- [Terms](${url("es", "/terminos")})`,
    `- [Privacy](${url("es", "/privacidad")})`,
    "",
    "## Blog",
    ...blog.flatMap(({ locale, items }) => ["", `### ${locale === "es" ? "Español" : "English"}`, "", ...(items.length ? items.map((item) => post(locale, item)) : ["- No published posts yet."])]),
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
