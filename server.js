require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const empreendimentos = require('./data/empreendimentos');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'TROQUE_ESTA_CHAVE_EM_PRODUCAO_' + Math.random();

// ============================================================
// TEMPLATE ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve landing page e admin
app.use(express.static(path.join(__dirname), { index: false }));

// ============================================================
// DATABASE
// ============================================================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'portalcury.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    phone        TEXT    NOT NULL,
    email        TEXT    DEFAULT '',
    interest     TEXT    DEFAULT '',
    message      TEXT    DEFAULT '',
    status       TEXT    DEFAULT 'novo',
    notes        TEXT    DEFAULT '',
    source       TEXT    DEFAULT 'landing_page',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ---- Default config values ----
const DEFAULT_CONFIG = {
  // Botão WhatsApp da landing page
  whatsapp_number:  '5521999999999',
  whatsapp_message: 'Olá! Quero saber mais sobre os empreendimentos Cury.',

  // Webhook
  webhook_enabled: 'false',
  webhook_url:     '',
  webhook_secret:  '',

  // Email
  email_enabled:    'false',
  email_smtp_host:  'smtp.gmail.com',
  email_smtp_port:  '587',
  email_smtp_secure:'false',
  email_smtp_user:  '',
  email_smtp_pass:  '',
  email_from:       'Portal Cury <noreply@portalcury.com.br>',
  email_to:         '',

  // WhatsApp API para notificação de novo lead
  whatsapp_notify_enabled: 'false',
  whatsapp_notify_phone:   '',
  whatsapp_notify_url:     '',
  whatsapp_notify_headers: JSON.stringify({ 'Content-Type': 'application/json' }),
  whatsapp_notify_body:    JSON.stringify({
    phone: '{{notify_phone}}',
    message: '🔔 Novo lead no Portal Cury!\n\n👤 {{name}}\n📱 {{phone}}\n🏢 {{interest}}\n⏰ {{created_at}}'
  }),
};

const insertCfg = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_CONFIG)) insertCfg.run(k, v);

// ---- Default admin user ----
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.log('Usuário padrão criado: admin / admin123 — TROQUE A SENHA!');
}

