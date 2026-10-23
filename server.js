const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 'loopback');
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
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database', 'banco.db');
const dbDir = path.dirname(dbPath);

const fs = require('fs');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados SQLite:', err.message);
  } else {
    console.log(`Conectado ao banco de dados SQLite em: ${dbPath}`);
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
      settings TEXT DEFAULT '{"absence_step_hours": 2, "display_mode": "aulas"}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Adiciona a coluna settings caso a tabela já tenha sido criada anteriormente
  db.run(`ALTER TABLE users ADD COLUMN settings TEXT DEFAULT '{"absence_step_hours": 2, "display_mode": "aulas"}';`, () => {});

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


// Authenticated sessions: token hashes only; user IDs are not credentials.
db.serialize(() => db.run(`CREATE TABLE IF NOT EXISTS security_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
)`));
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const currentToken = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('presenca_auth='))?.slice(14) || '';
async function createSession(req, res, userId) {
 const previous = currentToken(req);
 if (/^[a-f0-9]{64}$/.test(previous)) await dbRun('DELETE FROM security_sessions WHERE token_hash = ?', [tokenHash(previous)]);
 const token = crypto.randomBytes(32).toString('hex');
 await dbRun('DELETE FROM security_sessions WHERE expires_at < ?', [Date.now()]);
 await dbRun('INSERT INTO security_sessions VALUES (?, ?, ?)', [tokenHash(token), userId, Date.now() + 7 * 86400000]);
 res.cookie('presenca_auth', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 7 * 86400000, path: '/' });
}
const authAttempts = new Map();
app.use('/api', async (req, res, next) => {
 res.setHeader('Cache-Control', 'no-store');
 if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
  try { if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({ error: 'Origem não autorizada.' }); }
  catch { return res.status(403).json({ error: 'Origem inválida.' }); }
 }
 if (['/auth/login', '/auth/register'].includes(req.path)) {
  const now = Date.now(), key = req.ip;
  for (const [ip, value] of authAttempts) if (value.until < now) authAttempts.delete(ip);
  const value = authAttempts.get(key) || { count: 0, until: now + 60000 };
  value.count++; authAttempts.set(key, value);
  if (value.count > 20) return res.status(429).json({ error: 'Tente novamente em um minuto.' });
  return next();
 }
 try {
  const token = currentToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Faça login novamente.' });
  const session = await dbGet('SELECT user_id FROM security_sessions WHERE token_hash = ? AND expires_at > ?', [tokenHash(token), Date.now()]);
  if (!session) return res.status(401).json({ error: 'Sessão expirada.' });
  req.sessionUserId = session.user_id;
  if (req.path === '/auth/logout') {
   await dbRun('DELETE FROM security_sessions WHERE token_hash = ?', [tokenHash(token)]);
   res.clearCookie('presenca_auth', { path: '/' }); return res.json({ success: true });
  }
  if (req.path === '/user/profile' && req.body?.id !== session.user_id) return res.status(403).json({ error: 'Acesso negado.' });
  const parts = req.path.split('/').filter(Boolean);
  if (parts[0] === 'subjects') {
   if (req.method === 'GET' && parts[1] !== session.user_id) return res.status(403).json({ error: 'Acesso negado.' });
   if (req.method === 'POST' && !parts[1] && req.body?.user_id !== session.user_id) return res.status(403).json({ error: 'Acesso negado.' });
   const subjectId = req.method === 'GET' ? null : (parts[1] || req.body?.id);
   if (subjectId) {
    const subject = await dbGet('SELECT user_id FROM subjects WHERE id = ?', [subjectId]);
    if (subject && subject.user_id !== session.user_id) return res.status(403).json({ error: 'Acesso negado.' });
   }
  }
  next();
 } catch { res.status(500).json({ error: 'Não foi possível validar a sessão.' }); }
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

    const defaultSettings = { absence_step_hours: 2, display_mode: 'aulas' };
    const id = crypto.randomUUID();
    const hashedPassword = hashPassword(password);

    await dbRun(
      'INSERT INTO users (id, name, email, password, settings) VALUES (?, ?, ?, ?, ?)',
      [id, finalName, cleanEmail, hashedPassword, JSON.stringify(defaultSettings)]
    );

    await createSession(req, res, id);
    res.status(201).json({ id, name: finalName, email: cleanEmail, settings: defaultSettings });
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
    const user = await dbGet('SELECT id, name, email, password, settings FROM users WHERE email = ?', [cleanEmail]);

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    let parsedSettings = { absence_step_hours: 2, display_mode: 'aulas' };
    try {
      if (user.settings) {
        parsedSettings = { ...parsedSettings, ...JSON.parse(user.settings) };
      }
    } catch (e) {}

    await createSession(req, res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, settings: parsedSettings });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro ao realizar login no servidor.' });
  }
});

