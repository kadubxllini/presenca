const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10kb' })); // Limita o tamanho do JSON recebido para evitar DoS
app.use(express.static(path.join(__dirname, 'public')));

// Cabeçalhos de Segurança HTTP (Security Headers)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Funções de Criptografia Segura de Senha (Scrypt + Salt com Timing-Safe Check)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!stored.includes(':')) {
    // Compatibilidade com senhas antigas registradas antes da criptografia
    return password === stored;
  }
  const [salt, originalHash] = stored.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

// Conexão com o banco de dados SQLite
const dbDir = path.join(__dirname, 'database');
const fs = require('fs');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'banco.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados SQLite:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite (database/banco.db)');
  }
});

// Inicialização das tabelas
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL;');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6d5dfc',
      absence_limit REAL NOT NULL DEFAULT 25,
      total_hours INTEGER NOT NULL DEFAULT 60,
      days TEXT NOT NULL,
      absence_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
});

// Helper de Promisify para o sqlite3
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

// --- ROTAS DA API ---

// 1. Cadastro
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'E-mail e uma senha de no mínimo 6 caracteres são obrigatórios.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@') || cleanEmail.length > 100) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    const finalName = (name && typeof name === 'string' && name.trim()) ? name.trim().slice(0, 50) : cleanEmail.split('@')[0];

    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existingUser) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado. Faça login.' });
    }

    const id = crypto.randomUUID();
    const hashedPassword = hashPassword(password);

    await dbRun(
      'INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)',
      [id, finalName, cleanEmail, hashedPassword]
    );

    res.status(201).json({ id, name: finalName, email: cleanEmail });
  } catch (err) {
    console.error('Erro no registro:', err);
    res.status(500).json({ error: 'Erro ao cadastrar usuário no servidor.' });
  }
});

// 2. Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await dbGet('SELECT id, name, email, password FROM users WHERE email = ?', [cleanEmail]);

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro ao realizar login no servidor.' });
  }
});

// 3. Listar Matérias do Usuário
app.get('/api/subjects/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const rows = await dbAll('SELECT * FROM subjects WHERE user_id = ? ORDER BY created_at ASC', [userId]);

    const subjects = rows.map(r => ({
      ...r,
      days: JSON.parse(r.days || '[]')
    }));

    res.json(subjects);
  } catch (err) {
    console.error('Erro ao buscar matérias:', err);
    res.status(500).json({ error: 'Erro ao carregar matérias.' });
  }
});

// 4. Adicionar ou Editar Matéria
app.post('/api/subjects', async (req, res) => {
  try {
    const { id, user_id, name, color, absence_limit, total_hours, days, absence_count } = req.body;

    if (!user_id || !name || !days) {
      return res.status(400).json({ error: 'Dados incompletos para a matéria.' });
    }

    const daysStr = JSON.stringify(days);

    if (id) {
      // Atualizar existente
      await dbRun(
        `UPDATE subjects 
         SET name = ?, color = ?, absence_limit = ?, total_hours = ?, days = ?
         WHERE id = ? AND user_id = ?`,
        [name, color || '#6d5dfc', absence_limit || 25, total_hours || 60, daysStr, id, user_id]
      );
      const updated = await dbGet('SELECT * FROM subjects WHERE id = ?', [id]);
      return res.json({ ...updated, days: JSON.parse(updated.days) });
    } else {
      // Criar nova
      const newId = crypto.randomUUID();
      await dbRun(
        `INSERT INTO subjects (id, user_id, name, color, absence_limit, total_hours, days, absence_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, user_id, name, color || '#6d5dfc', absence_limit || 25, total_hours || 60, daysStr, absence_count || 0]
      );
      const created = await dbGet('SELECT * FROM subjects WHERE id = ?', [newId]);
      return res.status(201).json({ ...created, days: JSON.parse(created.days) });
    }
  } catch (err) {
    console.error('Erro ao salvar matéria:', err);
    res.status(500).json({ error: 'Erro ao salvar matéria no banco de dados.' });
  }
});

// 5. Atualizar Faltas (+1 ou -1)
app.patch('/api/subjects/:id/absence', async (req, res) => {
  try {
    const { id } = req.params;
    const { absence_count } = req.body;

    await dbRun('UPDATE subjects SET absence_count = ? WHERE id = ?', [absence_count, id]);
    const updated = await dbGet('SELECT * FROM subjects WHERE id = ?', [id]);
    res.json({ ...updated, days: JSON.parse(updated.days) });
  } catch (err) {
    console.error('Erro ao atualizar faltas:', err);
    res.status(500).json({ error: 'Erro ao atualizar faltas.' });
  }
});

// 6. Excluir Matéria
app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM subjects WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir matéria:', err);
    res.status(500).json({ error: 'Erro ao excluir matéria.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando com SQLite na porta ${PORT} (http://localhost:${PORT})`);
});
