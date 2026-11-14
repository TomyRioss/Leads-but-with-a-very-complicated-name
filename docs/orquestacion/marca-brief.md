# Brief de identidad de marca (ORQ-1-0138 a 0142)

Pedido del usuario: "amoldá todas las funcionalidades de leadta a que tengan más identidad de la marca".

**Referencia de marca = la landing** (`app/landing/*.tsx`, `landing.css`) y lo ya rediseñado en Lead Suite/Leadtita (encabezado "Registrá tus contactos." con punto lime, sugerencias con ícono, ítem Leadtita destacado). Tokens y tipografía: AGENTS.md (Geist Sans, `--ash-*`, `--lime`, `--lime-dark`, `--paper`, `--ink`, `--muted`, `--line`; fondo `--ash-100`; blanco limitado).

Rasgos a llevar a cada pantalla:
- **Títulos de página** con la voz de la landing: Geist con peso fuerte y tracking negativo (≈ 620–700, -0.03em), punto lime al final como el logo "Leadta." cuando sea un título principal; subtítulo en `--muted`, corto y en voseo.
- **Acento lime con intención**: CTA primarios, estado activo, datos clave/números destacados; nunca lime en todo. Grises genéricos → `--ash-*`.
- **Superficies**: cards `--paper` sobre `--ash-100`, borde `--line`, radios y sombras consistentes con la landing; jerarquía por tamaño/peso, no por cajas anidadas.
- **Controles**: segmentados `.filter-segment` (activo lime), botones primario lime / secundario `.auth-secondary-button`, inputs como los de la landing/auth.
- **Estados vacíos y de carga** con personalidad de marca (mensaje corto en voseo + acción), no "Sin datos".
- **Íconos** lucide consistentes (y react-icons solo para marcas de redes), tamaños 16/18/20.
- **Microcopy**: voseo rioplatense, directo, sin jerga.
- Nada de SVG a mano, nada de colores hardcodeados, sin side-tabs (borde lateral de color) como decoración, sin mencionar Google Maps, accesibilidad AA y foco visible, responsive 360–1280.

Proceso: usá las skills impeccable y frontend-design (auditar → aplicar), capturas antes/después en `docs/qa-mobile/marca-<area>-{antes,despues}-{360,1280}.png` con la cuenta de prueba, y `npx tsc --noEmit` + `npx eslint` de lo tocado en exit 0. Cambios de comportamiento: ninguno (solo identidad visual y copy), salvo que algo esté roto (reportalo).
