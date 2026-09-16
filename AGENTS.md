# AGENTS.md — Contador Online

## Overview
Brazilian accountant platform. Single Express server (`server.js`) serves static
HTML pages and a small set of JSON API routes. PostgreSQL backend.

## Stack
- **Runtime:** Node.js (Express) — `server.js` at repo root
- **Database:** PostgreSQL 16 (compose service `db`)
- **Frontend:** Plain HTML + Tailwind CDN (no build step, served statically by Express)
- **Auth:** bcryptjs password hashing, JWT tokens stored in localStorage

## Running locally (Base44)
```bash
docker compose -f docker-compose.base44.yml up -d --build
```
- App on **port 3000** (mapped from container 3000)
- DB credentials are inline in `docker-compose.base44.yml` (local infra, not secrets)
- `JWT_SECRET` is delivered via `/run/base44/app.env` (platform-managed)
- DB schema auto-created from `.base44/init.sql` on first DB boot

## Key files
| File | Purpose |
|------|---------|
| `server.js` | Express server — static files + API routes |
| `index.html` | Contador login / register / password reset (entry point) |
| `contador-login.html` | Alternate contador login page |
| `admin.html` | Contador dashboard — manage client companies |
| `admin_upload.html` | Upload tax guide PDFs for a company |
| `cadastro.html` | Self-service company registration |
| `dashboard.html` | Client (empresa) panel — view tax guides |
| `uploads/guias/` | Uploaded PDF storage |

## Database tables
- `contadores` — accountant accounts (used by existing server routes)
- `empresas` — client companies
- `guias` — tax guide records (PDFs, values, PIX codes)

## API routes (server.js)
- `POST /api/contador/cadastro` / `login` / `esqueci-senha` — accountant auth
- `GET /api/empresas` — list companies for the logged-in contador (Bearer token)
- `POST /api/cadastrar-empresa` — register a company (token optional; used by panel + self-signup)
- `DELETE /api/empresas/:id` — delete a company and its guias (Bearer token)
- `POST /api/guias` — upload a tax guide PDF, multipart field `arquivoPdf` (Bearer token)

Contador routes are protected by `autenticarContador` (JWT from `Authorization: Bearer`).

## ⚠️ Still not implemented
- `GET /api/meus-impostos` — the client (empresa) dashboard `dashboard.html` expects this, but
  there is **no client login route** that issues the `token`/`empresa` values it reads from
  localStorage, so that page is unreachable. Needs a client auth flow before it can work.

## Dev notes
- `DATABASE_URL` defaults to the local compose PostgreSQL via `.env.base44-defaults`, which is
  listed FIRST in the app's `env_file` so a platform secret in `/run/base44/app.env` (listed
  last) overrides it. To use an external database (e.g. Render), set the `DATABASE_URL` secret
  to Render's **External Database URL** — an Internal URL is only reachable from Render itself.
- SSL is auto-detected in `server.js`: local hosts (`db` / `localhost` / `127.0.0.1`) connect
  without SSL, external hosts connect with SSL (`rejectUnauthorized: false`, required by Render).
- `nodemon` is used for live reload of `server.js` changes. HTML changes are picked up
  on browser refresh (served statically, no build step).
- `nodemon` ignores `package.json` / `package-lock.json` so that a dependency edit does not
  hot-restart `server.js` before the module exists. After changing dependencies, run
  `docker compose -f docker-compose.base44.yml restart app` to reinstall them.
- `cors()` is enabled globally — not strictly needed (single-origin) but harmless.
