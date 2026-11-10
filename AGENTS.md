# AGENTS.md

## Alcance

Estas reglas aplican al trabajo realizado desde el Escritorio y a proyectos que las hereden. Respetá las instrucciones específicas del repositorio si agregan detalle compatible con la petición del usuario.

## Paleta compartida de marca para leadta y OSPECTO

Ambos proyectos deben usar esta misma paleta y Geist Sans. La fuente de verdad es la paleta definida en OSPECTO. Usá los tokens semánticos en vez de introducir colores alternativos; el blanco debe aparecer en forma limitada.

- `--ash-950`: #171918
- `--ash-900`: #202320
- `--ash-800`: #303430
- `--ash-700`: #4c514c
- `--ash-600`: #666d66
- `--ash-500`: #808780
- `--ash-400`: #a2a8a0
- `--ash-300`: #c2c7c0
- `--ash-200`: #d8dcd6
- `--ash-150`: #e2e5e0
- `--ash-100`: #eaede8
- `--ash-50`: #f1f3ef
- `--lime`: #c9e94f
- `--lime-dark`: #abc934
- `--paper`: #fafbf8
- `--ink`: #202320
- `--muted`: #676e67
- `--line`: #d9ddd7

Fondo base: `--ash-100`. Texto principal: `--ink`. Fuente: Geist Sans. Mantené idénticos los valores y su intención entre leadta y OSPECTO.

Fuente de los valores: OSPECTO, app/globals.css.

## Reglas de implementación

### Delegación de programación con subagentes

- En tareas sustantivas de programación, separá el trabajo en frentes independientes y delegalos en subagentes en paralelo cuando eso reduzca el tiempo total. Usá hasta 10 subagentes si la plataforma lo permite.
- Para una tarea pequeña o un único cambio indivisible, no fuerces paralelismo. Si las instrucciones de mayor prioridad limitan la delegación, respetalas.
- Antes de delegar, asigná a cada subagente un objetivo concreto, archivos de su propiedad, límites de alcance y criterios de entrega. Evitá que dos agentes editen los mismos archivos a la vez.
- Avisá que el workspace es compartido y que no deben revertir cambios de otros. Coordiná dependencias y conflictos antes de integrar.
- El agente principal conserva responsabilidad por la arquitectura, la seguridad, la revisión de cada diff, la integración y la verificación final. No integres resultados sin revisarlos.

### Eficiencia del código

- Buscá la máxima eficiencia práctica y medible en CPU, memoria, red, disco, base de datos y latencia, manteniendo correctitud, seguridad, accesibilidad y legibilidad. No prometas ni persigas una eficiencia absoluta imposible de medir.
- Antes de codificar, identifica trabajo repetido y su costo. Evitá consultas N+1, solicitudes de red duplicadas o seriales cuando sean independientes, cómputos repetidos, estado React derivable, renders evitables, concurrencia sin límite y dependencias innecesarias.
- Elegí algoritmos y estructuras adecuados al volumen esperado, validá y acotá entradas, paginá listas grandes y aplicá límites de tiempo y concurrencia a operaciones externas.
- Medí los cuellos de botella antes de agregar caché o complejidad de optimización. Cacheá solo cuando la vigencia y el aislamiento por usuario sean seguros. Nunca sacrifiques seguridad, privacidad, mantenibilidad o UX por una mejora teórica.
- Reducí duplicación cuando varias rutas compartan una regla real y estable. Mantené explícitas las diferencias de permisos y errores; no extraigas abstracciones genéricas que oculten el flujo.

### Reutilización de soluciones

1. Antes de implementar, buscá si la solución ya existe en el proyecto, en las dependencias, en la plataforma o en una librería compatible.
2. Consultá documentación oficial vigente. Revisá licencia, mantenimiento, dependencias, seguridad, accesibilidad, comportamiento responsive y compatibilidad con Next.js App Router.
3. Preferí, en este orden: componentes existentes del proyecto, APIs nativas del framework, librería UI ya adoptada, registros confiables compatibles, y código propio solo si falta una solución adecuada.
4. No agregues paquetes duplicados ni mezcles sistemas de componentes sin motivo concreto. Mantené una sola fuente de verdad para tokens, estilos y componentes base.
5. Reutilizar no significa copiar a ciegas: revisá código, estados, props y dependencias; adaptá el componente al diseño del producto.
6. No reinventes soluciones comunes como diálogos, menús, tabs, validación, calendarios, tablas, gráficos, toasts, iconos o animaciones si hay una alternativa adecuada y mantenida.

