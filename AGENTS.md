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

## ⚠️ Missing API endpoints
`server.js` only implements three routes (`/api/contador/cadastro`, `/api/contador/login`,
`/api/contador/esqueci-senha`). The frontend pages also call these endpoints that are **not
yet implemented** in the server:
- `GET /api/empresas` — list companies for logged-in contador
- `POST /api/cadastrar-empresa` — register a company
- `DELETE /api/empresas/:id` — delete a company
- `POST /api/guias` — upload a tax guide PDF (needs multer)
- `GET /api/meus-impostos` — list guides for a client company

These pages will render but their data calls will 404 until the endpoints are added.

## Dev notes
- `DB_SSL=false` is set in compose to disable SSL for the local PostgreSQL (production
  keeps SSL on by default — the code checks `process.env.DB_SSL`).
- `nodemon` is used for live reload of `server.js` changes. HTML changes are picked up
  on browser refresh (served statically, no build step).
- `cors()` is enabled globally — not strictly needed (single-origin) but harmless.