// ============================================================
// HELPERS
// ============================================================
function getConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function setConfig(updates) {
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  const upsertMany = db.transaction((entries) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  upsertMany(Object.entries(updates).filter(([k]) => k in DEFAULT_CONFIG));
}

const INTEREST_LABELS = {
  'luzes-do-rio':         'Luzes do Rio – São Cristóvão',
  'residencial-cartola':  'Residencial Cartola – São Cristóvão',
  'nova-norte-raizes':    'Res. Nova Norte Raízes – Irajá',
  'caminhos-guanabara':   'Caminhos da Guanabara – Niterói',
  'farol-guanabara':      'Farol da Guanabara – Porto',
  'residencial-pixinguinha': 'Res. Pixinguinha – Porto',
};

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// ---- Auth middleware ----
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

// ---- Simple in-memory rate limiter ----
const rateMap = new Map();
function rateLimit(windowMs, max) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const hits = (rateMap.get(key) || []).filter(t => t > now - windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    }
    hits.push(now);
    rateMap.set(key, hits);
    next();
  };
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function notifyEmail(lead, cfg) {
  if (cfg.email_enabled !== 'true' || !cfg.email_to || !cfg.email_smtp_user) return;

  const transport = nodemailer.createTransport({
    host:   cfg.email_smtp_host,
    port:   Number(cfg.email_smtp_port),
    secure: cfg.email_smtp_secure === 'true',
    auth:   { user: cfg.email_smtp_user, pass: cfg.email_smtp_pass },
  });

  const interestLabel = INTEREST_LABELS[lead.interest] || lead.interest || 'Não informado';
  const dateStr = new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const waLink = `https://wa.me/55${lead.phone.replace(/\D/g, '')}`;

  await transport.sendMail({
    from:    cfg.email_from || 'Portal Cury <noreply@portalcury.com.br>',
    to:      cfg.email_to,
    subject: `🏠 Novo Lead: ${lead.name} – Portal Cury`,
    html: `
<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:24px auto">
  <div style="background:#C8232A;padding:28px 32px;border-radius:10px 10px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">🔔 Novo Lead — Portal Cury</h1>
  </div>
  <div style="background:#fff;padding:32px;border-radius:0 0 10px 10px;border:1px solid #e5e5e5">
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:10px 0;color:#888;width:140px;font-size:14px"><strong>Nome</strong></td>
        <td style="padding:10px 0;font-size:15px">${lead.name}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:10px 0;color:#888;font-size:14px"><strong>Telefone</strong></td>
        <td style="padding:10px 0;font-size:15px">${lead.phone}</td>
      </tr>
      ${lead.email ? `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 0;color:#888;font-size:14px"><strong>E-mail</strong></td><td style="padding:10px 0;font-size:15px">${lead.email}</td></tr>` : ''}
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:10px 0;color:#888;font-size:14px"><strong>Empreendimento</strong></td>
        <td style="padding:10px 0;font-size:15px">${interestLabel}</td>
      </tr>
      ${lead.message ? `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 0;color:#888;font-size:14px"><strong>Mensagem</strong></td><td style="padding:10px 0;font-size:15px">${lead.message}</td></tr>` : ''}
      <tr>
        <td style="padding:10px 0;color:#888;font-size:14px"><strong>Recebido em</strong></td>
        <td style="padding:10px 0;font-size:15px">${dateStr}</td>
      </tr>
    </table>
    <div style="margin-top:28px;text-align:center">
      <a href="${waLink}" style="background:#25D366;color:#fff;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:bold;margin-right:12px;display:inline-block">WhatsApp</a>
      <a href="tel:${lead.phone}" style="background:#C8232A;color:#fff;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Ligar</a>
    </div>
  </div>
  <p style="text-align:center;color:#bbb;font-size:12px;margin-top:16px">Portal Cury · Notificação automática</p>
</div></body></html>`,
  });
}

async function notifyWhatsApp(lead, cfg) {
  if (cfg.whatsapp_notify_enabled !== 'true' || !cfg.whatsapp_notify_url) return;

  const interestLabel = INTEREST_LABELS[lead.interest] || lead.interest || 'Não informado';
  const dateStr = new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const vars = {
    name: lead.name, phone: lead.phone, email: lead.email || '',
    interest: interestLabel, message: lead.message || '',
    notify_phone: cfg.whatsapp_notify_phone, created_at: dateStr,
  };

  const headers  = JSON.parse(cfg.whatsapp_notify_headers || '{}');
  const bodyTmpl = cfg.whatsapp_notify_body || '';
  const body     = fillTemplate(bodyTmpl, vars);

  const res = await fetch(cfg.whatsapp_notify_url, {
    method: 'POST', headers, body,
  });
  if (!res.ok) throw new Error(`WhatsApp API: HTTP ${res.status}`);
}

async function dispatchWebhook(lead, cfg) {
  if (cfg.webhook_enabled !== 'true' || !cfg.webhook_url) return;

  const payload = {
    event: 'new_lead',
    lead: {
      id: lead.id, name: lead.name, phone: lead.phone,
      email: lead.email, interest: lead.interest,
      interest_label: INTEREST_LABELS[lead.interest] || lead.interest,
      message: lead.message, source: lead.source,
      created_at: lead.created_at,
    },
    timestamp: new Date().toISOString(),
  };

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.webhook_secret) headers['X-Webhook-Secret'] = cfg.webhook_secret;

  const res = await fetch(cfg.webhook_url, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook: HTTP ${res.status}`);
}

function fireNotifications(lead, cfg) {
  Promise.allSettled([
    notifyEmail(lead, cfg),
    notifyWhatsApp(lead, cfg),
    dispatchWebhook(lead, cfg),
  ]).then(results => {
    const names = ['email', 'whatsapp', 'webhook'];
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[notif:${names[i]}]`, r.reason?.message);
    });
  });
}

// ============================================================
// ROUTES — PUBLIC
// ============================================================

// Landing page
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Config público (para atualizar botão WhatsApp dinamicamente)
app.get('/api/public-config', (_req, res) => {
  const cfg = getConfig();
  res.json({
    whatsapp_number:  cfg.whatsapp_number,
    whatsapp_message: cfg.whatsapp_message,
  });
});

// Receber lead
app.post('/api/leads', rateLimit(5 * 60 * 1000, 5), (req, res) => {
  const { name, phone, email = '', interest = '', message = '' } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const stmt = db.prepare(`
    INSERT INTO leads (name, phone, email, interest, message, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const r = stmt.run(name.trim(), phone.trim(), email.trim(), interest.trim(), message.trim(), 'landing_page');
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);

  fireNotifications(lead, getConfig());
  res.json({ success: true, id: lead.id });
});

// ============================================================
// ROUTES — AUTH
// ============================================================
app.post('/api/auth/login', rateLimit(15 * 60 * 1000, 10), (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username });
});

