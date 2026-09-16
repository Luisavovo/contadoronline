# AGENTS.md — Contador Online

## Overview
Brazilian accountant platform. Single Express server (`server.js`) serves static
HTML pages and a small set of JSON API routes. PostgreSQL backend.

## Stack
- **Runtime:** Node.js (Express) — `server.js` at repo root
- **Database:** PostgreSQL (compose service `db`, or an external DB — see below)
- **Frontend:** Plain HTML + Tailwind CDN (no build step, served statically by Express)
- **Auth:** bcryptjs password hashing, JWT tokens stored in localStorage
  (contador: `tokenContador` / `nomeEscritorio`; cliente: `token` / `empresa`)

## Running locally (Base44)
```bash
docker compose -f docker-compose.base44.yml up -d --build
```
- App on **port 3000** (mapped from container 3000)
- `JWT_SECRET` is delivered via `/run/base44/app.env` (platform-managed)
- Local DB schema comes from `.base44/init.sql` on first DB boot

## Two access flows
- **Contador** — `index.html` / `contador-login.html` → `admin.html` (register client
  companies, including the client's password) → `admin_upload.html` (upload a guide PDF).
- **Cliente (empresa)** — `cliente.html` (login with CNPJ **or** company e-mail + the
  password the contador set) → `dashboard.html` (view its guides/taxes, copy PIX, open PDFs).

## Key files
| File | Purpose |
|------|---------|
| `server.js` | Express server — static files + API routes |
| `index.html` | Contador login / register / password reset (entry point, links to `cliente.html`) |
| `contador-login.html` | Alternate contador login page |
| `admin.html` | Contador dashboard — manage client companies |
| `admin_upload.html` | Upload tax guide PDFs for a company |
| `cadastro.html` | Self-service company registration |
| `cliente.html` | Client (empresa) login page |
| `dashboard.html` | Client (empresa) panel — view tax guides |

## Database tables (mirrors the production schema)
- `contadores` — accountant accounts (`nomeescritorio`, `email`, `senha`, `senhahash`)
- `empresas` — client companies (`cnpj`, `razaosocial`, `emailempresa`, `senha`, `senhahash`,
  `contador_id`; production also has a legacy `contadorid` column)
- `guias` — guides uploaded by the contador. The **PDF lives in the DB** as `arquivodados`
  (bytea), with `arquivonome` / `arquivotipo`. Dates: `vencimento`; month ref: `competencia`.
- `tributos` — older/legacy tax entries (linked by `empresaid`) with `mesreferencia`,
  `datavencimento`, `codigopix`, `caminhopdf`, `statuspagamento`. Its PDFs are files on disk
  under `uploads/`, which is why `dashboard` only offers the link when the file exists locally.

⚠️ `guias` and `tributos` have **different column names**. Don't mix them up:
`guias` = `cnpj` / `competencia` / `vencimento` / `pix`; `tributos` = `empresaid` /
`mesreferencia` / `datavencimento` / `codigopix`.

## API routes (server.js)
- `POST /api/contador/cadastro` / `login` / `esqueci-senha` — accountant auth
- `POST /api/empresa/login` — client auth. Body `{ identificador, senha }`, where
  `identificador` is the CNPJ (any punctuation) **or** the company e-mail. Returns
  `{ token, empresa: { id, cnpj, razaoSocial } }` with a JWT carrying `tipo: 'empresa'`.
- `GET /api/empresas` — list companies for the logged-in contador (Bearer token)
- `POST /api/cadastrar-empresa` — register a company (token optional; used by panel + self-signup)
- `DELETE /api/empresas/:id` — delete a company, its guias and tributos (Bearer token)
- `POST /api/guias` — upload a guide PDF, multipart field `arquivoPdf` (Bearer contador token).
  Stores the file in `guias.arquivodados`.
- `GET /api/meus-impostos` — the logged-in client's guides + taxes (Bearer empresa token)
- `GET /api/guias/:id/pdf` — streams a guide PDF from the DB (Bearer empresa token; the guide
  must belong to the client's CNPJ)

Contador routes use `autenticarContador`; client routes use `autenticarEmpresa` (JWT from
`Authorization: Bearer`, and it rejects tokens that are not `tipo === 'empresa'`).

## Dev notes
- `DATABASE_URL` defaults to the local compose PostgreSQL via `.env.base44-defaults`, which is
  listed FIRST in the app's `env_file` so a platform secret in `/run/base44/app.env` (listed
  last) overrides it. To use an external database (e.g. Render), set the `DATABASE_URL` secret
  to Render's **External Database URL** — an Internal URL is only reachable from Render itself.
- SSL is auto-detected in `server.js`: local hosts (`db` / `localhost` / `127.0.0.1`) connect
  without SSL, external hosts connect with SSL (`rejectUnauthorized: false`, required by Render).
- CNPJ values are stored **both** formatted (`65.780.088/0001-57`) and digits-only depending on
  the row, so any CNPJ comparison must normalise with
  `REGEXP_REPLACE(COALESCE(cnpj,''), '\D', '', 'g')` (in SQL, `'\D'` with
  `standard_conforming_strings` on; in JS strings, write `'\\D'`).
- `nodemon` is used for live reload of `server.js` changes. HTML changes are picked up
  on browser refresh (served statically, no build step).
- `nodemon` ignores `package.json` / `package-lock.json` so that a dependency edit does not
  hot-restart `server.js` before the module exists. After changing dependencies, run
  `docker compose -f docker-compose.base44.yml restart app` to reinstall them.
- `cors()` is enabled globally — not strictly needed (single-origin) but harmless.