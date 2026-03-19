require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
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
// Em produção usa /data (volume persistente no EasyPanel).
// Em desenvolvimento usa ./data local.
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'portalcury.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS attendants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    active     INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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

// Migrations — add columns if they don't exist yet
['ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'admin\'',
 'ALTER TABLE users ADD COLUMN attendant_id INTEGER REFERENCES attendants(id)',
 'ALTER TABLE leads ADD COLUMN attendant_id INTEGER REFERENCES attendants(id)',
].forEach(sql => { try { db.exec(sql); } catch {} });

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

  // Índices de rotação de filas (interno)
  wa_queue_idx:   '0',
  form_queue_idx: '0',

  // Evolution API — notificação de novo lead
  evolution_enabled:  'false',
  evolution_url:      '',       // Ex: https://evo.seudominio.com
  evolution_instance: '',       // Nome da instância no Evolution
  evolution_apikey:   '',       // Global API Key ou Instance API Key
  evolution_phone:    '',       // Número destino com DDI (ex: 5521999999999)
  evolution_message:  '🔔 *Novo Lead — Portal Cury*\n\n👤 *Nome:* {{name}}\n📱 *Telefone:* {{phone}}{{email_line}}\n🏢 *Empreendimento:* {{interest}}\n⏰ {{created_at}}',

  // Google Ads
  gads_tag_id:           '',   // Ex: AW-123456789
  gads_conversion_label: '',   // Ex: AbCdEfGhIjKl (label do evento de conversão)

  // Google Tag Manager
  gtm_id: '',                  // Ex: GTM-XXXXXXX

  // Código personalizado nas páginas
  custom_head_code: '',        // HTML/JS injetado antes de </head>
  custom_body_code: '',        // HTML/JS injetado após <body>
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

// ---- Usuário Diogo (admin) ----
const existingDiogo = db.prepare('SELECT id FROM users WHERE username = ?').get('diogoasoaresads@gmail.com');
if (!existingDiogo) {
  const hash = bcrypt.hashSync('06112005', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('diogoasoaresads@gmail.com', hash, 'admin');
  console.log('Usuário criado: diogoasoaresads@gmail.com (admin)');
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

// ---- Round-robin attendant queue ----
function nextAttendant(queueKey) {
  const list = db.prepare('SELECT * FROM attendants WHERE active = 1 ORDER BY id').all();
  if (!list.length) return null;
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(queueKey);
  let idx = parseInt(row?.value || '0');
  if (idx >= list.length) idx = 0;
  const attendant = list[idx];
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(queueKey, String((idx + 1) % list.length));
  return attendant;
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

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
  next();
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

async function notifyEvolution(lead, cfg) {
  if (cfg.evolution_enabled !== 'true') return;
  if (!cfg.evolution_url || !cfg.evolution_instance || !cfg.evolution_apikey || !cfg.evolution_phone) return;

  const interestLabel = INTEREST_LABELS[lead.interest] || lead.interest || 'Não informado';
  const dateStr = new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const vars = {
    name:       lead.name,
    phone:      lead.phone,
    email:      lead.email || '',
    email_line: lead.email ? `\n📧 *E-mail:* ${lead.email}` : '',
    interest:   interestLabel,
    message:    lead.message || '',
    created_at: dateStr,
  };

  const text = fillTemplate(cfg.evolution_message, vars);
  const baseUrl = cfg.evolution_url.replace(/\/$/, '');
  const url = `${baseUrl}/message/sendText/${cfg.evolution_instance}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'apikey': cfg.evolution_apikey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ number: cfg.evolution_phone, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Evolution API: HTTP ${res.status} ${detail}`);
  }
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
    notifyEvolution(lead, cfg),
    dispatchWebhook(lead, cfg),
  ]).then(results => {
    const names = ['email', 'evolution', 'webhook'];
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

// Config público (WhatsApp, rastreamento e códigos personalizados)
app.get('/api/public-config', (_req, res) => {
  const cfg = getConfig();
  res.json({
    whatsapp_number:       cfg.whatsapp_number  || '',
    whatsapp_message:      cfg.whatsapp_message || '',
    gads_tag_id:           cfg.gads_tag_id      || '',
    gads_conversion_label: cfg.gads_conversion_label || '',
    gtm_id:                cfg.gtm_id           || '',
    custom_head_code:      cfg.custom_head_code  || '',
    custom_body_code:      cfg.custom_body_code  || '',
  });
});

// Receber lead do formulário (fila form)
app.post('/api/leads', rateLimit(5 * 60 * 1000, 10), (req, res) => {
  const { name, phone, email = '', interest = '', message = '' } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const attendant = nextAttendant('form_queue_idx');

  const r = db.prepare(`
    INSERT INTO leads (name, phone, email, interest, message, source, attendant_id)
    VALUES (?, ?, ?, ?, ?, 'landing_page', ?)
  `).run(name.trim(), phone.trim(), email.trim(), interest.trim(), message.trim(), attendant?.id || null);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);
  fireNotifications(lead, getConfig());
  res.json({ success: true, id: lead.id });
});

// Receber lead do WhatsApp (fila WA) — retorna URL do próximo atendente
app.post('/api/leads/wa', rateLimit(5 * 60 * 1000, 10), (req, res) => {
  const { name, phone } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const attendant = nextAttendant('wa_queue_idx');
  const cfg = getConfig();

  const r = db.prepare(`
    INSERT INTO leads (name, phone, source, attendant_id)
    VALUES (?, ?, 'whatsapp', ?)
  `).run(name.trim(), phone.trim(), attendant?.id || null);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);
  fireNotifications(lead, cfg);

  const waPhone = (attendant?.phone || cfg.whatsapp_number || '').replace(/\D/g, '');
  const waMsg   = encodeURIComponent(cfg.whatsapp_message || '');
  res.json({ success: true, id: lead.id, wa_url: `https://wa.me/${waPhone}?text=${waMsg}` });
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
  const role = user.role || 'admin';
  const token = jwt.sign(
    { id: user.id, username: user.username, role, attendant_id: user.attendant_id || null },
    JWT_SECRET, { expiresIn: '24h' }
  );
  res.json({ token, username: user.username, role });
});

