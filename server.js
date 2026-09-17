const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos da pasta do projeto (HTML, CSS, JS do frontend)
app.use(express.static(__dirname));

// Configuração do Banco de Dados PostgreSQL (usando a URL da Render)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://coontadoronnline_user:7rpGNrhb0DGachE29ibe9q5mNESBQnh4@dpg-daljnhm5vjqs73fl8ep0-a/coontadoronnline',
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura';

// Configuração do Multer para salvar arquivos PDF direto na memória (para o tipo bytea do Postgres)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware de Autenticação do Contador
function verificarTokenContador(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido.' });

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.contadorId = decoded.id;
        next();
    } catch (err) {
        return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    }
}

// ==========================================
// 1. ROTAS DE CONTADORES (Autenticação)
// ==========================================

app.post('/api/contador/cadastro', async (req, res) => {
    try {
        let { nomeEscritorio, email, senha } = req.body;
        if (!nomeEscritorio || !email || !senha) {
            return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });
        }

        email = email.trim().toLowerCase();
        const usuarioExiste = await pool.query('SELECT * FROM contadores WHERE LOWER(email) = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        await pool.query(
            'INSERT INTO contadores (nomeescritorio, email, senha, senhahash, datacriacao) VALUES ($1, $2, $3, $4, NOW())',
            [nomeEscritorio, email, senhaHash, senhaHash]
        );

        res.status(201).json({ mensagem: 'Escritório cadastrado com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro no servidor: ' + erro.message });
    }
});

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
        const senhaValida = await bcrypt.compare(senha, senhaArmazenada);
        
        if (!senhaValida) {
            return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });
        }

        const token = jwt.sign({ id: contador.id, email: contador.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            mensagem: 'Login realizado com sucesso!',
            token,
            nomeEscritorio: contador.nomeescritorio || 'Escritório'
        });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro no servidor: ' + erro.message });
    }
});

// ==========================================
// 2. ROTAS DE EMPRESAS (Clientes)
// ==========================================

app.get('/api/empresas', verificarTokenContador, async (req, res) => {
    try {
        const empresas = await pool.query(
            'SELECT * FROM empresas WHERE contador_id = $1 OR contadorid = $1 ORDER BY datacriacao DESC',
            [req.contadorId]
        );
        res.json(empresas.rows);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao buscar empresas: ' + erro.message });
    }
});

app.post('/api/cadastrar-empresa', async (req, res) => {
    try {
        let { cnpj, razaoSocial, emailEmpresa, senha } = req.body;
        if (!cnpj || !razaoSocial || !senha) {
            return res.status(400).json({ erro: 'Preencha os campos obrigatórios.' });
        }

        const cnpjLimpo = cnpj.replace(/\D/g, '');
        const empresaExiste = await pool.query('SELECT * FROM empresas WHERE cnpj = $1', [cnpjLimpo]);
        if (empresaExiste.rows.length > 0) {
            return res.status(400).json({ erro: 'Este CNPJ já está cadastrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        let contadorId = null;
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                contadorId = decoded.id;
            } catch (e) { /* Token opcional para cadastro público */ }
        }

        await pool.query(
            `INSERT INTO empresas (cnpj, razaosocial, emailempresa, senha, senhahash, contador_id, contadorid, datacriacao) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [cnpjLimpo, razaoSocial, emailEmpresa || '', senhaHash, senhaHash, contadorId, contadorId]
        );

        res.status(201).json({ mensagem: 'Empresa cadastrada com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao cadastrar empresa: ' + erro.message });
    }
});

app.delete('/api/empresas/:id', verificarTokenContador, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM empresas WHERE id = $1 AND (contador_id = $2 OR contadorid = $2)', [id, req.contadorId]);
        res.json({ mensagem: 'Empresa excluída com sucesso.' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao excluir empresa: ' + erro.message });
    }
});

// ==========================================
// 3. ROTAS DE GUIAS E IMPOSTOS
// ==========================================

// Enviar Guia (PDF) para uma empresa (Usando 'arquivo' para coincidir com o front-end)
app.post('/api/guias', verificarTokenContador, upload.single('arquivo'), async (req, res) => {
    try {
        const { cnpj, tipoimposto, competencia, valor, vencimento, pix } = req.body;
        
        let arquivoNome = null;
        let arquivoDados = null;
        let arquivoTipo = null;

        if (req.file) {
            arquivoNome = req.file.originalname;
            arquivoDados = req.file.buffer; // Conteúdo binário do PDF
            arquivoTipo = req.file.mimetype;
        }

        const cnpjLimpo = cnpj ? cnpj.replace(/\D/g, '') : '';

        await pool.query(
            `INSERT INTO guias (cnpj, tipoimposto, competencia, valor, vencimento, pix, arquivonome, arquivodados, arquivotipo, datacriacao) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [cnpjLimpo, tipoimposto, competencia, valor || 0, vencimento || null, pix || '', arquivoNome, arquivoDados, arquivoTipo]
        );

        res.status(201).json({ mensagem: 'Guia cadastrada e enviada com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao salvar guia: ' + erro.message });
    }
});

app.get('/api/guias/:cnpj', async (req, res) => {
    try {
        const cnpjLimpo = req.params.cnpj.replace(/\D/g, '');
        const guias = await pool.query(
            'SELECT id, cnpj, tipoimposto, competencia, valor, vencimento, pix, arquivonome, arquivotipo, datacriacao FROM guias WHERE cnpj = $1 ORDER BY datacriacao DESC',
            [cnpjLimpo]
        );
        res.json(guias.rows);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao buscar guias: ' + erro.message });
    }
});

app.get('/api/guias/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query('SELECT arquivonome, arquivodados, arquivotipo FROM guias WHERE id = $1', [id]);
        
        if (resultado.rows.length === 0 || !resultado.rows[0].arquivodados) {
            return res.status(404).json({ erro: 'Arquivo PDF não encontrado.' });
        }

        const guia = resultado.rows[0];
        res.setHeader('Content-Type', guia.arquivotipo || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${guia.arquivonome || 'guia.pdf'}"`);
        res.send(guia.arquivodados);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao realizar download: ' + erro.message });
    }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
