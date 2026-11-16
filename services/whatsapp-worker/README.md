# leadta WhatsApp worker

Standalone Baileys (`baileys@7.0.0-rc14`) service. Each leadta user links their WhatsApp by scanning a QR code. Outreach messages are queued per user and sent with a delay between them and a daily cap. Sent, failed and replied events go back to the Next.js app as callbacks.

## Env

| Var | Default | Notes |
| --- | --- | --- |
| `WHATSAPP_WORKER_SECRET` | required | At least 32 chars. Used as the Bearer token in both directions. |
| `WHATSAPP_CALLBACK_URL` | required | Next.js endpoint that receives callbacks. |
| `PORT` | 8787 | |
| `DATA_DIR` | /data | Holds `queue.json`, `sessions/<userId>/` (auth) and `users/<userId>/contacts.json`. |
| Monthly message cap | 100 | Per user, fixed in code (same as the app's `WHATSAPP_MONTHLY_LIMIT`). The month rolls over at midnight of the 1st, America/Argentina/Buenos_Aires. |
| `MIN_DELAY_S` / `MAX_DELAY_S` | 45 / 120 | Random gap between two sends from the same user. |
| `LOG_LEVEL` | warn | pino level. Baileys' own logs stay at warn unless this is set to debug or trace. |

## API

Every route except `GET /health` requires `Authorization: Bearer <secret>`. `userId` must be 15 alphanumeric chars. Bodies are JSON, up to 64 KB.

- `GET /health` returns `{ ok: true }`.
- `GET /sessions/:userId` returns a `SessionState`: `{ status, qr, phone, sentThisMonth, monthlyLimit, queued }`.
- `POST /sessions/:userId/start` starts the session, or returns the existing one. It is idempotent and returns a `SessionState`.
- `DELETE /sessions/:userId` logs out, deletes the auth, the queue and the contacts, then returns `{ status: "disconnected" }`.
- `POST /sessions/:userId/messages` takes `{ items: [{ ref, leadId, phone, text }] }` (1 to 10 items) and returns `{ queued, duplicates, invalid: [{ ref, reason }], etaSeconds }`. It answers 409 `not_connected` when the session is not connected.

Callbacks are sent as POST requests to `WHATSAPP_CALLBACK_URL` with the same Bearer token:

- `{ type: "sent", userId, leadId, ref, text, at }`
- `{ type: "failed", userId, leadId, ref, reason, at }`
- `{ type: "replied", userId, leadId, text, at }`

"Programados" clock: every minute the worker POSTs to `/api/scheduled/dispatch` on the same origin as `WHATSAPP_CALLBACK_URL` (same Bearer token), one call at a time. The app sends the scheduled emails and WhatsApp messages that are due.

## Deploy (VPS with Docker and nginx)

```sh
cp .env.example .env    # then set a real secret: openssl rand -hex 32
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

The port is bound to `127.0.0.1` only, so put nginx with HTTPS in front of it:

```nginx
server {
  listen 443 ssl http2;
  server_name wa.example.com;
  ssl_certificate     /etc/letsencrypt/live/wa.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/wa.example.com/privkey.pem;
  client_max_body_size 64k;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }
}
```

Get the certificate with `certbot --nginx -d wa.example.com`. Then set the worker URL and the same secret in the Next.js app's environment.

Data lives in the named volume `whatsapp-data`. Back it up: losing it unlinks every user.