app.get('/api/auth/check', auth, (req, res) => {
  res.json({ ok: true, username: req.user.username, role: req.user.role || 'admin' });
});

// ============================================================
// ROUTES — LEADS (protegidos)
// ============================================================
app.get('/api/leads', auth, (req, res) => {
  const { status = 'all', interest = 'all', search = '', page = '1', limit = '50', attendant = 'all' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = 'WHERE 1=1';
  const params = [];

  // Agentes veem apenas seus próprios leads
  if (req.user.role !== 'admin') {
    where += ' AND l.attendant_id = ?';
    params.push(req.user.attendant_id || -1);
  } else if (attendant !== 'all') {
    where += ' AND l.attendant_id = ?';
    params.push(attendant);
  }

  if (status !== 'all') { where += ' AND l.status = ?'; params.push(status); }
  if (interest !== 'all') { where += ' AND l.interest = ?'; params.push(interest); }
  if (search.trim()) {
    where += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
  }

  const total = db.prepare(`SELECT COUNT(*) as n FROM leads l ${where}`).get(...params).n;
  const leads = db.prepare(`
    SELECT l.*, a.name as attendant_name
    FROM leads l LEFT JOIN attendants a ON l.attendant_id = a.id
    ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ leads, total, page: parseInt(page), limit: parseInt(limit) });
});

app.get('/api/leads/export-excel', auth, async (req, res) => {
  const { status = 'all', interest = 'all', search = '', attendant = 'all' } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role !== 'admin') {
    where += ' AND l.attendant_id = ?';
    params.push(req.user.attendant_id || -1);
  } else if (attendant !== 'all') {
    where += ' AND l.attendant_id = ?';
    params.push(attendant);
  }
  if (status !== 'all') { where += ' AND l.status = ?'; params.push(status); }
  if (interest !== 'all') { where += ' AND l.interest = ?'; params.push(interest); }
  if (search.trim()) {
    where += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
  }

  const leads = db.prepare(`
    SELECT l.*, a.name as attendant_name
    FROM leads l LEFT JOIN attendants a ON l.attendant_id = a.id
    ${where} ORDER BY l.created_at DESC
  `).all(...params);

  const INTEREST_LABELS = {
    'luzes-do-rio':            'Luzes do Rio – São Cristóvão',
    'residencial-cartola':     'Residencial Cartola – São Cristóvão',
    'nova-norte-raizes':       'Res. Nova Norte Raízes – Irajá',
    'caminhos-guanabara':      'Caminhos da Guanabara – Niterói',
    'farol-guanabara':         'Farol da Guanabara – Porto',
    'residencial-pixinguinha': 'Res. Pixinguinha – Porto',
  };
  const STATUS_LABELS = { novo: 'Novo', em_atendimento: 'Em Atendimento', convertido: 'Convertido', perdido: 'Perdido' };
  const STATUS_COLORS = { novo: 'FF3B82F6', em_atendimento: 'FFFBBF24', convertido: 'FF22C55E', perdido: 'FFEF4444' };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portal Cury CRM';
  wb.created = new Date();

  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 3 }] });

  // ── Linha 1: título principal ──────────────────────────────────
  ws.mergeCells('A1:I1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Portal Cury – Relatório de Leads   (${new Date().toLocaleDateString('pt-BR')})`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  ws.getRow(1).height = 36;

  // ── Linha 2: subtítulo com total ───────────────────────────────
  ws.mergeCells('A2:I2');
  const subCell = ws.getCell('A2');
  subCell.value = `Total de leads: ${leads.length}`;
  subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFFFFFFF' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5090' } };
  ws.getRow(2).height = 22;

  // ── Linha 3: cabeçalho das colunas ────────────────────────────
  const headers = [
    { header: '#',              key: 'id',           width: 7  },
    { header: 'Nome',           key: 'name',         width: 28 },
    { header: 'Telefone',       key: 'phone',        width: 18 },
    { header: 'E-mail',         key: 'email',        width: 32 },
    { header: 'Empreendimento', key: 'interest',     width: 38 },
    { header: 'Status',         key: 'status',       width: 18 },
    { header: 'Atendente',      key: 'attendant',    width: 22 },
    { header: 'Notas',          key: 'notes',        width: 40 },
    { header: 'Data',           key: 'created_at',   width: 20 },
  ];
  ws.columns = headers.map(h => ({ key: h.key, width: h.width }));

  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFBFD1E8' } },
      right:  { style: 'thin',   color: { argb: 'FF2E5090' } },
    };
  });
  headerRow.height = 28;

  // ── Dados ──────────────────────────────────────────────────────
  leads.forEach((l, idx) => {
    const row = ws.addRow([
      l.id,
      l.name,
      l.phone,
      l.email,
      INTEREST_LABELS[l.interest] || l.interest,
      STATUS_LABELS[l.status]     || l.status,
      l.attendant_name            || '—',
      l.notes                     || '',
      new Date(l.created_at).toLocaleString('pt-BR'),
    ]);
    row.height = 22;
    const isEven = idx % 2 === 1;
    const rowBg = isEven ? 'FFEEF3FB' : 'FFFFFFFF';

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: colNum === 8 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFCBD5E8' } },
        right:  { style: 'thin', color: { argb: 'FFCBD5E8' } },
      };
    });

    // Badge colorido para status (coluna 6)
    const statusCell = row.getCell(6);
    const statusColor = STATUS_COLORS[l.status] || 'FF6B7280';
    statusCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
    statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // ── Rodapé ─────────────────────────────────────────────────────
  const footerRowNum = leads.length + 4;
  ws.mergeCells(`A${footerRowNum}:I${footerRowNum}`);
  const footerCell = ws.getCell(`A${footerRowNum}`);
  footerCell.value = 'Portal Cury CRM  •  Relatório gerado automaticamente';
  footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7280' } };
  footerCell.alignment = { horizontal: 'center', vertical: 'middle' };
  footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FB' } };
  ws.getRow(footerRowNum).height = 18;

  const filename = `leads_portalcury_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get('/api/leads/stats', auth, (req, res) => {
  let where = '';
  const params = [];
  if (req.user.role !== 'admin') {
    where = 'WHERE attendant_id = ?';
    params.push(req.user.attendant_id || -1);
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'novo'           THEN 1 ELSE 0 END) as novo,
      SUM(CASE WHEN status = 'em_atendimento' THEN 1 ELSE 0 END) as em_atendimento,
      SUM(CASE WHEN status = 'convertido'     THEN 1 ELSE 0 END) as convertido,
      SUM(CASE WHEN status = 'perdido'        THEN 1 ELSE 0 END) as perdido
    FROM leads ${where}
  `).get(...params);

  const todayWhere = where ? where + ' AND date(created_at) = date(\'now\',\'localtime\')' : 'WHERE date(created_at) = date(\'now\',\'localtime\')';
  const today = db.prepare(`SELECT COUNT(*) as n FROM leads ${todayWhere}`).get(...params).n;

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
// ROUTES — ATTENDANTS (admin)
// ============================================================
app.get('/api/attendants', auth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM attendants ORDER BY id').all());
});

