# Mercado Pago en Leadta

Leadta usa suscripciones mensuales sin plan asociado y con autorización pendiente. El precio y los créditos se toman del catálogo del servidor en `lib/plans.ts`, no del navegador.

## Variables del servidor

Configurar en `.env.local` y en el entorno de despliegue:

- `APP_URL`: URL HTTPS pública de Leadta en producción.
- `MP_ACCESS_TOKEN`: credencial privada de la aplicación, nunca exponer al navegador.
- `MP_WEBHOOK_SECRET`: secreto de firma que muestra Mercado Pago al configurar webhooks.

## Activación en Mercado Pago

1. Aplicar las migraciones de PocketBase, incluida `1794092428_add_subscriptions.js`.
2. En la aplicación de Mercado Pago, registrar `https://TU_DOMINIO/api/mercadopago/webhook` como URL de notificaciones.
3. Activar los tópicos `subscription_preapproval`, `subscription_authorized_payment` y `payments`.
4. Copiar el secreto de firma de Webhooks a `MP_WEBHOOK_SECRET`.
5. Usar las credenciales de prueba para validar el ciclo; cambiar a las credenciales de producción al publicar.

El webhook valida `x-signature`, consulta el estado en la API de Mercado Pago, deduplica los pagos aprobados por su ID y acredita los créditos mensuales en PocketBase. Un pago pendiente o rechazado no acredita créditos.

El checkout se habilita cuando `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL` y PocketBase están configurados. En la vuelta del checkout, Leadta consulta el estado actual de la suscripción; las notificaciones actualizan el estado y los créditos recurrentes.
