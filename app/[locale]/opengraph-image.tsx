import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Leadta";

const copy = {
  es: { title: "Encontrá negocios para contactar", sub: "Leads locales por rubro y zona, con contacto, redes y dolores detectados. Exportá a CSV o XLSX." },
  en: { title: "Find businesses to contact", sub: "Local leads by industry and area, with contact data, socials and detected pain points. Export to CSV or XLSX." },
};

// Paleta de AGENTS.md; ImageResponse usa Geist como fuente por defecto.
export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = locale === "en" ? copy.en : copy.es;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#171918", color: "#fafbf8" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 40, fontWeight: 700 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: "#c9e94f" }} />
          leadta
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>{t.title}</div>
          <div style={{ fontSize: 30, lineHeight: 1.35, color: "#a2a8a0", maxWidth: 960 }}>{t.sub}</div>
        </div>
        <div style={{ display: "flex", height: 8, width: 160, background: "#c9e94f", borderRadius: 4 }} />
      </div>
    ),
    size,
  );
}
