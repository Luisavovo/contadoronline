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
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
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
// CONFIGURAÇÃO DE UPLOAD DAS GUIAS (PDF)
// ==========================================
const pastaGuias = path.join(__dirname, 'uploads', 'guias');
fs.mkdirSync(pastaGuias, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, pastaGuias),
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
    }),
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

        await pool.query('DELETE FROM guias WHERE empresa_cnpj = $1', [empresa.rows[0].cnpj]);
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
        let { cnpj, tipoImposto, competencia, valor, vencimento, pix } = req.body;
        if (!cnpj || !tipoImposto || !competencia || !valor || !vencimento || !req.file) {
            return res.status(400).json({ erro: 'Preencha todos os campos e anexe o arquivo PDF.' });
        }

        const cnpjLimpo = cnpj.replace(/\D/g, '');
        const caminhoPdf = 'uploads/guias/' + req.file.filename;

        await pool.query(
            'INSERT INTO guias (empresa_cnpj, tipoimposto, mesreferencia, valor, datavencimento, codigopix, caminhopdf) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [cnpjLimpo, tipoImposto, competencia, valor, vencimento, pix || null, caminhoPdf]
        );

        res.status(201).json({ mensagem: 'Guia cadastrada e enviada com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao cadastrar guia: ' + erro.message });
    }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});