# Gmail + Google Calendar para Leadtita: contrato (ORQ-1-0152 a 0155)

Extiende el conector de docs/orquestacion/google-contrato.md (misma tabla `google_connections`, sin migración nueva salvo que haga falta un campo; si hace falta, `ask`).

## Permisos (consentimiento incremental)
- Base (ya existe): `openid email drive.file`.
- **Gmail**: `https://www.googleapis.com/auth/gmail.send` (sensible, sin CASA). Solo enviar; nunca leer la casilla.
- **Calendar**: `https://www.googleapis.com/auth/calendar.events` (sensible). Crear/editar eventos del calendario principal del usuario.
- El usuario activa cada uno por separado desde /integraciones ("Conectar Gmail", "Conectar Calendar"); la ruta connect acepta `?features=gmail,calendar` y pide `include_granted_scopes=true` con los scopes acumulados. `scopes` guardados reflejan lo concedido; helpers `hasGmail(userId)`, `hasCalendar(userId)`.

## Servidor
- `lib/server/google-gmail.ts`: `sendGmail(userId, { to, subject, text, html?, replyTo? }) -> { id, threadId }` (MIME RFC 2822 con UTF-8 en headers codificados, base64url, POST users/me/messages/send), validación de email, límites (asunto ≤ 200, cuerpo ≤ 20.000), pie opcional de baja, errores tipados (`GmailNotConnectedError`, `GmailQuotaError`). Throttle de tandas: `sendGmailBatch(userId, items, { delayMs: 20000, max: 50 })` en serie con espera, cortando ante cuota.
- `lib/server/google-calendar.ts`: `createCalendarEvent(userId, { title, start, end, timeZone, description?, attendees?: string[], meet?: boolean }) -> { id, htmlLink, meetLink? }` (events.insert en `primary`, `sendUpdates=all` si hay invitados, `conferenceData` con `createRequest` si meet), `updateCalendarEvent`, `deleteCalendarEvent`.
- Ambos usan `getValidAccessToken` de lib/server/google-connections.ts.

## Leadtita
- Herramientas con tarjeta Sí/No firmada (mecanismo existente): `propose_send_email` (borrador editable en la tarjeta: para, asunto, cuerpo, usando dolores/propuestas del lead), `propose_send_email_batch` (lote: vista previa de N borradores, una confirmación, envío espaciado, reporte final), `propose_create_meeting` (lead, fecha/hora, duración, zona, con Meet opcional, invitar al email del lead si existe).
- Al confirmar: se registra automáticamente en Lead Suite (`recordLeadContact`: canal email y mensaje enviado; para reunión, estado `meeting` + nota con link del evento).
- Si falta permiso, Leadtita ofrece "Conectar Gmail/Calendar" (botón al flujo incremental).

## Lead Suite
- En el formulario de contacto, cuando el estado es **Reunión**: opción "Agendar en Google Calendar" (fecha/hora/duración, invitar al lead) que crea el evento al guardar; link al evento en el historial del contacto.

## Legal (0155)
Páginas públicas `/terminos` y `/privacidad` (es/en) requeridas por Google para verificar la app: qué datos de Google se usan (Drive: solo archivos elegidos; Gmail: solo enviar; Calendar: crear eventos), que no se venden ni se usan para entrenar modelos, retención y borrado al desconectar, cumplimiento de la Google API Services User Data Policy (Limited Use), contacto. Links en el footer, en el popup de registro y en /integraciones.

UX: marca leadta, i18n es/en, accesible, sin SVG a mano (íconos react-icons `SiGmail`/`SiGooglecalendar` o lucide `Mail`/`CalendarPlus`).