### ReactBits, shadcn/ui y otras librerías

- React Bits (https://reactbits.dev/) distribuye código fuente de componentes animados que el proyecto puede adaptar. Revisá sus categorías Text Animations, Animations, Components, Backgrounds y Micro Interactions. Buscá primero la pieza adecuada, elegí JavaScript o TypeScript y CSS o Tailwind según el proyecto, y seguí su guía oficial de instalación. Usala cuando el efecto ayude al usuario.
- shadcn/ui (https://ui.shadcn.com/docs) es la opción preferida para controles de aplicación si el proyecto todavía no tiene un sistema equivalente. Agregá solo los componentes necesarios con el CLI oficial. El código vive en el proyecto y debe seguir sus tokens y convenciones.
- Happy UI es un nombre ambiguo. Antes de usarlo, identificá el paquete o repositorio exacto y verificá que sea el producto esperado, que se mantenga, su licencia y compatibilidad. No instales algo solo por coincidir en el nombre.
- En componentes comunitarios, verificá origen, licencia, seguridad, accesibilidad, dependencias y mantenimiento.
- Elegí una librería por necesidad y coherencia; evitá mezclar estilos incompatibles.
- En Next.js, respetá Server Components por defecto. Usá límites Client Component solo para estado, eventos del navegador o APIs cliente, y seguí la guía de integración de cada librería.

### Diseño frontend y QA web

- Para diseño y cambios visuales, aplicá las skills frontend-design e impeccable. Inspeccioná la interfaz existente y conservá su identidad cuando ya esté definida.
- Priorizá jerarquía visual, legibilidad, accesibilidad, foco de teclado, estados vacíos y errores, y adaptación a móvil.
- No escribas SVG a mano ni dibujes iconos con texto, emojis o pseudo-elementos. Para iconografía, usá la librería de iconos React existente; si no hay una, agregá una alternativa mantenida como lucide-react o react-icons e importá solo los iconos necesarios.
- No crees gráficos SVG para diseños salvo pedido explícito. Preferí CSS, componentes e imágenes rasterizadas cuando corresponda.
- Para QA web solicitado o necesario en una entrega visual, usá dogfood: recorré flujos principales y casos límite, revisá estados vacíos y errores, inspeccioná la consola y registrá pasos reproducibles y evidencia.

### Next.js y arquitectura MVC

- Seguí las convenciones oficiales de Next.js App Router para rutas, layouts, páginas, loading, error, metadata y handlers.
- Usá MVC como guía de responsabilidades, no como una estructura rígida que contradiga Next.js:
  - Vista: componentes React, layouts y páginas.
  - Controlador/aplicación: route handlers delgados y casos de uso que validan entrada, verifican permisos y coordinan operaciones.
  - Modelo/dominio: tipos, reglas e invariantes del negocio.
  - Persistencia: repositorios y adaptadores que encapsulan ORM o base de datos.
- No mezcles consultas, reglas de negocio y presentación dentro de una página o componente. Extraé capas cuando exista complejidad real; no agregues abstracciones vacías.
- Usá TypeScript, nombres claros y componentes con responsabilidades definidas. Revisá la estructura existente antes de crear carpetas nuevas. Preferí colocalización compatible con las convenciones del framework.

### Base de datos

- Nombrá tablas, columnas, índices, constraints, vistas y funciones con snake_case cuando aplique.
- Usá nombres explícitos y estables, por ejemplo: leads, company_id, created_at, updated_at.
- En TypeScript podés mapear campos camelCase a columnas snake_case mediante el ORM.
- Versioná cambios con migraciones revisables. Definí claves, restricciones, índices y borrados de acuerdo con reglas reales del dominio.
- Antes de cualquier cambio en Postgres o Supabase, leé las skills supabase y supabase-postgres-best-practices. Revisá RLS, permisos, índices, integridad y seguridad.

## Skills disponibles en el catálogo de esta sesión

La lista está normalizada para quitar aliases duplicados. Elegí solo las skills pertinentes. El catálogo puede cambiar; si falta una skill, revisá el catálogo actual antes de asumir que no existe.

### Codex, agentes y desarrollo

- i-have-adhd: respuestas breves, concretas y orientadas a una acción.
- brainstorming: explorar requisitos antes de crear funcionalidades o diseños.
- build: implementar siguiendo SPEC.md.
- spec: crear o actualizar SPEC.md.
- check: revisar divergencias entre SPEC.md y el código, sin editar.
- backprop: convertir bugs y fallas en invariantes preventivas.
- caveman: comprimir SPEC.md y documentos relacionados.
- babysit: mantener PRs listos, triando comentarios y CI.
- claude-council: evaluar decisiones complejas con perspectivas estructuradas.
- orchestration: coordinar agentes y tareas con Orca.
- equipo-agentes: coordinar desarrollo con Linear, worktrees y agentes.
- orca-cli: gestionar worktrees, proyectos, terminales y navegador Orca.
- orca-linear: gestionar tickets de Linear desde Orca.
- use-terminal-orca: leer y operar terminales Orca.
- computer-use: controlar interfaces de escritorio cuando CLI/API no alcance.
- shell: ejecutar comandos solicitados.
- dogfood: explorar una app web y documentar defectos reproducibles.
- playwright-cli: automatizar páginas y flujos web.
- create-hook: crear hooks de Codex.
- create-rule: crear reglas persistentes.
- create-skill: crear skills de agente.
- hybrid-skill-creator: crear o convertir flujos en skills reutilizables.
- create-subagent: definir subagentes especializados.
- skill-creator: crear o actualizar skills.
- skill-installer: instalar skills disponibles o desde repositorios.
- template-creator: crear o actualizar plantillas reutilizables de documentos y presentaciones.
- find-skills: encontrar skills instalables.
- migrate-to-skills: convertir reglas Cursor en skills.
- openai-docs: consultar documentación de OpenAI, Codex y APIs OpenAI.
- statusline: configurar la línea de estado del CLI.
- update-cli-config: configurar Codex CLI.
- update-cursor-settings: ajustar preferencias del editor y Codex.
- fix-codex: diagnosticar ventanas CMD/PowerShell repetidas en Windows.
- vps-ssh: inspeccionar y operar un VPS por SSH.

### Diseño, interfaz y sitios

- frontend-design: diseñar interfaces distintivas con dirección visual intencional.
- impeccable: diseñar, auditar y refinar UX, interfaces y sistemas visuales.
- hallmark: crear sitios y páginas con estética deliberada.
- ui-ux-pro-max: consultar patrones y recursos de UI/UX web y móvil.
- product-design:index: elegir el flujo de Product Design.
- product-design:audit: auditar journeys y flujos de producto.
- product-design:ideate: generar alternativas visuales.
- product-design:image-to-code: implementar desde una imagen/captura.
- product-design:url-to-code: recrear una web desde su URL.
- app-6a3293e129088191abf0875820e839da:website-builder: crear un sitio o app web completa.
- sites:sites: crear o modificar sitios mediante Sites.
- sites:sites-remix: derivar un sitio desde otro hecho con Sites.
- app-6ab242dbeb5c8191ba5277534ef0c570:tldraw: crear diagramas en un canvas.
- visualize: crear visualizaciones interactivas.
- imagegen: generar o editar imágenes rasterizadas.
- app-6a3293e129088191abf0875820e839da:higgsfield: enrutar comandos de generación de imagen y video de Higgsfield.
- plugin-management:plugin-management: descubrir y administrar plugins, permisos y conexiones.
- posthog:posthog: analizar datos de producto y configurar PostHog.

### React, Vercel y servicios web

- vercel:access-protected-vercel-deployment: acceder y probar despliegues protegidos.
- vercel:ai-gateway: configurar Vercel AI Gateway.
- vercel:ai-sdk: integrar funciones de IA con Vercel AI SDK.
- vercel:auth: integrar autenticación.
- vercel:bootstrap: preparar proyectos y dependencias de Vercel.
- vercel:build-agents: diseñar agentes de IA.
- vercel:cdn-caching: diagnosticar caché y revalidación CDN.
- vercel:chat-sdk: crear bots para múltiples plataformas.
- vercel:create-a-backend: planear APIs, backend y almacenamiento.
- vercel:custom-metrics: registrar métricas.
- vercel:deployments-cicd: administrar despliegues y CI/CD.
- vercel:domains: buscar y administrar dominios y DNS.
- vercel:env-vars: administrar variables de entorno.
- vercel:eve: desarrollar agentes durables con Eve.
- vercel:flags-sdk: configurar feature flags y pruebas A/B.
- vercel:is-agentic: medir preparación de una web o MCP para agentes.
- vercel:knowledge-update: actualizar conocimiento sobre Vercel.
- vercel:marketplace: descubrir e instalar integraciones.
- vercel:microfrontends: implementar microfrontends y multi-zones.
- vercel:queues: procesar tareas asíncronas con colas.
- vercel:react-best-practices: revisar estructura, accesibilidad, hooks y rendimiento React.
- vercel:routing-middleware: interceptar, reescribir y personalizar solicitudes.
- vercel:runtime-cache: implementar caché regional e invalidación.
- vercel:vercel-agent: usar el agente de Vercel.
- vercel:vercel-cli: administrar proyectos mediante CLI.
- vercel:vercel-connect: conectar servicios con credenciales acotadas.
- vercel:vercel-firewall: configurar firewall y reglas WAF.
- vercel:vercel-functions: configurar funciones server-side.
- vercel:vercel-sandbox: ejecutar código en sandboxes aislados.
- vercel:vercel-services: componer servicios frontend y backend.
- vercel:vercel-storage: elegir almacenamiento de Vercel.
- vercel:verification: verificar el flujo de navegador a datos.
- vercel:workflow: crear flujos durables con pausas y reintentos.
- supabase:supabase: usar productos, APIs, CLI, base de datos, Auth y Storage de Supabase.
- supabase-postgres-best-practices: diseñar/revisar Postgres, SQL, RLS, migraciones e índices.
- mercadopago:mp-connect: conectar autenticación Mercado Pago.
- mercadopago:mp-integrate: integrar pagos Mercado Pago.
- mercadopago:mp-review: revisar una integración Mercado Pago.
- mercadopago:mp-test-setup: preparar usuarios y fondos de prueba.
- mercadopago:mp-webhooks: configurar webhooks Mercado Pago.

### SEO, contenido y redes sociales

- seo: optimizar SEO técnico y on-page.
- seo-audit: diagnosticar páginas existentes para SEO.
- ai-seo: mejorar visibilidad y citabilidad en buscadores generativos.
- content-strategy: definir temas, clusters e intención editorial.
- social-seo: optimizar contenido social para búsquedas.
- instagram-seo: mejorar descubrimiento dentro de Instagram.
- instagram-skills:instagram-marketing: planificar, escribir, auditar y publicar contenido de Instagram.
- instagram-skills:ig-audience-insights: analizar perfil, nicho y audiencia con datos.
- instagram-skills:ig-caption-writer: redactar captions con hook y CTA.
- instagram-skills:ig-carousel-planner: estructurar carruseles.
- instagram-skills:ig-content-planner: organizar contenido semanal.
- instagram-skills:ig-hashtag-strategist: elegir hashtags según tamaño y alcance.
- instagram-skills:ig-hook-extractor: analizar el hook de un post o Reel.
- instagram-skills:ig-humanizer: dar naturalidad a captions.
- instagram-skills:ig-profile-optimizer: optimizar perfiles.
- instagram-skills:ig-repurposer: adaptar contenido a Instagram.
- chatgpt-carousel: producir carruseles para LinkedIn o Instagram.
- app-69ea4ed2cf7c8191b742ef3622479ddd:Search: investigar en web y generar prospectos con Exa.

### Google Drive, documentos y datos

- google-drive:google-drive: buscar y administrar archivos de Drive.
- google-drive:google-docs: crear y editar Google Docs.
- google-drive:google-drive-comments: administrar comentarios de Drive.
- google-drive:google-sheets: analizar y editar Google Sheets.
- google-drive:google-slides: crear y editar Slides.
- documents:documents: crear, revisar y comentar documentos Word.
- pdf:pdf: leer, crear, renderizar y verificar PDFs.
- presentations:Presentations: editar PowerPoint y Google Slides.
- spreadsheets:Spreadsheets: crear, analizar y visualizar hojas de cálculo.
- spreadsheets:excel-live-control: controlar un libro de Excel abierto.

### Video, animación y 3D

- tesseract:tesseract-3d: crear escenas 3D editables.
- tesseract:tesseract-design: crear diseños estáticos en Tesseract.
- tesseract:tesseract-editor: construir un editor web para Tesseract.
- tesseract:tesseract-motion: crear gráficos en movimiento.
- tesseract:tesseract-video: editar footage en Tesseract.
- generate-video-v1: planificar y producir videos para marcas.
- remotion-best-practices: crear videos con Remotion.
- changelog-video: convertir changelogs en videos de marca.
- shorts-3d-loop: producir shorts explicativos 3D con cierre en loop.
- motion-doctrine: aplicar reglas generales de movimiento en HyperFrames.
- cut-the-curve: crear transiciones y movimiento entre escenas.
- seam-craft: corregir composición y render entre escenas.
- captions-overlay: componer subtítulos como capa superpuesta.
- oversized-cursor: usar cursor grande de marca en videos de producto.

### Investigación, comercio, ventas y trading

- buscar-pares-volatiles: ordenar pares de Binance Futures por volatilidad reciente.
- buscar-proveedores-gastronomicos: investigar proveedores para gastronomía.
- ecommerce-dataquarters: analizar demanda y estacionalidad de productos.
- search-products-shopify: extraer catálogos públicos de Shopify.
- prospeccion-clientes-web: buscar y calificar prospectos de desarrollo web.
- lead-realstate: generar prospectos de inmobiliarias.
- leads-gastro: generar leads de restaurantes y negocios gastronómicos.
- propuesta-marketing: preparar propuestas comerciales de marketing.
- validated-ads: investigar anuncios y crear ideas originales basadas en evidencia.

### Carrera y búsqueda laboral

- Academic CV Builder: adaptar CVs a puestos académicos.
- Career Changer Translator: trasladar experiencia entre industrias.
- Cover Letter Generator: escribir cartas según CV y puesto.
- Creative Portfolio Resume: balancear diseño y compatibilidad ATS.
- Executive Resume Writer: redactar CVs ejecutivos.
- Interview Prep Generator: preparar historias STAR y entrevistas.
- Job Description Analyzer: analizar requisitos y brechas.
- LinkedIn Profile Optimizer: optimizar perfiles LinkedIn.
- Offer Comparison Analyzer: comparar ofertas y compensación.
- Portfolio Case Study Writer: convertir logros en casos de portfolio.
- Reference List Builder: preparar lista de referencias.
- Resume ATS Optimizer: optimizar CV para ATS.
- Resume Bullet Writer: convertir tareas en logros medibles.
- Resume Formatter: dar formato claro y compatible con ATS.
- Resume Quantifier: encontrar métricas de impacto.
- Resume Section Builder: redactar secciones de CV.
- Resume Tailor: adaptar CV a un puesto.
- Resume Version Manager: manejar versiones de CV.
- Salary Negotiation Prep: preparar negociación salarial.
- Tech Resume Optimizer: optimizar CV para roles tecnológicos.

### Mascotas animadas

- work-pets:create-pet: crear, validar, reparar, previsualizar o activar una mascota.
- work-pets:pets: listar, inspeccionar y administrar mascotas.
- work-pets:update-pet: actualizar nombre, descripción o sprites de una mascota.

## Referencias oficiales

- Next.js, estructura de proyecto: https://nextjs.org/docs/app/getting-started/project-structure
- Next.js App Router: https://nextjs.org/docs/app
- shadcn/ui: https://ui.shadcn.com/docs
- React Bits: https://reactbits.dev/

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->
