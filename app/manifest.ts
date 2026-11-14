import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Leadta",
    short_name: "Leadta",
    description: "Encontrá negocios locales para contactar, con datos de contacto y dolores detectados.",
    start_url: "/",
    display: "standalone",
    background_color: "#eaede8",
    theme_color: "#202320",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
