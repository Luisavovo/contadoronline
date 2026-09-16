const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos HTML/CSS/JS que estão na mesma pasta do server.js
app.use(express.static(__dirname));

// Configuração do Banco de Dados PostgreSQL
const DATABASE_URL = process.env.DATABASE_URL;
// Bancos locais (compose) não usam SSL; bancos externos (ex: Render) exigem SSL
const bancoLocal = /@(db|localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL || '');
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: bancoLocal ? false : { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura';

// ==========================================
// MIDDLEWARE DE AUTENTICAÇÃO DO CONTADOR
// ==========================================
function autenticarContador(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ erro: 'Sessão não informada. Faça login novamente.' });
    }

    try {
        req.contador = jwt.verify(token, JWT_SECRET);
        next();
    } catch (erro) {
        return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
}

// ==========================================
// MIDDLEWARE DE AUTENTICAÇÃO DA EMPRESA (CLIENTE)
// ==========================================
function autenticarEmpresa(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ erro: 'Sessão não informada. Faça login novamente.' });
    }

    try {
        const dados = jwt.verify(token, JWT_SECRET);
        if (dados.tipo !== 'empresa') {
            return res.status(403).json({ erro: 'Acesso restrito à área do cliente.' });
        }
        req.empresa = dados;
        next();
    } catch (erro) {
        return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
}

// ==========================================
// CONFIGURAÇÃO DE UPLOAD DAS GUIAS (PDF)
// O PDF é guardado no próprio banco (coluna arquivodados), junto com a guia
// ==========================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ==========================================
// ROTA DE CADASTRO DO CONTADOR
// ==========================================
app.post('/api/contador/cadastro', async (req, res) => {
    try {
        let { nomeEscritorio, email, senha } = req.body;
        if (!nomeEscritorio || !email || !senha) {
            return res.status(400).json({ erro: 'Preencha todos os campos.' });
        }

        email = email.trim().toLowerCase();

        const usuarioExiste = await pool.query('SELECT * FROM contadores WHERE LOWER(email) = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ erro: 'Este e-mail já está cadastrado. Faça login ou recupere a senha.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        // Insere preenchendo tanto 'senha' quanto 'senhahash' para evitar qualquer restrição do banco
        await pool.query(
            'INSERT INTO contadores (nomeescritorio, email, senha, senhahash) VALUES ($1, $2, $3, $4)',
            [nomeEscritorio, email, senhaHash, senhaHash]
        );

        res.status(201).json({ mensagem: 'Cadastro realizado com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
    }
});

// ==========================================
// ROTA DE LOGIN DO CONTADOR
// ==========================================
app.post('/api/contador/login', async (req, res) => {
    try {
        let { email, senha } = req.body;
        if (!email || !senha) {
            return res.status(400).json({ erro: 'Preencha o e-mail e a senha.' });
        }

        email = email.trim().toLowerCase();

        const resultado = await pool.query('SELECT * FROM contadores WHERE LOWER(email) = $1', [email]);
        if (resultado.rows.length === 0) {
            return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });
        }

        const contador = resultado.rows[0];
        const senhaArmazenada = contador.senhahash || contador.senha;

        if (!senhaArmazenada) {
            return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });
        }

        const senhaValida = await bcrypt.compare(senha, senhaArmazenada);
        if (!senhaValida) {
            return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });
        }

        const token = jwt.sign({ id: contador.id, email: contador.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            mensagem: 'Login realizado com sucesso!',
            token: token,
            nomeEscritorio: contador.nomeescritorio || 'Escritório',
            contador: {
                nomeEscritorio: contador.nomeescritorio || 'Escritório'
            }
        });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
    }
});

