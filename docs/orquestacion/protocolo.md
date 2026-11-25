# Protocolo Team Conveyor (leadta)

Flujo continuo tipo Toyota: el usuario entrega tareas sin parar, los orquestadores (ORQ) las asignan a workers (W) y quedan libres al instante. Los ORQ corren en `main` (`C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta`). Los workers corren en el worktree `dev` (`C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev`). Cada tarea verificada al 100% se commitea en `dev`, se mergea a `main` y se pushea sola, sin intervención humana.

**Fuente de verdad durable: los archivos de `docs/orquestacion/`.** El Run de Orca es solo transporte (mensajería y wake-ups). Si se pierde el Run, la sesión o el contexto, el estado se reconstruye leyendo estos archivos.

## Archivos

| Archivo | Contenido | Quién escribe |
|---|---|---|
| `protocolo.md` | Este documento: reglas fijas | Solo por pedido del usuario |
| `equipo.md` | Mapa vigente: ORQ, workers de cada ORQ, Run de cada ORQ | La skill `team-conveyor` al armar o rearmar |
| `tareas/<ORQ>-<NNNN>.md` | Una tarea por archivo: spec, estado, evidencia, veredicto | Solo el ORQ dueño de la tarea |

Un archivo por tarea evita que dos ORQ pisen el mismo registro.

## Roles

- **ORQ (orquestador):** recibe tareas del usuario, escribe la spec, asigna, verifica, reporta. No implementa código. Solo usa sus propios workers (ver `equipo.md`).
- **W (worker):** ejecuta una tarea por vez, **siempre en `leadta-dev`**. Recibe la tarea por `orca orchestration` y cierra con `worker_done`. No commitea, no mergea, no pushea ni toca la base de datos.
- **Entrega:** solo el ORQ dueño commitea, mergea y pushea, y solo después de que la tarea pasó el gate completo (ver "Gate de verificación" y "Entrega automática").
- **Verificación:** la hace el ORQ dueño con sus propios subagentes (hasta 20 por terminal), en modo headless. No hay terminales de control aparte.
- **Entrega sin pedir permiso:** el usuario autorizó la entrega automática al armar el flujo. El ORQ no pregunta antes de verificar, commitear, mergear a `main` ni pushear una tarea terminada: con `worker_done`, corre el gate y entrega en el mismo turno. Si el usuario rechaza un comando o pide frenar, se respeta eso puntualmente; las demás tareas terminadas siguen su entrega normal, y si no queda claro qué alcanza el freno, el ORQ pregunta en una línea en vez de quedarse quieto.
- **Paralelismo subagéntico y trabajo asíncrono obligatorios:** cada ORQ y cada worker trabaja siempre en paralelo y de forma asíncrona siempre que se pueda. Delega a subagentes (Agent tool) toda tarea o parte de tarea que se pueda delegar, con un máximo de 20 subagentes simultáneos por instancia de Claude. Varios pedidos en cola o varios frentes de un mismo pedido se reparten entre subagentes a la vez, no en serie. Los procesos largos (tests, builds, servidores) corren en segundo plano mientras se avanza con lo demás. Los subagentes independientes salen en un solo mensaje, cada uno con su alcance y sus archivos exactos; ninguno edita archivos asignados a otro.

## Worktrees

| Quién | Carpeta | Rama | Dev server |
|---|---|---|---|
| ORQ | `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta` | `main` | `:3000` (el del usuario) |
| Workers | `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev` | `dev` | `:3100`, terminal `DEV-3100` (`set PORT=3100&& npm run dev`: túnel SSH a PocketBase de PRODUCCIÓN) |

- Selector Orca de los workers: `path:C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev`.
- **Puerto de testing fijo: `3100`, nunca otro.** `playwright.config.ts` lo tiene fijo. Lo sirve el dev server de dev, así que los tests prueban el código de dev. Los tests y capturas se corren solo desde dev.
- El ORQ no edita archivos versionados en `main`: `main` cambia solo por fast-forward desde `dev`. El ORQ escribe solo en `docs/orquestacion/` de `main`. La copia de esa carpeta en dev no se usa, y `docs/orquestacion/` nunca entra en un commit de entrega. `git merge --ff-only` funciona aunque esa carpeta tenga cambios sin commitear.
- `docs/FEATURE-MAP.md` sí se versiona: el worker lo edita en `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev/docs/FEATURE-MAP.md`.
- Evidencia y capturas: el worker las guarda en `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta/docs/orquestacion/evidencia/<ID>/` (ruta absoluta).
- Playwright en paralelo: cada worker corre con `--output test-results/<ID>` para no borrar los resultados de otro.
- **Datos de producción:** el dev server de dev usa el PocketBase real. Un test que escribe datos los escribe en prod. Las rutas privadas se prueban por su bloqueo sin sesión (401 / redirect).
- Prohibido en cualquier worktree: `git reset --hard`, `push --force`, `rebase`, `checkout -- .`, `clean -f`, borrar ramas.

