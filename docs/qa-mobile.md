# QA móvil (ORQ-1-0107), 2026-11-13

Método: Playwright headless (Chromium) contra `http://localhost:3000`, viewports 360×740, 390×844 y 768×1024, con `isMobile` y `hasTouch`. En cada página se midió: overflow horizontal del documento, elementos que salen del viewport sin un contenedor scrolleable, targets táctiles menores a 44px, texto recortado, errores de consola y requests fallidos. Después se recorrieron flujos interactivos a 360 y 390. Las capturas están en `docs/qa-mobile/`: `<ruta>-<ancho>.png` son página completa e `i-<paso>-<ancho>.png` son pasos de interacción.

No se lanzaron búsquedas ni análisis. El borrado se abrió solo hasta la barra de confirmación, sin confirmar. No se envió feedback real.

## Resumen

| Prioridad | Cantidad |
|---|---|
| Crítico | 2 |
| Alto | 3 |
| Medio | 5 |
| Bajo | 4 |
| **Total** | **14** |

No hay overflow horizontal a nivel documento en ninguna página ni viewport: `scrollWidth` es igual al ancho del viewport en todos los casos.

## Hallazgos

| # | Prioridad | Página | Viewport | Problema | Pasos | Evidencia | Archivo/regla probable | Fix sugerido |
|---|---|---|---|---|---|---|---|---|
| 1 | Crítico | /buscar, /historial (tabla de leads) | todos (también desktop 1280) | Las filas con tags de dolor miden ~1800px de alto (1811 y 1877px las dos primeras). La columna de análisis queda tan angosta que los tags parten palabra por palabra o letra por letra. A 360 la tabla muestra una pantalla en blanco antes del primer dato. | Loguearse → /buscar con lote existente → bajar a "Leads encontrados" | `buscar-360.png`, `i-table-360.png`, `historial-360.png` | `app/globals.css:851` `.pain-tag { overflow-wrap: anywhere }` + `:850 .pain-tags` dentro de `.compact-lead-table .analysis-cell` (`:789`), sin ancho mínimo | Dar `min-width` (~220–260px) a `.compact-lead-table .analysis-cell`, y en `.pain-tag` usar `overflow-wrap: normal; white-space: nowrap` (o `break-word`) |
| 2 | Crítico | /lead-suite | todos | El dashboard falla con 502 y muestra al usuario el error crudo de PocketBase: `PocketBase 404: {"data":{},"message":"Missing collection context."...}` | /lead-suite logueado | `i-lead-suite-view-360.png`, `lead-suite-360.png` | `GET /api/lead-suite/dashboard` → colecciones `lead_contacts` / `lead_suite_reports` sin migrar; el texto del error no pasa por `public-error.ts` | Aplicar la migración (fuera de este QA). Mostrar un mensaje genérico traducido, no el JSON de PocketBase |
| 3 | Alto | /blog, /en/blog | todos | La página falla: `pageerror: PocketBase responded 404: Missing collection context.` y se ve la pantalla de error de Next con el botón "Reload". En un primer intento `./blog.css` no existía y el dev server devolvió 500 en **todas** las rutas hasta que apareció el archivo. | /blog | `blog-360.png`, `en_blog-360.png` | `app/[locale]/blog/page.tsx` (colección de blog sin migrar) | Manejar la colección ausente con un estado vacío o 404 controlado. Coordinar el orden de creación de archivos entre workers |
| 4 | Alto | /historial | 360, 390 | En la tabla combinada, con columnas angostas, nombres y celdas de varias líneas generan filas de 200–300px. Solo se ven 2–3 leads por pantalla. | /historial → "Tabla combinada" | `historial-360.png` | Misma causa que el #1 (`.analysis-cell` / `.pain-tag`) + columna Nombre sin `min-width` | Mismo fix que el #1. `min-width` ~160px en la columna nombre |
| 5 | Alto | /owner | todos | Con la cuenta de prueba, /owner redirige a /buscar (`/api/owner/me` responde 403). No se pudieron auditar las secciones de owner (overview, users, searches, payments, subscriptions, audit, blog, feedback). | /owner logueado | `owner-360.png` | Permisos: la cuenta de prueba no es owner | Pasar credenciales de owner para completar el QA de /owner |
| 6 | Medio | /buscar, /historial | 360, 390 | Targets táctiles chicos: `.analysis-cell-trigger` "No analizado" 72×18, "Enriquecer" 37×36, `.whatsapp-contact-trigger` 75×36, toggle "Tabla combinada / Por lote" 36px de alto | Ver tabla | `historial-360.png` | `app/globals.css:839` `.analysis-cell-trigger`, `.whatsapp-contact-trigger` | `min-height: 44px` en pointer coarse (`@media (pointer: coarse)`) |
| 7 | Medio | Landing | 360, 390 | Botón "Analizar dolor con IA" (`.lp-pain-btn`) de 178×32. Cierre del globo de WhatsApp (`.wa-close`) de 28×28. Link "Blog" de 30px de ancho. | Landing | `es-360.png`, `i-landing-wa-360.png` | `app/landing/*.css` `.lp-pain-btn`, `.wa-close` | Subir a 44px de alto o ampliar el área táctil con padding o pseudo-área |
| 8 | Medio | Landing | 360 | En el feed del hero los nombres y dolores se cortan con ellipsis ("Veterinaria Huellitas del Sur", "Turnos difíciles de conseguir"). El globo de WhatsApp tapa parte de la tarjeta del hero. | Landing, primer viewport | `es-360.png` | `.lp-feed-name`, `.lp-feed-pain`, `whatsapp-contact` | Permitir 2 líneas (`-webkit-line-clamp: 2`). Retrasar o reubicar el globo en mobile |
| 9 | Medio | /buscar | 360, 390 | El hint de filtros (`.filter-summary-hint`) y el meta del negocio (`.compact-business-meta`, rubro · rating · reseñas) se truncan. El rating y la cantidad de reseñas quedan ocultos. | /buscar | `buscar-360.png` | `.filter-summary-hint`, `.compact-business-meta` | Wrap en 2 líneas o mover rating a línea propia |
| 10 | Medio | /buscar (tabla) | 360 | La tabla mide 1131px dentro de `.table-frame` (334px, scroll horizontal controlado: OK). Pero la columna inicial no es sticky: al scrollear se pierde qué negocio es cada fila. | Scroll horizontal en la tabla | `i-table-360.png` | `.compact-lead-table` | Hacer sticky la columna checkbox + negocio en mobile |
| 11 | Bajo | Landing, /pricing, /verificar | 360, 390 | Selector de idioma (`.language-trigger`) de 42px de alto, y "Ingresar" / `.pricing-nav-link` de 40–42px | Header | `es-360.png`, `pricing-360.png` | `app/language-switcher.css`, landing/pricing nav | `min-height: 44px` |
| 12 | Bajo | Login (/buscar sin sesión) | 360, 390 | El toggle "Mostrar contraseña" mide 36px de alto. El logo "Lt" mide 37×43. | /buscar deslogueado | `buscar-360.png` (sesión anónima, primera corrida) | `app/auth-steps.css` `.password-toggle`, `.auth-brand-link` | 44px |
| 13 | Bajo | Landing | 360 | Error de dev en consola: `Route "/[locale]": Could not validate instant because an error prevented the target segment from rendering. at LeadRecord`. Apareció en la primera carga. | Landing en frío | consola | `app/landing/lead-record.tsx` | Revisar el render de `LeadRecord` (posible acceso a datos sin fallback) |
| 14 | Bajo | /buscar | todos | `GET /api/geography?level=countries` termina en `net::ERR_ABORTED` en cada carga, probablemente porque se dispara dos veces y se aborta una. No rompe la UI. | Cargar /buscar | requests | `app/[locale]/buscar/page.tsx` (fetch de países en effect) | Verificar que el abort sea intencional (StrictMode). Si no, deduplicar el fetch |