// ==========================================
// ROTA DE LOGIN DA EMPRESA (CLIENTE)
// Aceita o CNPJ (com ou sem pontuação) ou o e-mail cadastrado pela empresa
// ==========================================
app.post('/api/empresa/login', async (req, res) => {
    try {
        const { identificador, senha } = req.body;
        if (!identificador || !senha) {
            return res.status(400).json({ erro: 'Informe o CNPJ (ou e-mail) e a senha.' });
        }

        const cnpjLimpo = String(identificador).replace(/\D/g, '');

        const resultado = await pool.query(
            `SELECT * FROM empresas
             WHERE ($1 <> '' AND REGEXP_REPLACE(COALESCE(cnpj, ''), '\\D', '', 'g') = $1)
                OR LOWER(COALESCE(emailempresa, '')) = $2
             ORDER BY id
             LIMIT 1`,
            [cnpjLimpo, String(identificador).trim().toLowerCase()]
        );

        if (resultado.rows.length === 0) {
            return res.status(400).json({ erro: 'CNPJ/e-mail ou senha incorretos.' });
        }

        const empresa = resultado.rows[0];
        const senhaArmazenada = empresa.senhahash || empresa.senha;

        if (!senhaArmazenada || !(await bcrypt.compare(senha, senhaArmazenada))) {
            return res.status(400).json({ erro: 'CNPJ/e-mail ou senha incorretos.' });
        }

        const token = jwt.sign(
            { id: empresa.id, cnpj: empresa.cnpj, razaoSocial: empresa.razaosocial, tipo: 'empresa' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            mensagem: 'Login realizado com sucesso!',
            token: token,
            empresa: {
                id: empresa.id,
                cnpj: empresa.cnpj,
                razaoSocial: empresa.razaosocial
            }
        });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
    }
});