app.get('/api/auth/check', auth, (req, res) => {
  res.json({ ok: true, username: req.user.username });
});

// ============================================================
// ROUTES — LEADS (protegidos)
// ============================================================
app.get('/api/leads', auth, (req, res) => {
  const { status = 'all', interest = 'all', search = '', page = '1', limit = '50' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = 'WHERE 1=1';
  const params = [];

  if (status !== 'all') { where += ' AND status = ?'; params.push(status); }
  if (interest !== 'all') { where += ' AND interest = ?'; params.push(interest); }
  if (search.trim()) {
    where += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
  }

  const total = db.prepare(`SELECT COUNT(*) as n FROM leads ${where}`).get(...params).n;
  const leads = db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

  res.json({ leads, total, page: parseInt(page), limit: parseInt(limit) });
});

app.get('/api/leads/stats', auth, (_req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'novo'           THEN 1 ELSE 0 END) as novo,
      SUM(CASE WHEN status = 'em_atendimento' THEN 1 ELSE 0 END) as em_atendimento,
      SUM(CASE WHEN status = 'convertido'     THEN 1 ELSE 0 END) as convertido,
      SUM(CASE WHEN status = 'perdido'        THEN 1 ELSE 0 END) as perdido
    FROM leads
  `).get();

  const today = db.prepare(
    `SELECT COUNT(*) as n FROM leads WHERE date(created_at) = date('now', 'localtime')`
  ).get().n;

  res.json({ ...stats, today });
});

app.put('/api/leads/:id', auth, (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

  db.prepare(`
    UPDATE leads SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, notes ?? '', id);

  res.json({ success: true });
});

app.delete('/api/leads/:id', auth, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
// ROUTES — CONFIG (protegidos)
// ============================================================
app.get('/api/config', auth, (_req, res) => {
  const cfg = getConfig();
  // Mascarar senha
  if (cfg.email_smtp_pass) cfg.email_smtp_pass = '••••••••';
  res.json(cfg);
});

app.put('/api/config', auth, (req, res) => {
  setConfig(req.body);
  res.json({ success: true });
});

// Salvar senha SMTP separado para não mascarar
app.put('/api/config/smtp-pass', auth, (req, res) => {
  const { email_smtp_pass } = req.body;
  if (email_smtp_pass && email_smtp_pass !== '••••••••') {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('email_smtp_pass', email_smtp_pass);
  }
  res.json({ success: true });
});

// Trocar senha admin
app.put('/api/auth/password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

// ============================================================
// ROUTES — TESTES (protegidos)
// ============================================================
const FAKE_LEAD = {
  name: 'Lead de Teste', phone: '(21) 9 9999-9999',
  email: 'teste@portalcury.com.br', interest: 'luzes-do-rio',
  message: 'Mensagem de teste.', created_at: new Date().toISOString(),
};

app.post('/api/test/email', auth, async (_req, res) => {
  try {
    await notifyEmail(FAKE_LEAD, { ...getConfig(), email_enabled: 'true' });
    res.json({ success: true, message: 'E-mail de teste enviado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/test/webhook', auth, async (_req, res) => {
  try {
    await dispatchWebhook({ ...FAKE_LEAD, id: 0, source: 'test' }, { ...getConfig(), webhook_enabled: 'true' });
    res.json({ success: true, message: 'Webhook disparado com sucesso!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/test/whatsapp', auth, async (_req, res) => {
  try {
    await notifyWhatsApp(FAKE_LEAD, { ...getConfig(), whatsapp_notify_enabled: 'true' });
    res.json({ success: true, message: 'Notificação WhatsApp enviada!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// EMPREENDIMENTOS – individual pages
// ============================================================
app.get('/empreendimentos/:slug', (req, res) => {
  const emp = empreendimentos.find(e => e.slug === req.params.slug);
  if (!emp) return res.status(404).sendFile(path.join(__dirname, 'index.html'));
  const others = empreendimentos.filter(e => e.slug !== emp.slug).slice(0, 5);
  res.render('empreendimento', { emp, others });
});

// ============================================================
// ADMIN PANEL
// ============================================================
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/*', (_req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`\n✅ Portal Cury rodando em http://localhost:${PORT}`);
  console.log(`   Admin CRM: http://localhost:${PORT}/admin`);
  console.log(`   Login padrão: admin / admin123\n`);
});