## Verificado sin problemas

- Sidebar móvil: abre como panel a pantalla completa con foco en "Cerrar" y cierra bien (captura omitida: muestra el email de la cuenta de prueba).
- Modal de Comentarios: entra en el viewport (328×544 a 360) y la UI de radio y textarea se ve correcta (`i-feedback-360.png`). No se envió.
- Diálogo de propuesta/dolor (`.analysis-popover`): entra en el viewport (bottom sheet 360×622) y el botón cerrar mide 40×40 (`i-proposal-360.png`).
- Barra de confirmación de borrado: visible y usable, con "Cancelar" y "Eliminar" a 44px (`i-delete-confirm-shown-360.png`). No se confirmó.
- FAQ (details), selector de idioma, CTA y WhatsApp flotante de la landing funcionan (`i-landing-*.png`).
- /pricing, /verificar, landing es/en: sin overflow ni errores de consola en ningún viewport.
- 768×1024 (tablet): sin overflow. Valen los mismos problemas de tabla #1 y #4.

## No cubierto o parcial

- **/owner**: la cuenta de prueba no tiene rol owner (#5).
- **Referidos**: no se encontró el disparador en el menú móvil con el selector usado. Revisar a mano o con una cuenta que tenga referidos visibles.
- **"Mostrar datos completos" y popovers de celda**: el click automatizado no encontró el control. El toggle visible es "Ver todos los datos" (`buscar-360.png`) y no se abrió.
- **Teclado virtual**: no se puede emular en headless. Se simuló reduciendo la altura del viewport con el modal de Comentarios abierto, pero el paso falló (timeout de foco tras cerrar el modal).
- **Contraste / CLS**: sin mediciones numéricas, solo inspección visual de las capturas. No se observó CLS visible.

## Errores de consola y requests fallidos

- `PocketBase responded 404: Missing collection context.` en /blog y en /api/lead-suite/dashboard (502).
- `Module not found: Can't resolve './blog.css'` (transitorio, tiró todo el dev server con 500).
- `Route "/[locale]": Could not validate instant ... at LeadRecord` en la landing.
- `403 /api/owner/me` (esperable con una cuenta no owner).
- `net::ERR_ABORTED` en `/api/geography?level=countries`, `/api/auth/me` y `/api/status` (aborts de navegación o efectos).

## Correcciones (ORQ-1-0111), 2026-11-13

Capturas "después" en `docs/qa-mobile/after/` (360/390/768 para /buscar e /historial; 360/390/768/1280 para la landing es/en). Las de /buscar e /historial a 1280 no se guardaron porque muestran el email de la cuenta de prueba en el sidebar. Se verificaron por medición: no hay overflow y las filas miden igual que en móvil. Verificación: `npx tsc --noEmit` exit 0 y `npx eslint "app/[locale]/buscar" "app/[locale]/historial" app/landing` exit 0.

| # | Estado | Cambio | Medición antes → después |
|---|---|---|---|
| 1 | Resuelto | `app/globals.css`: anchos para las 6 columnas de `.compact-lead-table`. La 6.ª, "Dolor", no tenía ancho y con `table-layout: fixed` quedaba en 0px; esa era la causa raíz. `min-width` de la tabla pasa a 1080px. `.pain-tag` usa `overflow-wrap: break-word` (corta por palabra). `.pain-tags` en tablas tiene `max-height: 104px`; el detalle completo sigue en el popover. | /buscar: columna Dolor 0px → 281px; filas 1811/1877px → 162/162px (360 y 1280). `before: buscar-360.png`, `after: after/buscar-360.png` |
| 4 | Resuelto | `.history-compact-table`: `min-width` 1080px (antes 0, comprimía todo al ancho del contenedor), `td` con `min-width: 110px` y `overflow-wrap: break-word`, columna de dolores con `min-width: 240px`. En ≤700px, la columna sticky de fecha baja su `min-width` de 205px a 104px. | /historial 360: filas 348/348px → 121/121px. `before: historial-360.png`, `after: after/historial-360.png` |
| 10 | Pendiente | Columna negocio sticky en /buscar: no aplicada. Selección (72px) + negocio (~238px) ocuparían casi todo el contenedor de 334px a 360 y taparían el resto de la tabla. /historial ya tiene la primera columna sticky. | — |
| 6 | Resuelto | `@media (pointer: coarse)`: `.analysis-cell-trigger` con `min-height: 44px` (padding vertical), `.is-enrich` con 44px y `.whatsapp-contact-trigger` con `inline-flex` y 44px. | Los triggers de la tabla ya no aparecen en el chequeo de <44px |
| 7 | Resuelto | `.wa-close::before` (inset -8px → 44×44) y `.lp-pain-btn::after` (inset -6px vertical → 44px) en pointer coarse, sin cambio visual. | El chequeo mide la caja visual, que no cambia. El área táctil efectiva es 44px |
| 8 | Resuelto | `.lp-feed-name` y `.lp-feed-pain` pasan de ellipsis en 1 línea a `line-clamp: 2`. | Textos recortados en landing 360: 5 → 0 (es) |
| 9 | Resuelto (parcial) | `.compact-business-meta`: `line-clamp: 2` en vez de 1 línea con ellipsis. Rating y reseñas ahora se ven. `.filter-summary-hint` no se tocó (resumen de una línea; el detalle está al expandir). | Ver `after/buscar-360.png` |
| 13 | No reproducible | "Could not validate `instant` … LeadRecord" (`next/dist/server/app-render/dynamic-rendering-validation.js:508`: un error impidió renderizar el segmento). No aparece en 3 cargas en frío de / y /en. Coincidió con la ventana en que faltaba `blog.css` y todo el module graph del dev server fallaba. `LeadRecord` no tiene accesos dinámicos. | Consola de la landing: solo el warning de PostHog por user agent bot |
| 11, 12 | Pendiente | Selector de idioma (42px), "Ingresar" (40px), toggle de contraseña (36px), "Tabla unificada / Por lote" (36px) y paginación del historial (30px). Están en `app/language-switcher.css`, `app/auth-steps.css` y en reglas de globals que no se tocaron por alcance. | — |
| 2, 3, 5, 14 | Fuera de alcance | Lead Suite/blog (migraciones), owner (cuenta no owner), abort de `/api/geography`. | — |
