-- Schema for Contador Online
-- Tables inferred from server.js and frontend HTML pages

-- Accountants (contadores) — used by existing auth routes in server.js
CREATE TABLE IF NOT EXISTS contadores (
    id              SERIAL PRIMARY KEY,
    nomeescritorio  VARCHAR(255),
    email           VARCHAR(255) UNIQUE NOT NULL,
    senha           TEXT,
    senhahash       TEXT
);

-- Client companies (empresas) — referenced by admin.html / cadastro.html
CREATE TABLE IF NOT EXISTS empresas (
    id              SERIAL PRIMARY KEY,
    cnpj            VARCHAR(20),
    razaosocial     VARCHAR(255),
    emailempresa    VARCHAR(255),
    senha           TEXT,
    senhahash       TEXT,
    contador_id     INTEGER REFERENCES contadores(id) ON DELETE CASCADE,
    datacriacao     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tax guides (guias) — referenced by admin_upload.html / dashboard.html
CREATE TABLE IF NOT EXISTS guias (
    id              SERIAL PRIMARY KEY,
    empresa_cnpj    VARCHAR(20),
    tipoimposto     VARCHAR(50),
    mesreferencia   VARCHAR(20),
    valor           NUMERIC(12,2),
    datavencimento  DATE,
    codigopix       TEXT,
    caminhopdf      VARCHAR(500),
    statuspagamento VARCHAR(20) DEFAULT 'PENDENTE'
);
