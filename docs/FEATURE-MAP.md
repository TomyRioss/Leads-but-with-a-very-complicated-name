FEATURE | ROUTE
--- | ---
VER LANDING | "/"
IR A PLANES DESDE LANDING | "/" > Header > Link "Pricing"
IR A BLOG DESDE LANDING | "/" > Header > Link "Blog"
IR A LOGIN DESDE LANDING | "/" > Header > Botón "Ingresar"
IR A REGISTRO DESDE LANDING | "/" > Header > Botón "Crear cuenta"
CAMBIAR IDIOMA | "/" > Selector de idioma > "English" ("/en")
LINKS LEGALES DEL FOOTER | "/" > Footer > "Términos y condiciones" / "Política de privacidad"
DESCRIBIR PRODUCTO EN LANDING | "/" > Hero > Recuadro (toggle "Texto" / "Web") > Flecha > POST "/api/explore/start" > "/explorar"
VENDO SERVICIOS | "/" > Hero > Link "Vendo servicios" > Popup 3 preguntas > "Generar mis campañas"
EXPLORAR 5 PASOS | "/explorar" > Investigar > Competidores > Campañas > 50 clientes (Apify) > 10 propuestas WhatsApp/Gmail (POST "/api/explore/[step]", stream NDJSON: ficha en vivo; ficha terminada 5 s antes de avanzar)
EXPLORAR SIN CORRIDA | "/explorar" sin cookie > Estado vacío > "Empezar desde el inicio"
CORREGIR DATOS DEL PASO 1 | "/explorar" > Barra lateral > Paso 1 > "¿Los datos están mal?" > Descripción / Ubicación > "Guardar" (PATCH "/api/explore") > Regenera pasos 2-5 (máx. 3 cambios / 10 min por IP)
ENVIAR PROPUESTA BLOQUEADO | "/explorar" > Paso 5 > "Enviar" > Popup "Crea tu cuenta para enviar" (con aviso "Probá 7 días gratis con el Plan Free")
PRUEBA 7 DÍAS PLAN FREE | Cuentas creadas desde 2026-11-26 (lib/trial.ts): 7 días sin plan; vencida > páginas privadas redirigen a "/pricing" con aviso; APIs privadas 401 (salvo auth, subscriptions, mercadopago)
PASAR LEADS DE EXPLORAR A LA CUENTA | Registro / Google con cookie "leadta_explore" > Lote nuevo en "/historial"
VER PLANES Y PRECIOS | "/pricing"
CAMBIAR MONEDA DE PRECIOS | "/pricing" > Cards de planes: ARS principal + "aprox. USD" secundario (sin toggle)
SUSCRIBIRSE A PLAN | "/pricing" > Botón "Suscribirme" > POST "/api/subscriptions"
CONFIRMAR SUSCRIPCIÓN | Checkout Mercado Pago > back_url GET "/api/subscriptions/confirm?preapproval_id="
WEBHOOK DE PAGOS MERCADO PAGO | POST "/api/mercadopago/webhook"
LEER BLOG | "/blog"
LEER ARTÍCULO DEL BLOG | "/blog/[slug]"
VER TÉRMINOS | "/terminos"
VER PRIVACIDAD | "/privacidad"
INICIAR SESIÓN | "/login" > Formulario > POST "/api/auth/login"
INICIAR SESIÓN CON GOOGLE | "/login" > Botón "Continuar con Google" > "/api/auth/google"
REGISTRAR USUARIO | "/register" > Formulario > POST "/api/auth/register"
VERIFICAR EMAIL | "/verificar" > POST "/api/auth/verify-email"
RESTABLECER CONTRASEÑA | "/restablecer" > POST "/api/auth/password-reset"
CERRAR SESIÓN | Sidebar > Botón "Cerrar sesión" > POST "/api/auth/logout"
CONSULTAR SESIÓN | GET "/api/auth/me"
CHAT LEADTITA | "/leadtita" > Chat > POST "/api/lead-suite/chat"
CONVERSACIONES DE LEADTITA | "/leadtita" > Historial de conversaciones > "/api/leadtita/conversations"
LEAD SUITE DASHBOARD | "/lead-suite" > GET "/api/lead-suite/dashboard"
CONTACTOS DE LEAD SUITE | "/lead-suite" > Contactos > "/api/lead-suite/contacts"
PROGRAMAR MENSAJES | "/lead-suite" > Diálogo "Programar" > "/api/scheduled"
VER MIS NEGOCIOS | Sidebar > "Mis negocios" ("/negocios") > GET "/api/businesses" (ficha + competidores; vacío > "Explorar un negocio" > "/")
VER CAMPAÑAS DE UN NEGOCIO | "/negocios" > Botón "Ver campañas" > "/campanas?business=<id>" (chip "Quitar filtro")
VER MIS CAMPAÑAS | Sidebar > "Mis campañas" ("/campanas") > GET "/api/sales-campaigns"
VER LEADS DE UNA CAMPAÑA | "/campanas" > Tarjeta de campaña > GET "/api/sales-campaigns/<id>/leads"
BUSCAR MÁS LEADS DE UNA CAMPAÑA | "/campanas" > Botón "Buscar más leads" > POST "/api/sales-campaigns/<id>/search"
VER MIS PROPUESTAS | Sidebar > "Mis propuestas" ("/propuestas") o "/campanas" > "Ver propuestas" ("/propuestas?campaign=<id>") > GET "/api/proposals"
EDITAR PROPUESTA | "/propuestas" > Asunto / Mensaje > Botón "Guardar" > PATCH "/api/proposals/<id>" (enviadas: solo lectura)
ENVIAR PROPUESTA | "/propuestas" > Botón "Enviar" > POST "/api/proposals/<id>/send" (sin WhatsApp/Gmail > link "Ir a Integraciones")
EXPORTAR LEADS CSV/XLSX | "/historial" > Vista por lote > "Descargar CSV" / "Descargar XLSX" ("/api/export/xlsx")
VER HISTORIAL DE LOTES | "/historial" > GET "/api/history"
CONECTAR INTEGRACIONES (GOOGLE / WHATSAPP) | "/integraciones" > Botones "Conectar"
AUTORIZAR CLIENTE OAUTH (MCP) | "/oauth/authorize"
SERVIDOR MCP | POST "/api/mcp" + "/.well-known/oauth-authorization-server"
PANEL OWNER | "/owner" > GET "/api/owner/me"
ENVIAR FEEDBACK | Sidebar > Botón "¡Ayuda a mejorar Leadta!" > POST "/api/feedback"
ESTADO DEL SERVICIO | GET "/api/status"
PÁGINA 404 | Ruta inexistente > Not found
