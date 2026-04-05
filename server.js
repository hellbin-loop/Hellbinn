require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { scryptSync, randomBytes, timingSafeEqual, randomUUID } = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret';
const COOKIE = 'hellbin_uid';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pastes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'text',
      views INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('Database tables ready');
}

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser(SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname, { index: false }));

// ─── AUTH HELPERS ─────────────────────────────────────
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const buf = scryptSync(password, salt, 64);
  return `${buf.toString('hex')}.${salt}`;
}

function verifyPassword(password, stored) {
  const [hash, salt] = stored.split('.');
  const buf = scryptSync(password, salt, 64);
  return timingSafeEqual(buf, Buffer.from(hash, 'hex'));
}

function setSession(res, userId) {
  const payload = Buffer.from(String(userId)).toString('base64');
  res.cookie(COOKIE, `${payload}.${Date.now()}`, {
    httpOnly: true, sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, signed: true,
  });
}

function getSession(req) {
  const raw = req.signedCookies?.[COOKIE];
  if (!raw) return null;
  const userId = parseInt(Buffer.from(raw.split('.')[0], 'base64').toString(), 10);
  return isNaN(userId) ? null : userId;
}

function calcExpiry(expiresIn) {
  const map = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 };
  return map[expiresIn] ? new Date(Date.now() + map[expiresIn] * 1000) : null;
}

function toCamel(row) {
  const out = {};
  for (const [k, v] of Object.entries(row))
    out[k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())] = v;
  return out;
}

// ─── PASTES ───────────────────────────────────────────
app.get('/api/pastes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pastes WHERE expires_at IS NULL OR expires_at > NOW()
       ORDER BY created_at DESC LIMIT 100`
    );
    res.json(rows.map(toCamel));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/pastes/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT language, views FROM pastes WHERE expires_at IS NULL OR expires_at > NOW()`
    );
    const total = rows.length;
    const totalViews = rows.reduce((s, r) => s + r.views, 0);
    const languageBreakdown = {};
    for (const r of rows) languageBreakdown[r.language] = (languageBreakdown[r.language] || 0) + 1;
    res.json({ total, totalViews, languageBreakdown });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/pastes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pastes WHERE id = $1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ message: 'Not found' }); return; }
    await pool.query('UPDATE pastes SET views = $1 WHERE id = $2', [rows[0].views + 1, rows[0].id]);
    res.json(toCamel({ ...rows[0], views: rows[0].views + 1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/pastes', async (req, res) => {
  try {
    const { title, content, language = 'text', expiresIn } = req.body ?? {};
    if (!title || !content) { res.status(400).json({ message: 'Invalid input' }); return; }
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const { rows } = await pool.query(
      'INSERT INTO pastes (id, title, content, language, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, title, content, language, calcExpiry(expiresIn)]
    );
    res.status(201).json(toCamel(rows[0]));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/pastes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pastes WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── AUTH ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) { res.status(400).json({ message: 'Username and password required' }); return; }
    if (username.length < 2 || username.length > 30) { res.status(400).json({ message: 'Username must be 2–30 characters' }); return; }
    if (password.length < 4) { res.status(400).json({ message: 'Password must be at least 4 characters' }); return; }
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length) { res.status(409).json({ message: 'Username already taken' }); return; }
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username',
      [username, hashPassword(password)]
    );
    setSession(res, rows[0].id);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) { res.status(400).json({ message: 'Username and password required' }); return; }
    const { rows } = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1', [username]
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ message: 'Invalid username or password' }); return;
    }
    setSession(res, user.id);
    res.json({ id: user.id, username: user.username });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const userId = getSession(req);
    if (!userId) { res.status(401).json({ message: 'Not authenticated' }); return; }
    const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [userId]);
    if (!rows[0]) { res.clearCookie(COOKIE); res.status(401).json({ message: 'User not found' }); return; }
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`Hellbin running → http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
