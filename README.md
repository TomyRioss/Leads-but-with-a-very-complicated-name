# Leadta

Buscador de negocios de Google Maps con lotes de 5 a 30 leads, keywords, zona administrativa, historial en PocketBase y exportación CSV.

Cada operador crea una cuenta con email y contraseña. Sus lotes y leads quedan asociados a esa cuenta; el historial no mezcla búsquedas de otros usuarios.

## Configuración local

1. Copiá `.env.example` a `.env.local`. `ENVIROMENT=dev` habilita lotes de prueba de 1 o 2 leads; si falta, la app usa `prod` y solo permite lotes desde 5.
2. Completá `APIFY_TOKEN`, `POCKETBASE_SUPERUSER_EMAIL` y `POCKETBASE_SUPERUSER_PASSWORD`.
3. Usá `POCKETBASE_URL=http://127.0.0.1:18098`.
4. Ejecutá `npm run dev`. El comando inicia el túnel SSH `hermes-vps` hacia PocketBase en el VPS y espera a que responda antes de iniciar Next.js. Podés cambiar el alias con `LEADTA_SSH_HOST`.

Para Vercel, configurá `POCKETBASE_URL` como `https://hermes-web.duckdns.org/leadta-pocketbase` y cargá `POCKETBASE_BRIDGE_SECRET` como variable sensible. El VPS valida esa clave en Nginx antes de reenviar tráfico al PocketBase privado. No publiques el puerto `18098`.

El token de Apify y las credenciales de PocketBase solo se leen desde el servidor. La búsqueda de emails habilita el complemento de contactos del Actor, que puede tener un costo adicional en Apify.

## PocketBase en VPS

`deploy/pocketbase/docker-compose.yml` define PocketBase y la app para desplegar en el VPS. PocketBase queda accesible solo desde el loopback del VPS en `127.0.0.1:18098`; el desarrollo local llega mediante el túnel SSH. Las migraciones crean `users`, asocian cada lote al usuario y limitan las consultas de leads a su propietario. Las migraciones pendientes se aplican al iniciar PocketBase.

El contenedor toma `PB_ADMIN_EMAIL` y `PB_ADMIN_PASSWORD` desde `deploy/pocketbase/.env`. No subas ese archivo al repositorio.

Para actualizar la instalación en el VPS, copiá el proyecto sin `node_modules`, `.next`, `.env.local` ni `deploy/pocketbase/data`, y ejecutá `docker compose up -d --build` desde `deploy/pocketbase`. Agregá `APIFY_TOKEN` al archivo `.env` del VPS para habilitar búsquedas.

## CSV

Cada archivo incluye siempre estas columnas: Nombre, Link en Maps, Dirección, Reseñas, Promedio, Teléfono, Mail, Website, Rubro, Dolores y Enriquecimiento. Los datos que falten quedan vacíos.
