# Auditoría de marca (ORQ-1-0108)

Referencia: tokens de AGENTS.md (`--ash-*`, `--lime`, `--lime-dark`, `--paper`, `--ink`, `--muted`, `--line`).

## Grep de colores hardcodeados (#hex / rgb / hsl)

Alcance: lead-suite, historial, buscar, feedback-dialog.css, referral-dialog.css/tsx, cell-details-popover.tsx.

- Antes: 5 coincidencias (feedback-dialog.css:8, :11; referral-dialog.css:2, :26 y la línea del botón de error).
- Después: 0 coincidencias.

## Corregido

- `app/[locale]/lead-suite/dashboard.tsx:196`: el selector de rango era un `ls-segment` propio con el activo en negro (`--ash-900`). Ahora es `.filter-segments` / `.filter-segment` (radios, con el activo en lime), igual que /buscar.
- `app/[locale]/lead-suite/dashboard.tsx:108` y `:205`: los botones Reintentar y Refrescar ahora usan `.auth-secondary-button`. `lead-suite.css:8-10` solo ajusta el ancho y el foco.
- `app/[locale]/lead-suite/lead-suite.css`: se eliminaron las reglas `.ls-segment*` y los estilos propios de `.ls-icon-button` / `.ls-button`.
- `app/[locale]/lead-suite/page.tsx:5`: importa `auth-steps.css`, que define `.auth-secondary-button`.
- `app/[locale]/lead-suite/chat-panel.css`: la burbuja del usuario pasó de negro (`--ash-900`) a `--lime` con borde `--lime-dark`. El foco ahora es `3px --ash-950`, como el resto de la app.
- `app/referral-dialog.css:1`: se aplicó el centrado de ORQ-1-0102 (`position: fixed; inset: 0; margin: auto; height: fit-content`) contra el reset de margin de Tailwind.
- `app/referral-dialog.css:2, :26` y `app/feedback-dialog.css:8, :11`: los `rgb()` pasaron a `color-mix()` sobre `--ash-950` / `--lime`.
- `app/referral-dialog.tsx:6`: importa `auth-steps.css`. Sus botones de compartir usan `.auth-secondary-button` y en las páginas sin el formulario de auth quedaban sin estilo.
- historial, buscar y cell-details-popover: sin hallazgos. Ya usan los tokens y las clases existentes.

## Pendiente (fuera de mis archivos o requiere `ask`)

- **Token de peligro:** no existe. Propuesta: `--danger: #b3261e` y `--danger-dark: #8f1d17` en `:root`. Hay que reemplazar en `globals.css`:
  - `.danger-button` (751-752) y `.lead-delete-button:hover` (757);
  - `.signout-menu-item` / `.side-nav-signout` (`#b42318`, `#fff1f0`; líneas 185-187 y 1102-1103);
  - `.status-message.is-error` (488-489).
- **Token de éxito:** no existe. `.status-message.is-success` (490-491) usa verdes de Tailwind. Propuesta: `--success` en lugar de esos verdes.
- **WhatsApp:** `globals.css` 896-912 usa `#168a50` / `#0c6538`. Propuesta: token `--whatsapp` o usar `--lime-dark`.
- **Enriquecer con IA:** `globals.css` 809-810 y 841-842 usan violetas fuera de la paleta. Hay que decidir si se mantiene como acento IA o se pasa a lime.
- **Redes sociales:** `.social-pill` (780-787) usa los colores oficiales de cada red. Es aceptable y se deja.
- **Sombras:** varias sombras `rgb(23 25 24 / x%)` y los anillos `rgb(201 233 79 / 30%)` (369, 412, 945, 952) podrían pasar a `color-mix()`. Es cosmético.
- **Landing, owner, blog:** sin auditar (los editan otros workers). Ejemplo visto: `globals.css:531` con `#d6f673` en el hover de `.landing-button-primary`.
