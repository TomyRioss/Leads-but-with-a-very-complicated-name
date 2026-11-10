# Protocolo Team Conveyor (leadta)

Flujo continuo tipo Toyota: el usuario entrega tareas sin parar, los orquestadores (ORQ) las asignan a workers (W) y quedan libres al instante. Todo corre sobre `main`, en la misma carpeta, sin worktrees ni commits.

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
- **W (worker):** ejecuta una tarea por vez. Recibe la tarea por `orca orchestration` y cierra con `worker_done`. No commitea ni toca la base de datos.
- **Verificación:** la hace el ORQ dueño con sus propios subagentes (hasta 10 por terminal), en modo headless. No hay terminales de control aparte.

## Ciclo de una tarea

1. **Ingreso.** El usuario da la tarea. El ORQ crea `tareas/<ORQ>-<NNNN>.md` con `estado: cola` (siguiente número libre de su prefijo).
2. **Lock de archivos.** Antes de asignar, el ORQ busca en `tareas/` las tareas en `en_curso` o `verificando` (de **todos** los ORQ) cuyos `archivos` se superpongan con la nueva. Si hay superposición, la tarea queda en `cola` hasta que se liberen.
3. **Asignación.** Elige un worker libre propio, cambia a `estado: en_curso`, completa `worker` y `dispatch`, y lanza:
   `orca orchestration worker-start --terminal <handle> --worktree current --task-title "<ORQ>-<NNNN> <título>" --spec-file docs/orquestacion/tareas/<ORQ>-<NNNN>.md --json`
   Después **termina su turno** para quedar libre.
4. **Wake.** Orca despierta al ORQ con `worker_done`, `question` o `escalation`. Las preguntas se responden con `reply` si la respuesta sale de la spec o de las reglas; si no, se le pregunta al usuario.
5. **Verificación.** Con `worker_done`, el ORQ pasa a `verificando` y lanza un subagente que revisa la evidencia en modo headless (typecheck, lint, tests o Playwright headless, según la spec).
6. **Cierre.** Si la verificación pasa: `estado: hecha`, con evidencia y veredicto, y aviso al usuario en una línea. Si falla: `send` al mismo worker con la corrección (máximo 2 vueltas). Si sigue fallando: `estado: fallida` y escalación al usuario. Nunca se marca hecha una tarea que falló.

**Límite de trabajo en curso:** 1 tarea por worker. Si no hay worker libre, la tarea espera en `cola` y se asigna cuando un worker termina.

## Plantilla de tarea (`tareas/<ORQ>-<NNNN>.md`)

```markdown
---
id: ORQ-1-0001
titulo: <título corto>
orquestador: ORQ-1
worker: W03            # vacío mientras esté en cola
dispatch:              # dispatch_id devuelto por worker-start
estado: cola           # cola | en_curso | verificando | hecha | fallida
archivos:              # rutas o globs que el worker PUEDE editar (lock)
  - app/(public)/[username]/page.tsx
creado: 2026-11-10T14:00
actualizado: 2026-11-10T14:00
---

## Spec
Objetivo: <qué cambia y por qué>
Puede editar: solo los `archivos` listados. Cualquier otro archivo requiere `ask`.
Restricciones: AGENTS.md y CLAUDE.md del repo, Brand Kit Loruppa, sin commits, sin cambios de base de datos, sin instalar dependencias sin `ask`.
Hecho cuando: <criterio observable>
Evidencia requerida (headless): <comandos exactos, p. ej. `npx tsc --noEmit`, `npm run lint`, test Playwright headless>. Un exit distinto de 0 = tarea fallida.
Cierre: `worker_done` con resumen de 5 líneas como máximo, archivos tocados y salida de la evidencia.

## Evidencia
<la completa el ORQ con lo que reportó el worker>

## Veredicto
<pasa / falla + motivo; lo completa el ORQ después de verificar>
```

## Reglas fijas

- Todo sobre `main`, en la carpeta del proyecto. Sin worktrees ni commits de los workers.
- Sin cambios de base de datos, Prisma o migraciones salvo consentimiento explícito del usuario en ese mensaje.
- Workers en Sonnet 5.5 con effort medium (`/model claude-sonnet-5-5`, `/effort medium`).
- Para tocar un worker se usa `orca orchestration send`. Nunca se escribe en su terminal mientras tiene una tarea.
- Nada de polling ni scripts de espera: Orca despierta al ORQ.
- El ORQ no lee la salida completa de un worker. Usa el resumen de `worker_done` y la verificación de su subagente, así su contexto dura más.
- El ORQ agrupa: si el usuario manda varias tareas en un mensaje, las asigna todas en un mismo turno.

## Retomar después de perder la sesión o el contexto

1. Leer `protocolo.md` y `equipo.md`.
2. Recorrer `tareas/` y quedarse con las del propio ORQ en `cola`, `en_curso` o `verificando`.
3. Si el Run de `equipo.md` existe: `orca orchestration run-use --id <run>` y `orca orchestration worker-list --json` para ver qué terminó mientras tanto. Si no existe: `run-create` y actualizar `equipo.md`.
4. Para cada `en_curso` sin worker vivo: reasignar la misma tarea. Seguir el ciclo.
5. Si los handles cambiaron (Orca reiniciado), rearmar con la skill `team-conveyor`.
