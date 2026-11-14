# Cacheo estratégico (ORQ-1-0122)

Medido con curl contra el dev server local (`localhost:3000`) con la cuenta de prueba, 3 corridas cada una, el 2026-11-13. El tiempo del servidor lo domina PocketBase (remoto).

## Línea base por endpoint

| Endpoint | ms (3 corridas) | Nota |
|---|---|---|
| `/api/auth/me` (con sesión) | 249 / 220 / 243 | auth-refresh contra PocketBase |
| `/api/batches` | 1088 / 860 / 922 | |
| `/api/history?page=1` | 1790 / 1130 / 941 | |
| `/api/leads?batchId` | 1399 / 1376 / 1438 | |
| `/api/status` | 43 / 23 / 31 | |
| `/api/geography?level=countries` | 49 / 23 / 18 | ya tenía `Cache-Control` público de 1 día |
| `/api/stats` | 2782 (frío) / 17 / 15 | ya tenía caché en memoria de 30 s, pero respondía con `no-store` |

## Qué se cacheó

| Qué | Dónde | Vigencia | Invalidación | Por qué es seguro |
|---|---|---|---|---|
| Sesión `/api/auth/me`: una sola promesa compartida por pestaña | `lib/client/session.ts` (`getSession`) | 15 s; los errores y "sin sesión" no se reutilizan | `invalidateSession()` en logout (buscar, historial, personas) y antes de releer créditos (personas). `setSessionCredits()` cuando search/analysis devuelven créditos (buscar, historial, personas). Si analysis no devuelve créditos en historial, se invalida. | Vive en la memoria del módulo de esa pestaña. No es una caché HTTP ni compartida. El logout la borra, así que otro usuario en la misma pestaña no la ve. El TTL de 15 s acota la desactualización entre pestañas. |
| Carga inicial de /buscar: auth, `/api/status` y `/api/batches` en paralelo (antes, en serie) | `app/[locale]/buscar/page.tsx` | n/a | n/a | El servidor sigue validando la sesión en cada request. Sin sesión, `/api/batches` responde 401 y se descarta. |
| `/api/stats` (métricas públicas de la landing) | `app/api/stats/route.ts`: `Cache-Control: public, max-age=30, s-maxage=30, stale-while-revalidate=60`. `app/landing/live-metrics.tsx` dejó de usar `cache: "no-store"`. | 30 s, más 60 s de SWR | Por tiempo | Datos globales sin usuario, con el mismo TTL que la caché en memoria que ya existía. Ahora el CDN y el navegador absorben el polling de 15 s. |

No se tocó:
- `/api/geography`: ya está cacheado.
- `/api/batches`, `/api/leads` y `/api/history`: son datos por usuario. Sin caché compartida a propósito.

## Antes / después

Carga inicial de /buscar (auth, status, batches; la request de leads sigue igual):

| Corrida | Antes, en serie (ms) | Después, en paralelo (ms) |
|---|---|---|
| 1 | 1857 | 1222 |
| 2 | 1333 | 1305 |
| 3 | 1357 | 1218 |

Ganancia: entre 30 y 635 ms en el camino crítico (alrededor de `auth/me` + `status`).

Requests a `/api/auth/me` por carga:

| Página | Antes | Después |
|---|---|---|
| /buscar | 2 en dev (StrictMode duplica el effect); 1 en prod | 1. Navegar desde otra página en menos de 15 s: 0 |
| /historial | 2 en dev / 1 en prod | 1. Navegación en menos de 15 s: 0 (ahorra unos 240 ms) |
| /personas | 2 en dev / 1 en prod, más 1 tras cada búsqueda | 1, y 1 al releer créditos |
| landing `/api/stats` | 1 request de red cada 15 s | 1 cada 30 s (las demás salen de la caché del navegador) |

## ORQ-1-0124: consumidores restantes e invalidación en login

Pedidos a `/api/auth/me` por carga (se cuenta por código: cada página hacía un fetch propio en un effect, y StrictMode lo duplica en dev):

| Página | Antes | Después |
|---|---|---|
| /lead-suite (`lead-suite-sidebar.tsx`) | 2 en dev / 1 en prod | 1. Navegación en menos de 15 s: 0 |
| /pricing (`app/pricing/pricing-page.tsx`) | 2 en dev / 1 en prod | 1. Desde la app en menos de 15 s: 0 |
| /owner (`owner-panel.tsx`, email del header) | 2 en dev / 1 en prod | 1 |

Ningún componente cliente llama ya a `/api/auth/me` directo; solo lo hace `lib/client/session.ts`.

`app/auth-form.tsx` llama a `invalidateSession()` antes y después de login/registro (`/api/auth/login|register`), del alta de teléfono (`/api/auth/phone`) y de la verificación de email (`/api/auth/verify-email`). La primera llamada impide reusar una sesión vieja que ya estaba cacheada. La segunda descarta lo que se cacheó mientras la request seguía en vuelo, con la cookie anterior. El logout de lead-suite y owner también invalida. Google OAuth recarga la página completa, así que la caché arranca vacía.

## Pendiente (fuera de mis archivos)

- SWR en cliente para lotes y leads: no aplicado. Son por usuario, la invalidación cruza search, analysis y delete, y ahorraría alrededor de 1 s solo al volver a una página ya visitada.
- **Propuesta (no aplicada):** `getCurrentUser` en `lib/server/auth.ts` hace un auth-refresh a PocketBase en cada request autenticada (unos 240 ms). Opción: validar localmente el JWT (firma o `exp`) y refrescar solo cuando falte menos de X minutos para vencer. Leer los créditos frescos del registro solo en los endpoints que cobran. Ahorraría unos 240 ms por endpoint autenticado. Requiere revisar seguridad (revocación de sesión, cambio de rol).
