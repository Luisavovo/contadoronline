const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos (HTML, CSS, JS, etc.)
app.use(express.static(__dirname));

// Configuração do Banco de Dados PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura';

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
// ROTAS DE CONTADORES
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
            return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        await pool.query(
            'INSERT INTO contadores (nomeescritorio, email, senha, senhahash) VALUES ($1, $2, $3, $4)',
            [nomeEscritorio, email, senhaHash, senhaHash]
        );

        res.status(201).json({ mensagem: 'Escritório cadastrado com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
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
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
    }
});

app.post('/api/contador/esqueci-senha', async (req, res) => {
    try {
        let { email, novaSenha } = req.body;
        if (!email || !novaSenha) {
            return res.status(400).json({ erro: 'Informe o e-mail e a nova senha.' });
        }

        email = email.trim().toLowerCase();
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(novaSenha, salt);

        const atualizacao = await pool.query(
            'UPDATE contadores SET senha = $1, senhahash = $2 WHERE LOWER(email) = $3',
            [senhaHash, senhaHash, email]
        );

        if (atualizacao.rowCount === 0) {
            return res.status(404).json({ erro: 'E-mail não encontrado.' });
        }

        res.json({ mensagem: 'Senha redefinida com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor: ' + erro.message });
    }
});

// ==========================================
// ROTAS DE EMPRESAS (CLIENTES DO CONTADOR)
// ==========================================

// Listar empresas do contador logado
app.get('/api/empresas', verificarTokenContador, async (req, res) => {
    try {
        const empresas = await pool.query(
            'SELECT * FROM empresas WHERE contador_id = $1 ORDER BY datacriacao DESC',
            [req.contadorId]
        );
        res.json(empresas.rows);
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao buscar empresas: ' + erro.message });
    }
});

// Cadastrar nova empresa cliente
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

        // Se houver um contador autenticado via token, associa a ele, senão salva de forma avulsa
        let contadorId = null;
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                contadorId = decoded.id;
            } catch (e) { /* Ignora se for cadastro público */ }
        }

        await pool.query(
            `INSERT INTO empresas (cnpj, razaosocial, emailempresa, senha, senhahash, contador_id, datacriacao) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [cnpjLimpo, razaoSocial, emailEmpresa || '', senhaHash, senhaHash, contadorId]
        );

        res.status(201).json({ mensagem: 'Empresa cadastrada com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao cadastrar empresa: ' + erro.message });
    }
});

// Excluir empresa
app.delete('/api/empresas/:id', verificarTokenContador, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM empresas WHERE id = $1 AND contador_id = $2', [id, req.contadorId]);
        res.json({ mensagem: 'Empresa excluída com sucesso.' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao excluir empresa: ' + erro.message });
    }
});

// ==========================================
// ROTAS DE GUIAS E IMPOSTOS
// ==========================================

// Listar impostos para a empresa logada (Painel do Cliente)
app.get('/api/meus-impostos', async (req, res) => {
    // Implementar a lógica para retornar as guias baseadas na sessão/token da empresa cliente
    res.json([]);
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