## Ciclo de una tarea

1. **Ingreso.** El usuario da la tarea. El ORQ crea `tareas/<ORQ>-<NNNN>.md` con `estado: cola` (siguiente número libre de su prefijo).
2. **Lock de archivos.** Antes de asignar, el ORQ busca en `tareas/` las tareas en `en_curso` o `verificando` (de **todos** los ORQ) cuyos `archivos` se superpongan con la nueva. Si hay superposición, la tarea queda en `cola` hasta que se liberen.
3. **Asignación.** Elige un worker libre propio, cambia a `estado: en_curso`, completa `worker` y `dispatch`, y lanza:
   `orca orchestration worker-start --terminal <handle> --worktree path:C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev --task-title "<ORQ>-<NNNN> <título>" --spec-file docs/orquestacion/tareas/<ORQ>-<NNNN>.md --json`
   Después **termina su turno** para quedar libre.
4. **Wake.** Orca despierta al ORQ con `worker_done`, `question` o `escalation`. Las preguntas se responden con `reply` si la respuesta sale de la spec o de las reglas; si no, se le pregunta al usuario.
5. **Verificación.** Con `worker_done`, el ORQ pasa a `verificando` y lanza un subagente que corre el **Gate de verificación** completo en `leadta-dev`, headless.
6. **Cierre.** Si el gate pasa entero: `estado: lista` y se corre la **Entrega automática**. Al terminar el push: `estado: hecha`, con evidencia, hash del commit y veredicto, y aviso al usuario en una línea. Si el gate falla: `send` al mismo worker con la corrección y la salida del fallo (máximo 5 intentos en total por tarea, regla de AGENTS.md). Si sigue fallando: `estado: fallida` y escalación al usuario. Nunca se commitea ni se marca hecha una tarea que falló.

## Gate de verificación (todo en `leadta-dev`, exit 0 obligatorio)

**Pasos 1 a 4 en paralelo** (cuatro procesos a la vez, esperar a los cuatro; cualquier exit distinto de 0 = falla). Playwright ya corre con `fullyParallel` y 4 workers por corrida, y `expect` espera 15 s. No bajar a 1 worker.

1. `npx tsc --noEmit`
2. `npx eslint <archivos tocados>`
3. Selfchecks: `node <selfcheck>` para cada `lib/**/*.selfcheck.mjs` y `scripts/*-selfcheck.mjs` relacionado con los archivos tocados (leadta no tiene `npm test`).
4. `npx playwright test <specs de la tarea> --output test-results/<ID>`: desktop y mobile, contra `:3100`. Toda funcionalidad nueva o cambiada tiene su test e2e en `e2e/`, como mínimo uno por fila del FEATURE-MAP que toca.
5. **FEATURE-MAP al día.** Si la tarea agrega, mueve o borra una funcionalidad, `docs/FEATURE-MAP.md` se actualiza en el mismo cambio. Si está desactualizado, la tarea no está terminada.
6. **Validación empírica** si la tarea es de interfaz: capturas headless a 390 y 1440 sobre `:3100`, revisadas por el subagente verificador.
7. `git -C C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev status --porcelain` muestra solo archivos de `archivos`, `docs/FEATURE-MAP.md` y `e2e/`. Si aparece otro archivo, se le pregunta al worker antes de seguir.

## Entrega automática (la hace el ORQ dueño, desde `main`)

Ejecutar en orden. Si un paso falla, frenar, dejar la tarea en `lista` con el error en "Evidencia" y avisar al usuario. Sin force y sin reset.