// 2.1 Atualizar Perfil e Configurações
app.put('/api/user/profile', async (req, res) => {
  try {
    const { id, name, settings } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
    }

    const existingUser = await dbGet('SELECT id, name, email, settings FROM users WHERE id = ?', [id]);
    if (!existingUser) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    let currentSettings = { absence_step_hours: 2, display_mode: 'aulas' };
    try {
      if (existingUser.settings) {
        currentSettings = { ...currentSettings, ...JSON.parse(existingUser.settings) };
      }
    } catch (e) {}

    const newSettings = settings ? { ...currentSettings, ...settings } : currentSettings;
    const finalName = (name && typeof name === 'string' && name.trim()) ? name.trim().slice(0, 50) : existingUser.name;

    await dbRun(
      'UPDATE users SET name = ?, settings = ? WHERE id = ?',
      [finalName, JSON.stringify(newSettings), id]
    );

    res.json({
      id: existingUser.id,
      name: finalName,
      email: existingUser.email,
      settings: newSettings
    });
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações do perfil.' });
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

    const daysStr = typeof days === 'string' ? days : JSON.stringify(days);

    // Checa se a matéria já existe no banco
    const existing = id ? await dbGet('SELECT * FROM subjects WHERE id = ?', [id]) : null;

    if (existing) {
      // Atualizar existente
      await dbRun(
        `UPDATE subjects 
         SET name = ?, color = ?, absence_limit = ?, total_hours = ?, days = ?
         WHERE id = ? AND user_id = ?`,
        [name, color || '#6d5dfc', absence_limit || 25, total_hours || 60, daysStr, id, user_id]
      );
      const updated = await dbGet('SELECT * FROM subjects WHERE id = ?', [id]);
      return res.json({ ...updated, days: JSON.parse(updated.days || '[]') });
    } else {
      // Criar nova
      const newId = id || crypto.randomUUID();
      await dbRun(
        `INSERT INTO subjects (id, user_id, name, color, absence_limit, total_hours, days, absence_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, user_id, name, color || '#6d5dfc', absence_limit || 25, total_hours || 60, daysStr, absence_count || 0]
      );
      const created = await dbGet('SELECT * FROM subjects WHERE id = ?', [newId]);
      return res.status(201).json({ ...created, days: JSON.parse(created.days || '[]') });
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
    const { absence_count, user_id } = req.body;

    if (user_id) {
      await dbRun('UPDATE subjects SET absence_count = ? WHERE id = ? AND user_id = ?', [absence_count, id, user_id]);
    } else {
      await dbRun('UPDATE subjects SET absence_count = ? WHERE id = ?', [absence_count, id]);
    }
    const updated = await dbGet('SELECT * FROM subjects WHERE id = ?', [id]);
    res.json(updated ? { ...updated, days: JSON.parse(updated.days || '[]') } : { success: true });
  } catch (err) {
    console.error('Erro ao atualizar faltas:', err);
    res.status(500).json({ error: 'Erro ao atualizar faltas.' });
  }
});

// 6. Excluir Matéria
app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.query.user_id || req.body?.user_id;

    if (user_id) {
      await dbRun('DELETE FROM subjects WHERE id = ? AND user_id = ?', [id, user_id]);
    } else {
      await dbRun('DELETE FROM subjects WHERE id = ?', [id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir matéria:', err);
    res.status(500).json({ error: 'Erro ao excluir matéria.' });
  }
});

if (process.env.IP) {
  app.listen(PORT, process.env.IP, () => {
    console.log(`Servidor rodando no Alwaysdata em ${process.env.IP}:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Servidor rodando com SQLite na porta ${PORT} (http://localhost:${PORT})`);
  });
}