// ==========================================
// ROTA DE RECUPERAÇÃO / REDEFINIÇÃO DE SENHA
// ==========================================
app.post('/api/contador/esqueci-senha', async (req, res) => {
    try {
        let { email, novaSenha } = req.body;
        if (!email || !novaSenha) {
            return res.status(400).json({ erro: 'Informe o e-mail e a nova senha.' });
        }

        email = email.trim().toLowerCase();

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(novaSenha, salt);

        // Atualiza ambas as colunas para garantir compatibilidade total
        const atualizacao = await pool.query(
            'UPDATE contadores SET senha = $1, senhahash = $2 WHERE LOWER(email) = $3',
            [senhaHash, senhaHash, email]
        );

        if (atualizacao.rowCount === 0) {
            return res.status(404).json({ erro: 'E-mail não encontrado no sistema.' });
        }

        res.json({ mensagem: 'Senha redefinida com sucesso! Agora você pode fazer login.' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
    }
});

// ==========================================
// ROTA: LISTAR EMPRESAS DO CONTADOR
// ==========================================
app.get('/api/empresas', autenticarContador, async (req, res) => {
    try {
        const resultado = await pool.query(
            'SELECT id, cnpj, razaosocial, emailempresa, datacriacao FROM empresas WHERE contador_id = $1 ORDER BY datacriacao DESC',
            [req.contador.id]
        );
        res.json(resultado.rows);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao carregar empresas: ' + erro.message });
    }
});

// ==========================================
// ROTA: CADASTRAR EMPRESA
// Usada pelo painel do contador (autenticado) e pelo autocadastro (cadastro.html)
// ==========================================
app.post('/api/cadastrar-empresa', async (req, res) => {
    try {
        let { cnpj, razaoSocial, emailEmpresa, senha } = req.body;
        if (!cnpj || !razaoSocial || !senha) {
            return res.status(400).json({ erro: 'Preencha o CNPJ, a Razão Social e a Senha.' });
        }

        cnpj = cnpj.replace(/\D/g, '');

        const jaExiste = await pool.query('SELECT id FROM empresas WHERE cnpj = $1', [cnpj]);
        if (jaExiste.rows.length > 0) {
            return res.status(400).json({ erro: 'Este CNPJ já está cadastrado.' });
        }

        // O contador é identificado pelo token, quando enviado
        let contadorId = null;
        const authHeader = req.headers.authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            try {
                contadorId = jwt.verify(authHeader.slice(7), JWT_SECRET).id;
            } catch (erro) {
                return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
            }
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        const inserido = await pool.query(
            'INSERT INTO empresas (cnpj, razaosocial, emailempresa, senha, senhahash, contador_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [cnpj, razaoSocial, emailEmpresa || null, senhaHash, senhaHash, contadorId]
        );

        res.status(201).json({ mensagem: 'Empresa cadastrada com sucesso!', id: inserido.rows[0].id });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao cadastrar empresa: ' + erro.message });
    }
});

// ==========================================
// ROTA: EXCLUIR EMPRESA (E SUAS GUIAS)
// ==========================================
app.delete('/api/empresas/:id', autenticarContador, async (req, res) => {
    try {
        const empresa = await pool.query(
            'SELECT cnpj FROM empresas WHERE id = $1 AND contador_id = $2',
            [req.params.id, req.contador.id]
        );

        if (empresa.rows.length === 0) {
            return res.status(404).json({ erro: 'Empresa não encontrada.' });
        }

        const cnpjLimpo = String(empresa.rows[0].cnpj || '').replace(/\D/g, '');
        await pool.query("DELETE FROM guias WHERE REGEXP_REPLACE(COALESCE(cnpj, ''), '\\D', '', 'g') = $1", [cnpjLimpo]);
        await pool.query('DELETE FROM tributos WHERE empresaid = $1', [req.params.id]);
        await pool.query('DELETE FROM empresas WHERE id = $1', [req.params.id]);

        res.json({ mensagem: 'Empresa excluída com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao excluir empresa: ' + erro.message });
    }
});

// ==========================================
// ROTA: ENVIAR / VINCULAR GUIA (PDF) A UMA EMPRESA
// ==========================================
app.post('/api/guias', autenticarContador, upload.single('arquivoPdf'), async (req, res) => {
    try {
        const { cnpj, tipoImposto, competencia, valor, vencimento, pix } = req.body;
        if (!cnpj || !tipoImposto || !competencia || !valor || !vencimento || !req.file) {
            return res.status(400).json({ erro: 'Preencha todos os campos e anexe o arquivo PDF.' });
        }

        await pool.query(
            `INSERT INTO guias (cnpj, tipoimposto, competencia, valor, vencimento, pix, arquivonome, arquivodados, arquivotipo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                cnpj,
                tipoImposto,
                competencia,
                valor,
                vencimento,
                pix || null,
                req.file.originalname,
                req.file.buffer,
                req.file.mimetype
            ]
        );

        res.status(201).json({ mensagem: 'Guia cadastrada e enviada com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao cadastrar guia: ' + erro.message });
    }
});

// ==========================================
// ROTA: GUIAS E TRIBUTOS DO CLIENTE LOGADO
// ==========================================
app.get('/api/meus-impostos', autenticarEmpresa, async (req, res) => {
    try {
        const cnpjLimpo = String(req.empresa.cnpj || '').replace(/\D/g, '');

        const guias = await pool.query(
            `SELECT id, tipoimposto, competencia AS mesreferencia, valor, vencimento AS datavencimento,
                    NULLIF(pix, '') AS codigopix, 'Pendente' AS statuspagamento
             FROM guias
             WHERE REGEXP_REPLACE(COALESCE(cnpj, ''), '\\D', '', 'g') = $1
             ORDER BY vencimento DESC NULLS LAST, id DESC`,
            [cnpjLimpo]
        );

        const tributos = await pool.query(
            `SELECT id, tipoimposto, mesreferencia, valor, datavencimento, NULLIF(codigopix, '') AS codigopix,
                    caminhopdf, statuspagamento
             FROM tributos
             WHERE empresaid = $1
             ORDER BY datavencimento DESC NULLS LAST, id DESC`,
            [req.empresa.id]
        );

        const lista = [
            ...guias.rows.map(g => ({ ...g, pdfurl: `/api/guias/${g.id}/pdf` })),
            ...tributos.rows.map(t => {
                // O PDF dos tributos fica em disco; só oferece o link se o arquivo existir aqui
                const caminho = t.caminhopdf ? path.join(__dirname, t.caminhopdf) : null;
                return { ...t, pdfurl: caminho && fs.existsSync(caminho) ? `/${t.caminhopdf}` : null };
            })
        ];

        res.json(lista);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao carregar seus impostos: ' + erro.message });
    }
});

// ==========================================
// ROTA: BAIXAR O PDF DA GUIA (CLIENTE LOGADO)
// ==========================================
app.get('/api/guias/:id/pdf', autenticarEmpresa, async (req, res) => {
    try {
        const resultado = await pool.query(
            `SELECT arquivonome, arquivodados, arquivotipo
             FROM guias g
             WHERE g.id = $1
               AND REGEXP_REPLACE(COALESCE(g.cnpj, ''), '\\D', '', 'g') = $2`,
            [req.params.id, String(req.empresa.cnpj || '').replace(/\D/g, '')]
        );

        if (resultado.rows.length === 0 || !resultado.rows[0].arquivodados) {
            return res.status(404).json({ erro: 'Arquivo não encontrado.' });
        }

        const { arquivonome, arquivodados, arquivotipo } = resultado.rows[0];
        res.setHeader('Content-Type', arquivotipo || 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${arquivonome || 'guia.pdf'}"`);
        res.send(arquivodados);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao abrir o PDF: ' + erro.message });
    }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});