1. **Lock global de entrega:** `mkdir docs/orquestacion/.entrega-lock`. Si ya existe, otro ORQ está entregando: dejar la tarea en `lista` y reintentar en el próximo wake. Un lock con más de 15 min y sin ningún ORQ entregando se puede borrar.
2. **Archivos compartidos:** si un archivo de la tarea está también en otra tarea `en_curso`, no se commitea todavía, porque se llevaría cambios a medias. La tarea queda en `lista` y se entrega en un solo commit junto con la otra cuando esa llegue a `lista`.
3. **Commit en dev:** `git -C C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev add -- <archivos> docs/FEATURE-MAP.md e2e/` y `git -C C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev commit -m "<tipo>: <título> (<ID>)"`, con el trailer de co-autoría vigente.
4. **Traer main:** en `main`, `git fetch origin` y `git merge --ff-only origin/main`. Después, `git -C C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev merge --no-edit main`. Si hay conflicto: `git -C C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev merge --abort`, tarea `fallida` con los archivos en conflicto, soltar el lock y avisar al usuario.
5. **Si el paso 4 trajo cambios:** repetir los pasos 1–4 del gate en `leadta-dev`.
6. **Merge a main:** en `main`, `git merge --ff-only dev`.
7. **Push:** `git push origin main dev`.
8. **Soltar el lock:** `rmdir docs/orquestacion/.entrega-lock`. Anotar el hash en `commit:` y pasar a `hecha`.

**Entrada única:** el usuario le habla solo a ORQ-1. ORQ-1 se queda con la tarea si tiene un worker libre; si no, se la deriva al ORQ con más workers libres, pegándole el texto de la tarea en su terminal con `orca terminal send --enter`. El ORQ que recibe la deriva crea su propio `tareas/<ORQ>-<NNNN>.md` y sigue el ciclo normal. Avisa al usuario con una línea al cerrar.

**Límite de trabajo en curso:** 1 tarea por worker. Si no hay worker libre, la tarea espera en `cola` y se asigna cuando un worker termina.

## Reporte de estado al usuario

El ORQ manda un reporte de estado **cada vez que asigna un lote de tareas, cada vez que cierra o verifica tareas, y cuando el usuario lo pide**. Siempre con este formato:

| Tarea | Worker | Estado |
|---|---|---|
| 0002 Título corto de lo pedido | W01 | ✅ entregada, verificando |
| 0006 … | W05 | 🔄 en curso |
| … | ORQ-2 | 🔄 derivada |

Estados: `⏳ en cola`, `🔄 en curso`, `🔄 derivada` (a otro ORQ), `✅ entregada, verificando`, `✔️ verificada` (pasó la verificación), `❌ fallida` (con motivo corto), `⚠️ bloqueada` (con lo que hace falta).

Debajo de la tabla van como máximo 4 bullets con lo que el usuario necesita saber: reglas nuevas aplicadas, bloqueos (por ejemplo, el login), qué se está verificando y qué se necesita de él. Al final, "Seguí mandando." si hay capacidad. Nada más: ni detalle técnico ni diffs, salvo que el usuario los pida.

## Plantilla de tarea (`tareas/<ORQ>-<NNNN>.md`)