app.post('/api/attendants', auth, adminOnly, (req, res) => {
  const { name, phone, active = 1 } = req.body;
  if (!name?.trim() || !phone?.trim()) return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  const r = db.prepare('INSERT INTO attendants (name, phone, active) VALUES (?, ?, ?)').run(name.trim(), phone.trim(), active ? 1 : 0);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/attendants/:id', auth, adminOnly, (req, res) => {
  const { name, phone, active } = req.body;
  db.prepare('UPDATE attendants SET name = ?, phone = ?, active = ? WHERE id = ?').run(name.trim(), phone.trim(), active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/attendants/:id', auth, adminOnly, (req, res) => {
  // Desvincula leads e usuários antes de excluir
  db.prepare('UPDATE leads SET attendant_id = NULL WHERE attendant_id = ?').run(req.params.id);
  db.prepare('UPDATE users SET attendant_id = NULL WHERE attendant_id = ?').run(req.params.id);
  db.prepare('DELETE FROM attendants WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
// ROUTES — USERS (admin)
// ============================================================
app.get('/api/users', auth, adminOnly, (_req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.attendant_id, u.created_at, a.name as attendant_name
    FROM users u LEFT JOIN attendants a ON u.attendant_id = a.id ORDER BY u.id
  `).all();
  res.json(users);
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, role = 'agent', attendant_id } = req.body;
  if (!username?.trim() || !password || password.length < 6)
    return res.status(400).json({ error: 'Usuário e senha (mín. 6 caracteres) são obrigatórios.' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role, attendant_id) VALUES (?, ?, ?, ?)').run(
      username.trim(), bcrypt.hashSync(password, 10), role, attendant_id || null
    );
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Usuário já existe.' });
    throw e;
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { role, attendant_id, password } = req.body;
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' });
    db.prepare('UPDATE users SET role = ?, attendant_id = ?, password_hash = ? WHERE id = ?').run(
      role, attendant_id || null, bcrypt.hashSync(password, 10), req.params.id
    );
  } else {
    db.prepare('UPDATE users SET role = ?, attendant_id = ? WHERE id = ?').run(role, attendant_id || null, req.params.id);
  }
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: 'Não é possível excluir sua própria conta.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
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
    await notifyEvolution(FAKE_LEAD, { ...getConfig(), evolution_enabled: 'true' });
    res.json({ success: true, message: 'Notificação Evolution API enviada!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// EMPREENDIMENTOS – individual pages
// ============================================================
app.get('/empreendimentos/:slug', (req, res) => {
  const emp = empreendimentos.find(e => e.slug === req.params.slug);
  if (!emp) return res.status(404).sendFile(path.join(__dirname, 'index.html'));
  const cfg = getConfig();
  const tracking = {
    gtm_id:                cfg.gtm_id                || '',
    gads_tag_id:           cfg.gads_tag_id            || '',
    gads_conversion_label: cfg.gads_conversion_label  || '',
    custom_head_code:      cfg.custom_head_code        || '',
    custom_body_code:      cfg.custom_body_code        || '',
  };
  if (emp.emBreve) return res.render('em-breve', { emp, tracking });
  const others = empreendimentos.filter(e => e.slug !== emp.slug).slice(0, 5);
  res.render('empreendimento', { emp, others, tracking });
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
