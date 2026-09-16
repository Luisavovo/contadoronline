-- Schema do Contador Online (espelha o banco de produção, ex: Render)

-- Contadores (escritórios de contabilidade)
CREATE TABLE IF NOT EXISTS contadores (
    id              SERIAL PRIMARY KEY,
    nomeescritorio  VARCHAR(255),
    email           VARCHAR(255) UNIQUE NOT NULL,
    senha           TEXT,
    senhahash       TEXT,
    datacriacao     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Empresas clientes
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

-- Guias enviadas pelo contador (o PDF fica guardado na própria base)
CREATE TABLE IF NOT EXISTS guias (
    id              SERIAL PRIMARY KEY,
    cnpj            VARCHAR(20),
    tipoimposto     VARCHAR(50),
    competencia     VARCHAR(20),
    valor           NUMERIC(12,2),
    vencimento      DATE,
    pix             TEXT,
    arquivonome     VARCHAR(255),
    arquivodados    BYTEA,
    arquivotipo     VARCHAR(100),
    datacriacao     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tributos já lançados para a empresa (histórico)
CREATE TABLE IF NOT EXISTS tributos (
    id              SERIAL PRIMARY KEY,
    empresaid       INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
    mesreferencia   VARCHAR(20),
    tipoimposto     VARCHAR(50),
    valor           NUMERIC(12,2),
    datavencimento  DATE,
    codigopix       TEXT,
    caminhopdf      VARCHAR(500),
    statuspagamento VARCHAR(20) DEFAULT 'Pendente',
    datacriacao     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);