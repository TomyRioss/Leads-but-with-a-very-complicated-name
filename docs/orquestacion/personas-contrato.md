# Buscar Personas: contrato compartido (ORQ-1-0112 a 0116)

Base: docs/client-feature.md. Decisiones del usuario: reusar lotes y leads (`kind = "person"`), actores Meta de Apify ACTIVADOS por defecto, 4 créditos por persona entregada (con al menos email o teléfono; el resto se devuelve), ítem propio en el sidebar. Migración autorizada: solo ESCRIBIR el archivo. Clave en `.env.local`: `SERPER_API_KEY` (ya cargada; nunca loguearla). Apify: `APIFY_TOKEN` existente.

## Datos: `pb_migrations/1794380000_add_people_search.js` (dueño 0112)
- `batches`: `kind` (select business|person; vacío = business), `query` (text, max 300), `plan` (json).
- `leads`: `kind` (select business|person; vacío = business), `role` (text, max 120), `location` (text, max 160), `whatsapp` (text, max 40), `source` (select serper|github|instagram|facebook|web), `source_url` (text, max 1000), `completeness` (number 0..4).
- Mismos guards de reglas que migraciones previas (clientes no escriben estos campos). Idempotente, con down.

## Tipos: `lib/people.ts` (dueño 0112, sin imports de servidor)
```ts
export const CREDITS_PER_PERSON = 4;
export type PersonSource = "serper" | "github" | "instagram" | "facebook" | "web";
export type ProfileType = "trade" | "commercial" | "technical" | "professional" | "freelance";
export interface PersonCandidate { name: string; role: string; location: string; phone: string; whatsapp: string; email: string; website: string; socialProfiles: Partial<Record<SocialNetwork, string>>; source: PersonSource; sourceUrl: string; snippet: string; isBusiness?: boolean; }
export interface PeopleSearchPlan { profileType: ProfileType; role: string; location: string; summary: string; webQueries: string[]; githubQuery: string | null; instagramQueries: string[]; facebookGroupQueries: string[]; }
export interface PeopleSearchRequest { query: string; location: string; count: number; locale: "es" | "en"; includeMeta?: boolean; } // count 1..25, includeMeta default true
export interface PeopleSearchResponse { batchId: string; plan: PeopleSearchPlan; delivered: number; charged: number; refunded: number; leads: Lead[]; }
export function completenessOf(p: Pick<PersonCandidate, "whatsapp" | "email" | "socialProfiles">, hasPains: boolean): number; // 0..4
export function hasContact(p: Pick<PersonCandidate, "phone" | "whatsapp" | "email">): boolean;
```
`SocialNetwork` y `Lead` de `lib/types.ts`.

## Servidor (`lib/server/people/`)
- `planner.ts` (0113): `planPeopleSearch(query: string, location: string, locale): Promise<PeopleSearchPlan>` con OpenRouter (mismo patrón que app/api/analysis/route.ts), salida JSON validada. Rechaza segmentos sensibles (edad, salud, pareja/vida privada, religión) lanzando `SensitiveSegmentError` con `suggestion` (reformulación: negocios que atienden a ese público). Queries web en el idioma/país de la ubicación, orientadas a personas independientes que publican contacto (ej. `"limpieza" "Palermo" whatsapp particular`, `-empresa -srl -sa`).
- `sources/serper.ts` (0113): `searchSerper(queries: string[], opts: { location: string; signal?: AbortSignal; perQuery?: number }): Promise<PersonCandidate[]>` (POST https://google.serper.dev/search, header X-API-KEY, concurrencia ≤3, timeout por llamada, extrae teléfono/email/wa.me del snippet con helpers de lib/server/contact-scrape.ts).
- `sources/github.ts` (0113): `searchGithub(plan: PeopleSearchPlan, opts: { signal?: AbortSignal; limit?: number }): Promise<PersonCandidate[]>` (API pública de búsqueda de usuarios + perfil; email solo si es público; token opcional `GITHUB_TOKEN`).
- `sources/meta.ts` (0114): `searchInstagram(plan, opts): Promise<PersonCandidate[]>` (apify/instagram-search-scraper → apify/instagram-scraper para perfiles: email/teléfono de cuentas business, bio link) y `searchFacebookGroups(plan, opts): Promise<PersonCandidate[]>` (apify/facebook-groups-scraper: posts con teléfono/WhatsApp). Mismo cliente/patrón de Apify que app/api/search/route.ts (run-sync-get-dataset-items), timeouts y límites de items para acotar costo.
- `enrich.ts` (0115): `enrichCandidates(c: PersonCandidate[], opts: { concurrency?: number; signal?: AbortSignal }): Promise<PersonCandidate[]>` → lee website/sourceUrl con `scrapeWebsite` (solo páginas personales, no marketplaces), completa email/teléfono/WhatsApp/redes, arma `whatsapp` desde celular cuando aplica, descarta empresas (`isBusiness`) y sin contacto, deduplica por email/teléfono/URL.
- `repository.ts` (0112): `createPeopleBatch(userId: string, req: PeopleSearchRequest, plan: PeopleSearchPlan): Promise<{ id: string }>`, `savePeople(batchId: string, people: PersonCandidate[]): Promise<Lead[]>` (reusa `createLeadRecords`; mapea a campos de leads con `kind: "person"`; `category` = role, `address` = location), `finishPeopleBatch(batchId, status, resultCount)`.

## API
- `POST /api/people/plan` (0115): body `{ query, location, locale }` → `{ plan: PeopleSearchPlan, estimatedCredits: number }` (gratis; 422 con `{ code: "sensitive_segment", suggestion }`).
- `POST /api/people/search` (0115): body `PeopleSearchRequest` → `PeopleSearchResponse`. Reserva `4 × count` con `reserveCreditAmount`, settle por entregadas (patrón de app/api/search/route.ts, `settleCredits`), reembolso total ante error/abort. Fuentes en paralelo con `Promise.allSettled` y timeouts; si una falla, sigue con las demás. `maxDuration` acorde.
- Dolores: se analizan con el flujo existente (`/api/analysis`, acción pain_points) sobre los leads del lote: sin cambios en esa ruta.

## UI (0116)
Página `/[locale]/personas` + ítem "Buscar personas" en el sidebar (ícono lucide `UserSearch`). Una caja "¿A quién buscás?", ubicación, cantidad (≤25), toggle "Incluir Instagram y Facebook" (activado por defecto), preview de lo que entendió y el costo (`/api/people/plan`), buscar, resultados en tabla (nombre, rol, zona, WhatsApp, email, redes, fuente con link, completitud 0–4) y acciones: analizar dolores (reusa /api/analysis), abrir el lote en la tabla completa/historial y exportar. Sin mencionar Google Maps. Paleta AGENTS.md.

## i18n
Namespace `people` en `messages/people/{es,en}.json` (dueño 0116), registrado en `i18n/request.ts` (dueño 0116). Errores nuevos en `messages/errors/{es,en}.json` (dueño 0115).
