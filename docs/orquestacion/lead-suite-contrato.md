# Lead Suite: contrato compartido (ORQ-1-0079 a 0083)

Lead Suite permite al usuario registrar los leads que ya contactó (hablándole a un modelo en lenguaje natural: "ya le hablé a Inmobiliaria X por WhatsApp hoy 15:30, le mandé: ..."), ver un dashboard con métricas y recibir un reporte semanal por email con lo que hizo y mejoras basadas en datos. Accesible desde el sidebar en `/lead-suite`. Uso gratis (no cobra créditos).

Decisiones del usuario: migración nueva permitida (solo escribir el archivo, NUNCA ejecutarla ni correr comandos de base); chat como panel dentro de /lead-suite; reporte por email (Resend) + Vercel Cron; gratis.

## Datos (PocketBase, migración `pb_migrations/1794350000_add_lead_suite.js`)

- Colección `lead_contacts` (base): `lead` (relation leads, required, cascadeDelete), `user` (relation users, required, cascadeDelete), `channel` (select: whatsapp, email, phone, instagram, linkedin, in_person, other), `message` (text, max 4000), `status` (select: contacted, replied, meeting, won, lost), `notes` (text, max 2000), `contacted_at` (date, required), `created`/`updated` autodate. Índices: `(user, contacted_at)`, `(lead, contacted_at)`. Reglas: list/view `user = @request.auth.id`; create/update/delete `null` (solo servidor).
- Colección `lead_suite_reports` (base): `user` (relation users, required, cascadeDelete), `week_start` (date, required), `summary` (text), `suggestions` (json), `metrics` (json), `sent_at` (date), autodates. Índice único `(user, week_start)`. Mismas reglas que arriba.
- En `leads`: `contact_status` (select: not_contacted, contacted, replied, meeting, won, lost; vacío = not_contacted) y `last_contacted_at` (date). Clientes no pueden escribirlos (guard en update/create rule como en la migración de referrals).
- Down migration que revierta todo.

## Tipos compartidos: `lib/lead-suite.ts` (sin imports de servidor)

```ts
export const CONTACT_CHANNELS = ["whatsapp","email","phone","instagram","linkedin","in_person","other"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_STATUSES = ["contacted","replied","meeting","won","lost"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type LeadContactStatus = "not_contacted" | ContactStatus;

export interface LeadMatch { id: string; name: string; category: string; city: string; phone: string; website: string; batchId: string; contactStatus: LeadContactStatus; lastContactedAt: string | null; }
export interface LeadContact { id: string; leadId: string; leadName: string; channel: ContactChannel; message: string; status: ContactStatus; notes: string; contactedAt: string; created: string; }
export interface RecordContactInput { leadId: string; channel: ContactChannel; message: string; contactedAt: string; status?: ContactStatus; notes?: string; }
export interface LeadSuiteMetrics {
  range: { from: string; to: string };
  totalContactedLeads: number;          // leads distintos con >=1 contacto (histórico)
  contactsInRange: number;
  leadsContactedInRange: number;
  byChannel: Record<ContactChannel, number>;
  byStatus: Record<LeadContactStatus, number>;   // estado actual de los leads contactados
  byWeek: { weekStart: string; count: number }[]; // últimas 8 semanas, lunes ISO
  byCategory: { category: string; count: number }[]; // top 8
  byHour: number[];                     // 24 posiciones, contactos por hora local del contacted_at
  replyRate: number;                    // 0..1: leads en replied|meeting|won / leads contactados
  pendingFollowUps: LeadMatch[];        // contactados hace >3 días sin respuesta, máx 10
}
export interface WeeklyReport { weekStart: string; summary: string; suggestions: string[]; metrics: LeadSuiteMetrics; sentAt: string | null; }
```

## Repositorio: `lib/server/lead-suite.ts` (usa `pocketBaseFetch` de lib/server/pocketbase.ts)

Todas verifican pertenencia: el lead pertenece al usuario vía `lead.batch.user` (o la relación real equivalente). Nunca confían en ids del cliente sin chequear.

```ts
export async function findUserLeads(userId: string, query: string, limit?: number): Promise<LeadMatch[]>; // búsqueda por nombre (contains, case-insensitive), máx 10
export async function getUserLead(userId: string, leadId: string): Promise<LeadMatch | null>;
export async function recordLeadContact(userId: string, input: RecordContactInput): Promise<LeadContact>; // crea lead_contacts y actualiza leads.contact_status/last_contacted_at
export async function updateLeadContactStatus(userId: string, leadId: string, status: ContactStatus): Promise<LeadMatch>;
export async function listLeadContacts(userId: string, opts: { leadId?: string; from?: string; to?: string; page?: number; perPage?: number }): Promise<{ items: LeadContact[]; page: number; totalPages: number }>;
export async function getLeadSuiteMetrics(userId: string, range: { from: string; to: string }): Promise<LeadSuiteMetrics>;
export async function listWeeklyReportUsers(page: number): Promise<{ items: { id: string; email: string; name: string; locale: string }[]; totalPages: number }>; // usuarios con >=1 contacto en los últimos 30 días
export async function saveWeeklyReport(userId: string, report: WeeklyReport): Promise<void>; // upsert por (user, week_start)
export async function getLatestWeeklyReport(userId: string): Promise<WeeklyReport | null>;
```

## API (rutas)

- `POST /api/lead-suite/chat` (ORQ-1-0080): body `{ messages: {role:"user"|"assistant", content:string}[] }` (máx 20 mensajes, 2000 chars c/u). Respuesta `{ reply: string, actions: { type: "contact_recorded" | "status_updated" | "lead_candidates"; contact?: LeadContact; lead?: LeadMatch; candidates?: LeadMatch[] }[] }`.
- `GET /api/lead-suite/dashboard?from=&to=` (ORQ-1-0081): `{ metrics: LeadSuiteMetrics, recentContacts: LeadContact[], latestReport: WeeklyReport | null }`.
- `GET /api/lead-suite/weekly-report` (ORQ-1-0082): cron, protegido con `Authorization: Bearer ${CRON_SECRET}`.

Auth en rutas de usuario: `getCurrentUser(request)` de lib/server/auth.ts; 401 sin sesión. Errores con el patrón existente (lib/server/public-error.ts).

## i18n

Namespace `leadSuite` → `messages/lead-suite/{es,en}.json` (dueño 0081). Namespace `leadSuiteChat` → `messages/lead-suite-chat/{es,en}.json` (dueño 0083). El registro de ambos namespaces en el loader lo hace 0081.

## UI

Paleta y tipografía de AGENTS.md (tokens existentes en app/globals.css, Geist). Iconos con la librería ya instalada. Sin SVG a mano. Server Components por defecto salvo donde haga falta estado.