```markdown
---
id: ORQ-1-0001
titulo: <título corto>
orquestador: ORQ-1
worker: W03            # vacío mientras esté en cola
dispatch:              # dispatch_id devuelto por worker-start
estado: cola           # cola | en_curso | verificando | lista | hecha | fallida
archivos:              # rutas (relativas al worktree dev) que el worker PUEDE editar (lock)
  - app/(public)/[username]/page.tsx
feature_map:           # filas de docs/FEATURE-MAP.md que la tarea agrega, cambia o borra
  - <FEATURE>
e2e:                   # specs de e2e/ que cubren la tarea (se crean o actualizan)
  - e2e/<spec>.spec.ts
commit:                # hash de main después de la entrega
creado: 2026-11-10T14:00
actualizado: 2026-11-10T14:00
---

## Spec
Objetivo: <qué cambia y por qué>
Puede editar: solo los `archivos` listados. Cualquier otro archivo requiere `ask`.
Carpeta: trabajá SOLO en `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev` (rama `dev`, dev server `:3100`). En `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta` solo podés escribir en la carpeta de evidencia.
Restricciones: AGENTS.md y CLAUDE.md del repo. Sin commits, merges ni push: entrega el ORQ. Sin cambios de base de datos, sin instalar dependencias sin `ask`. Navegador solo headless.
Paralelismo (obligatorio): dividí el trabajo en frentes independientes y ejecutalos con subagentes en paralelo (Agent tool), hasta 20 a la vez, lanzados en un solo mensaje. Cada subagente recibe archivos o claves exactas; dos subagentes no editan el mismo archivo a la vez (en un json compartido, cada uno edita solo sus claves con Edit puntual). Pedidos agregados con `send` mientras trabajás también se reparten en subagentes. La evidencia (tsc, eslint, selfchecks, playwright) corre en paralelo y en segundo plano. Trabajar en serie solo si el cambio es indivisible, y justificarlo en el cierre.
FEATURE-MAP y tests: actualizá `docs/FEATURE-MAP.md` (filas de `feature_map`) y escribí o actualizá los tests de `e2e`, al menos uno por fila tocada. Corré el gate completo antes de `worker_done`. Máximo 5 intentos: si sigue fallando, cerrá con `worker_done` y la salida del fallo.
Hecho cuando: <criterio observable>
Evidencia requerida (headless, en leadta-dev): `npx tsc --noEmit`, `npx eslint <archivos>`, selfchecks relacionados (`node <archivo>.selfcheck.mjs`), `npx playwright test <e2e> --output test-results/<ID>`. Un exit distinto de 0 = tarea fallida.
Capturas (obligatorio si el cambio es visual): screenshots headless sobre `http://localhost:3100` a 390 y 1440 (y otros viewports si aplica), guardados en `C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta/docs/orquestacion/evidencia/<ID>/`. Listar las rutas en `worker_done`.
Cierre: `worker_done` con resumen de 5 líneas como máximo, archivos tocados, salida de la evidencia y cuántos subagentes usaste y para qué (o por qué el cambio era indivisible).

## Evidencia
<la completa el ORQ con lo que reportó el worker>

## Veredicto
<pasa / falla + motivo; lo completa el ORQ después de verificar>
```

## Reglas fijas

- ORQ en `main`, workers en `leadta-dev` (ver "Worktrees"). Commit, merge y push los hace solo el ORQ dueño, según "Entrega automática". Los workers nunca commitean.
- Sin cambios de base de datos, Prisma o migraciones salvo consentimiento explícito del usuario en ese mensaje.
- **Navegador SOLO headless.** Prohibido abrir navegadores visibles: nada de herramientas MCP de navegador (Playwright MCP, claude-in-chrome, puppeteer) ni `headless: false`. Solo scripts con `chromium.launch({ headless: true })` o `npx playwright test`. Toda spec lo repite.
- Archivos grandes compartidos (p. ej. `app/[locale]/lead-suite/chat-panel.tsx`, `lib/server/leadtita-tools.ts`, `messages/*/es.json`): cambios puntuales con Edit, releer antes de cada edición, nunca reescribir el archivo entero.
- Workers en Sonnet 5.5 con effort high (`/model claude-sonnet-5-5`, `/effort high`).
- Para tocar un worker se usa `orca orchestration send`. Nunca se escribe en su terminal mientras tiene una tarea.
- Nada de polling ni scripts de espera: Orca despierta al ORQ.
- El ORQ no lee la salida completa de un worker. Usa el resumen de `worker_done` y la verificación de su subagente, así su contexto dura más.
- El ORQ agrupa: si el usuario manda varias tareas en un mensaje, las asigna todas en un mismo turno.

## Retomar después de perder la sesión o el contexto

1. Leer `protocolo.md` y `equipo.md`.
2. Recorrer `tareas/` y quedarse con las del propio ORQ en `cola`, `en_curso`, `verificando` o `lista`. Las `lista` retoman la "Entrega automática" desde el paso que falta (`git -C C:/Users/Pc/Documents/Codex/2026-11-06/amigo/leadta-dev log -1` muestra si ya están commiteadas).
3. Si el Run de `equipo.md` existe: `orca orchestration run-use --id <run>` y `orca orchestration worker-list --json` para ver qué terminó mientras tanto. Si no existe: `run-create` y actualizar `equipo.md`.
4. Para cada `en_curso` sin worker vivo: reasignar la misma tarea. Seguir el ciclo.
5. Si los handles cambiaron (Orca reiniciado), rearmar con la skill `team-conveyor`.
