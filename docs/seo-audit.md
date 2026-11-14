# Auditoría SEO: Leadta (2026-11-13)

Alcance: App Router de Next 16, next-intl con `localePrefix: "as-needed"` (español sin prefijo, inglés bajo `/en`) y dominio `https://leadta.app` (`APP_URL`). Estados: **[aplicado]** = resuelto en ORQ-1-0106; **[pendiente]** = toca archivos de otros dueños, incluye el fix exacto.

## Crítico

1. **No había robots.txt** (`app/robots.ts` no existía). Los rastreadores podían recorrer `/api/*` y las páginas privadas. **[aplicado]** Ahora `app/robots.ts` hace `disallow` de `/api/`, `/buscar`, `/historial`, `/lead-suite`, `/owner`, `/verificar` y de sus versiones `/en/…`, y declara `sitemap: <origin>/sitemap.xml`.
2. **No había sitemap** (`app/sitemap.ts`). **[aplicado]** Ahora lista landing, `/pricing` y `/blog` con `alternates.languages` (es, en, x-default), más cada post publicado vía `listAllPublishedSlugs()`. Si el blog falla, se publican igual las páginas fijas (try/catch).
3. **Sin canonical ni hreflang** en las páginas públicas (`app/[locale]/page.tsx:16`, `app/[locale]/pricing/page.tsx:6`). `/` y `/en` competían sin marcar la relación. **[aplicado]** `alternates.canonical` y `languages` (es/en/x-default) en landing y pricing, con `metadataBase` en el layout.

## Alto

4. **Sin datos estructurados.** **[aplicado]** `app/[locale]/page.tsx` emite JSON-LD `@graph` con Organization, WebSite, SoftwareApplication (Offer de 15 USD que apunta a /pricing) y FAQPage generado desde `Landing.faq.items`, así que se mantiene sincronizado con la FAQ visible. `<` se escapa como `<`, según la doc de Next.
5. **Sin OpenGraph ni Twitter** (`app/[locale]/layout.tsx:21`). **[aplicado]** Defaults en el layout (siteName, type, `og:locale` es_AR/en_US, `twitter:card summary`) y OG propio en landing y pricing.
6. **Sin imagen OG.** Los shares salen sin preview. **[resuelto ORQ-1-0110]** `app/[locale]/opengraph-image.tsx` (1200×630, paleta AGENTS.md, Geist, copy es/en). Restan dos cosas: `og:image` en español apunta a `/es/opengraph-image`, que el proxy de next-intl redirige con un 307 a `/opengraph-image` (200). Para evitar el salto, excluir `opengraph-image` del matcher en `proxy.ts`. Y `twitter.card` sigue en `summary`: pasarlo a `summary_large_image` agregando `twitter-image.tsx`.
7. **`/buscar` y `/historial` sin `noindex`.** Son `"use client"` y no pueden exportar `metadata`. robots.txt bloquea el rastreo, pero si alguien enlaza la URL igual puede indexarse sin snippet. **[resuelto ORQ-1-0110]** Ahora hay un `layout.tsx` con noindex en buscar, historial, lead-suite, owner y verificar. Fix original: `app/[locale]/buscar/layout.tsx` y `app/[locale]/historial/layout.tsx` con `export const metadata = { robots: { index: false, follow: false } }; export default function L({ children }) { return children; }`. `/owner`, `/lead-suite` y `/verificar` ya tienen noindex.
8. **No había link interno al blog.** **[aplicado]** "Blog" en el header (`app/landing/header.tsx:16`) y en el footer (`app/landing/footer.tsx:14`), traducido en `messages/landing/{es,en}.json`.

## Medio

9. **El H1 de `/pricing` es el precio** (`app/pricing/pricing-sections.tsx:21`, `<h1>$15 USD/mes</h1>`). Es un H1 pobre para la intención "precios de Leadta". **[resuelto ORQ-1-0110]** H1 `sr-only` con "Planes y precios" (de `pageTitle`); el precio pasó a `<p class="price-amount">`, sin cambio visual. Fix original: usar un H1 textual ("Planes y precios de Leadta") y pasar el precio a `<p>`. La landing tiene un único H1 en `app/landing/hero.tsx`.
10. **El layout serializa todos los mensajes al cliente** (`app/[locale]/layout.tsx:39`, ~70 KB por locale). Suma peso de JS/HTML a la landing, que es server-rendered, y puede afectar LCP/INP. **[no aplicado, riesgoso]** Los client components de buscar, owner y lead-suite usan muchos namespaces, y un recorte incompleto rompe en runtime sin que tsc lo detecte. Requiere un inventario por ruta. Fix propuesto: pasar a `NextIntlClientProvider` solo los namespaces que usan los client components (`pick(messages, [...])`) o moverlo a los layouts de las rutas privadas.
11. **Títulos:** `Meta.title` del layout ("Leadta | Buscador de leads") queda como fallback y está bien. Landing y pricing tienen títulos y descripciones únicos por idioma. No se usa `title.template`, porque los títulos ya incluyen "| Leadta" y saldría duplicado.
12. **Sin `not-found.tsx` propio.** Next devuelve su 404 por defecto, que tiene status 404 correcto pero sin enlaces de vuelta. **[resuelto ORQ-1-0110]** `app/not-found.tsx` (bilingüe, noindex, estilos inline porque fuera de [locale] no hay layout) y `app/[locale]/not-found.tsx` que lo reexporta. Las rutas inexistentes devuelven 404 con la marca. Fix original: `app/[locale]/not-found.tsx` con links a `/`, `/pricing` y `/blog`.

## Bajo

13. **Manifest.** **[aplicado]** `app/manifest.ts` con nombre, colores de marca (`--ash-100`/`--ink`) y favicon. Faltan íconos PNG 192/512 en `public/`.
14. **next.config.** **[aplicado]** `poweredByHeader: false`. La compresión ya viene activada por defecto. `public/` tiene SVG de plantilla sin usar (`next.svg`, `vercel.svg`, etc.), que se pueden borrar.
15. **Imágenes y fuentes:** la landing no usa `<img>` (no hay `alt` faltantes) y Geist se carga con `next/font` (sin CLS por fuentes). Correcto.
16. **i18n:** `<html lang={locale}>` es correcto y el proxy de next-intl maneja la detección. hreflang y x-default ya quedan cubiertos por el punto 3.
17. **Buscadores generativos (ai-seo):** la entidad queda clara por Organization/SoftwareApplication y la FAQ está en texto plano. **[resuelto ORQ-1-0110]** `public/llms.txt` con una descripción breve del producto, planes y links a /pricing y /blog. Nunca mencionar Google Maps en textos ni metadata: verificado, no aparece.
