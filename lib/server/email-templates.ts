import { getTranslator, localizedPath, type Locale } from "./locale";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

const button = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;background:#c9e94f;color:#202320;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700">${label}</a>`;

export function renderVerificationEmail(input: { name?: string; locale: Locale; origin: string; token: string }) {
  const t = getTranslator(input.locale, "Email");
  const url = new URL(localizedPath(input.locale, "/verificar"), input.origin);
  url.searchParams.set("token", input.token);
  const greeting = t(input.name ? "verifyGreetingNamed" : "verifyGreeting", { name: input.name ?? "" });
  const htmlGreeting = t(input.name ? "verifyGreetingNamed" : "verifyGreeting", { name: escapeHtml(input.name ?? "") });
  const intro = t("verifyIntro");
  const expiration = t("verifyExpiration");
  return {
    url: url.toString(),
    subject: t("verifySubject"),
    text: `${greeting}\n\n${intro}\n\n${url}\n\n${expiration}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#202320;line-height:1.6"><p>${htmlGreeting}</p><p>${intro}</p><p>${button(url.toString(), t("verifyButton"))}</p><p style="color:#676e67;font-size:14px">${expiration}</p></div>`,
  };
}

export function renderWelcomeEmail(locale: Locale) {
  const t = getTranslator(locale, "Email");
  const demoUrl = `https://wa.me/5491134083140?text=${encodeURIComponent(t("welcomeDemoMessage"))}`;
  const paragraphs = [t("welcomeP1"), t("welcomeP2"), t("welcomeP3"), t("welcomeP4")];
  const signoff = [t("welcomeSignoff"), t("welcomeSignature")];
  return {
    subject: t("welcomeSubject"),
    text: [...paragraphs.flatMap((p) => [p, ""]), ...signoff, "", `${t("welcomeCta")}: ${demoUrl}`].join("\n"),
    html: [...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`), `<p>${signoff.map(escapeHtml).join("<br>")}</p>`, `<p>${button(demoUrl, escapeHtml(t("welcomeCta")))}</p>`].join(""),
  };
}
