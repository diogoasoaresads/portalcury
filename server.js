require('dotenv').config();

const crypto  = require('crypto');
const helmet  = require('helmet');
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

// JWT_SECRET: obrigatório em produção — fallback criptograficamente seguro para dev
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[SEGURANÇA] JWT_SECRET não definido! Configure a variável de ambiente JWT_SECRET.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');

// ============================================================
// TEMPLATE ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// MIDDLEWARE
// ============================================================
// Headers de segurança HTTP
app.use(helmet({
  contentSecurityPolicy: false, // desativado pois admin usa inline scripts e CDNs externos
  crossOriginEmbedderPolicy: false,
}));
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

// Garante que o diretório de logs existe (necessário para PM2)
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

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

// Tabela de visualizações de página (analytics de tráfego)
db.exec(`
  CREATE TABLE IF NOT EXISTS page_views (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT    DEFAULT '',
    page         TEXT    DEFAULT '/',
    utm_source   TEXT    DEFAULT '',
    utm_medium   TEXT    DEFAULT '',
    utm_campaign TEXT    DEFAULT '',
    utm_content  TEXT    DEFAULT '',
    utm_term     TEXT    DEFAULT '',
    referrer     TEXT    DEFAULT '',
    traffic_type TEXT    DEFAULT 'Direto',
    device       TEXT    DEFAULT '',
    browser      TEXT    DEFAULT '',
    city         TEXT    DEFAULT '',
    region       TEXT    DEFAULT '',
    country      TEXT    DEFAULT 'BR',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Tabela de atividades / histórico de contatos do lead
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_activities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type       TEXT    DEFAULT 'novo_contato',
    title      TEXT    DEFAULT '',
    body       TEXT    DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Índices para acelerar deduplicação de leads
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
  CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
`);

// Migrations — add columns if they don't exist yet
['ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'admin\'',
 'ALTER TABLE users ADD COLUMN attendant_id INTEGER REFERENCES attendants(id)',
 'ALTER TABLE leads ADD COLUMN attendant_id INTEGER REFERENCES attendants(id)',
 'ALTER TABLE leads ADD COLUMN phone_norm TEXT NOT NULL DEFAULT \'\'',
].forEach(sql => { try { db.exec(sql); } catch {} });

// Backfill phone_norm para leads já existentes (roda apenas uma vez)
{
  const _normPhone = p => (p || '').replace(/\D/g, '');
  const _toFill = db.prepare("SELECT id, phone FROM leads WHERE phone_norm = '' OR phone_norm IS NULL").all();
  const _upd    = db.prepare("UPDATE leads SET phone_norm = ? WHERE id = ?");
  for (const l of _toFill) _upd.run(_normPhone(l.phone), l.id);
}

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

// ---- Default admin user (criado apenas se não existir NENHUM usuário) ----
const anyUser = db.prepare('SELECT id FROM users LIMIT 1').get();
if (!anyUser) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.warn('[SETUP] Usuário padrão criado: admin / admin123 — TROQUE A SENHA IMEDIATAMENTE no painel de configurações!');
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

// ---- Deduplicação de leads ----
function normalizePhone(p) {
  return (p || '').replace(/\D/g, '');
}

// Usa coluna phone_norm (dígitos puros) indexada para busca sem SQL complexo
function findDuplicateLead(phone, email) {
  const phoneNorm = normalizePhone(phone);

  // Busca por telefone normalizado
  const byPhone = db.prepare('SELECT * FROM leads WHERE phone_norm = ? LIMIT 1').get(phoneNorm);
  if (byPhone) return byPhone;

  // Busca por e-mail (case-insensitive, só se fornecido)
  const emailNorm = (email || '').trim().toLowerCase();
  if (emailNorm) {
    const byEmail = db.prepare("SELECT * FROM leads WHERE LOWER(TRIM(email)) = ? AND email != '' LIMIT 1").get(emailNorm);
    if (byEmail) return byEmail;
  }

  return null;
}

// ---- Registro de atividades no lead ----
function addActivity(lead_id, type, title, body) {
  db.prepare(`
    INSERT INTO lead_activities (lead_id, type, title, body)
    VALUES (?, ?, ?, ?)
  `).run(lead_id, type, title, body || '');
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

// Limpeza periódica do rateMap para evitar memory leak (a cada 10 min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // remove entradas mais antigas que 30min
  for (const [key, hits] of rateMap.entries()) {
    const fresh = hits.filter(t => t > cutoff);
    if (fresh.length === 0) rateMap.delete(key);
    else rateMap.set(key, fresh);
  }
}, 10 * 60 * 1000).unref();

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
  try {
  const { name, phone, email = '', interest = '', message = '' } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const existing = findDuplicateLead(phone, email);

  if (existing) {
    // Lead já existe — atualiza dados e registra nova atividade
    db.prepare(`
      UPDATE leads SET
        name       = ?,
        email      = CASE WHEN ? != '' THEN ? ELSE email END,
        interest   = CASE WHEN ? != '' THEN ? ELSE interest END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name.trim(),
      email.trim(), email.trim(),
      interest.trim(), interest.trim(),
      existing.id
    );

    const bodyLines = [
      `Nome: ${name.trim()}`,
      `Telefone: ${phone.trim()}`,
      email.trim()    ? `E-mail: ${email.trim()}`       : null,
      interest.trim() ? `Empreendimento: ${interest.trim()}` : null,
      message.trim()  ? `Mensagem: ${message.trim()}`   : null,
      `Fonte: landing_page`,
    ].filter(Boolean).join('\n');

    addActivity(existing.id, 'novo_contato', 'Novo contato recebido (landing page)', bodyLines);

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(existing.id);
    fireNotifications(lead, getConfig());
    return res.json({ success: true, id: lead.id, duplicate: true });
  }

  // Lead novo
  const attendant = nextAttendant('form_queue_idx');
  const r = db.prepare(`
    INSERT INTO leads (name, phone, phone_norm, email, interest, message, source, attendant_id)
    VALUES (?, ?, ?, ?, ?, ?, 'landing_page', ?)
  `).run(name.trim(), phone.trim(), normalizePhone(phone), email.trim(), interest.trim(), message.trim(), attendant?.id || null);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);

  const bodyLines = [
    `Nome: ${lead.name}`,
    `Telefone: ${lead.phone}`,
    lead.email    ? `E-mail: ${lead.email}`             : null,
    lead.interest ? `Empreendimento: ${lead.interest}`  : null,
    lead.message  ? `Mensagem: ${lead.message}`         : null,
    `Fonte: landing_page`,
  ].filter(Boolean).join('\n');

  addActivity(lead.id, 'novo_contato', 'Lead recebido (landing page)', bodyLines);

  fireNotifications(lead, getConfig());
  res.json({ success: true, id: lead.id, duplicate: false });
  } catch (err) {
    console.error('[POST /api/leads]', err);
    res.status(500).json({ error: 'Erro ao registrar lead. Tente novamente.' });
  }
});

// Receber lead do WhatsApp (fila WA) — retorna URL do próximo atendente
app.post('/api/leads/wa', rateLimit(5 * 60 * 1000, 10), (req, res) => {
  try {
  const { name, phone, message = '' } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const cfg = getConfig();
  const existing = findDuplicateLead(phone, '');

  if (existing) {
    // Lead já existe — atualiza nome e registra atividade
    db.prepare(`
      UPDATE leads SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(name.trim(), existing.id);

    const bodyLines = [
      `Nome: ${name.trim()}`,
      `Telefone: ${phone.trim()}`,
      message.trim() ? `Mensagem: ${message.trim()}` : null,
      `Fonte: whatsapp`,
    ].filter(Boolean).join('\n');

    addActivity(existing.id, 'novo_contato', 'Novo contato recebido (WhatsApp)', bodyLines);

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(existing.id);
    fireNotifications(lead, cfg);

    const attendant = db.prepare('SELECT * FROM attendants WHERE id = ?').get(existing.attendant_id);
    const waPhone = (attendant?.phone || cfg.whatsapp_number || '').replace(/\D/g, '');
    const waMsg   = encodeURIComponent(cfg.whatsapp_message || '');
    return res.json({ success: true, id: lead.id, duplicate: true, wa_url: `https://wa.me/${waPhone}?text=${waMsg}` });
  }

  // Lead novo
  const attendant = nextAttendant('wa_queue_idx');
  const r = db.prepare(`
    INSERT INTO leads (name, phone, phone_norm, message, source, attendant_id)
    VALUES (?, ?, ?, ?, 'whatsapp', ?)
  `).run(name.trim(), phone.trim(), normalizePhone(phone), message.trim(), attendant?.id || null);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);

  const bodyLines = [
    `Nome: ${lead.name}`,
    `Telefone: ${lead.phone}`,
    lead.message ? `Mensagem: ${lead.message}` : null,
    `Fonte: whatsapp`,
  ].filter(Boolean).join('\n');

  addActivity(lead.id, 'novo_contato', 'Lead recebido (WhatsApp)', bodyLines);

  fireNotifications(lead, cfg);

  const waPhone = (attendant?.phone || cfg.whatsapp_number || '').replace(/\D/g, '');
  const waMsg   = encodeURIComponent(cfg.whatsapp_message || '');
  res.json({ success: true, id: lead.id, duplicate: false, wa_url: `https://wa.me/${waPhone}?text=${waMsg}` });
  } catch (err) {
    console.error('[POST /api/leads/wa]', err);
    res.status(500).json({ error: 'Erro ao registrar lead. Tente novamente.' });
  }
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
    SELECT l.*, a.name as attendant_name,
      (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.type = 'novo_contato') as contacts_count
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

app.get('/api/leads/:id', auth, (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  res.json(lead);
});

app.get('/api/leads/:id/activities', auth, (req, res) => {
  const activities = db.prepare(`
    SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at ASC
  `).all(req.params.id);
  res.json(activities);
});

app.put('/api/leads/:id', auth, (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

  db.prepare(`
    UPDATE leads SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, notes ?? '', id);

  // Registra atividade quando status muda
  if (status && status !== lead.status) {
    const STATUS_LABELS = { novo: 'Novo', em_atendimento: 'Em atendimento', convertido: 'Convertido', perdido: 'Perdido' };
    addActivity(id, 'status_alterado', `Status alterado para "${STATUS_LABELS[status] || status}"`, '');
  }

  // Registra atividade quando anotação é salva (e mudou)
  const newNotes = (notes ?? '').trim();
  if (newNotes && newNotes !== (lead.notes || '').trim()) {
    addActivity(id, 'anotacao', 'Anotação registrada', newNotes);
  }

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
  if (!username?.trim() || !password || password.length < 8)
    return res.status(400).json({ error: 'Usuário e senha (mín. 8 caracteres) são obrigatórios.' });
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
    if (password.length < 8) return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres.' });
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
app.get('/api/config', auth, adminOnly, (_req, res) => {
  const cfg = getConfig();
  // Mascarar senha SMTP
  if (cfg.email_smtp_pass) cfg.email_smtp_pass = '••••••••';
  res.json(cfg);
});

app.put('/api/config', auth, adminOnly, (req, res) => {
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
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres.' });
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
// RASTREAMENTO DE TRÁFEGO
// ============================================================

// Geo-lookup via ip-api.com (grátis, sem necessidade de chave)
function geoLookup(ip) {
  return new Promise((resolve) => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!ip || local.includes(ip) || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return resolve({ city: 'Local', region: 'Local', country: 'BR' });
    }
    const https = require('https');
    const req = https.get(
      `https://ip-api.com/json/${ip}?lang=pt-BR&fields=status,city,regionName,country`,
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const g = JSON.parse(data);
            if (g.status === 'success') {
              resolve({ city: g.city || '', region: g.regionName || '', country: g.country || 'BR' });
            } else {
              resolve({ city: '', region: '', country: 'BR' });
            }
          } catch { resolve({ city: '', region: '', country: 'BR' }); }
        });
      }
    );
    req.on('error', () => resolve({ city: '', region: '', country: 'BR' }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ city: '', region: '', country: 'BR' }); });
  });
}

// Classifica a fonte de tráfego com base nos parâmetros UTM e referrer
function classifyTraffic(utm_source, utm_medium, referrer) {
  const src = (utm_source || '').toLowerCase().trim();
  const med = (utm_medium || '').toLowerCase().trim();
  const ref = (referrer || '').toLowerCase();

  const isPago = ['cpc', 'ppc', 'paid', 'paid_social', 'paid-social', 'paidsearch', 'paid_search', 'display'].includes(med);

  if ((src === 'google' || src === 'google ads') && isPago)           return 'Google Ads';
  if (['facebook', 'fb', 'meta'].includes(src) && isPago)             return 'Facebook Ads';
  if (['instagram', 'ig'].includes(src) && isPago)                    return 'Instagram Ads';
  if (src === 'tiktok' && isPago)                                      return 'TikTok Ads';
  if (['youtube', 'yt'].includes(src) && isPago)                       return 'YouTube Ads';
  if (med === 'email' || src === 'email' || src === 'newsletter')      return 'E-mail';
  if (src === 'whatsapp' || ref.includes('api.whatsapp') || ref.includes('wa.me')) return 'WhatsApp';
  if (['facebook', 'fb', 'meta'].includes(src) || ref.includes('facebook.com') || ref.includes('fb.com') || ref.includes('messenger.com')) return 'Facebook';
  if (['instagram', 'ig'].includes(src) || ref.includes('instagram.com')) return 'Instagram';
  if (src === 'tiktok' || ref.includes('tiktok.com'))                  return 'TikTok';
  if (['youtube', 'yt'].includes(src) || ref.includes('youtube.com') || ref.includes('youtu.be')) return 'YouTube';
  if (src === 'google' || med === 'organic' || ref.includes('google.') || ref.includes('bing.com') || ref.includes('yahoo.com') || ref.includes('duckduckgo.com')) return 'Orgânico';
  if (src || med) return (src || med);
  if (ref) return 'Referência';
  return 'Direto';
}

// Endpoint público de rastreamento (sem autenticação)
app.post('/api/track', rateLimit(60 * 1000, 60), async (req, res) => {
  try {
    const {
      session_id = '', page = '/',
      utm_source = '', utm_medium = '', utm_campaign = '',
      utm_content = '', utm_term = '',
      referrer = '', device = '', browser = '',
    } = req.body;

    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const traffic_type = classifyTraffic(utm_source, utm_medium, referrer);

    const r = db.prepare(`
      INSERT INTO page_views (session_id, page, utm_source, utm_medium, utm_campaign,
        utm_content, utm_term, referrer, traffic_type, device, browser)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(session_id, page.slice(0, 500), utm_source.slice(0,100), utm_medium.slice(0,100),
           utm_campaign.slice(0,200), utm_content.slice(0,200), utm_term.slice(0,200),
           referrer.slice(0,500), traffic_type, device.slice(0,20), browser.slice(0,30));

    res.json({ ok: true });

    // Geo-lookup assíncrono (após retornar resposta)
    geoLookup(ip).then(geo => {
      try {
        db.prepare('UPDATE page_views SET city = ?, region = ?, country = ? WHERE id = ?')
          .run(geo.city, geo.region, geo.country, r.lastInsertRowid);
      } catch {}
    }).catch(() => {});
  } catch (e) {
    res.json({ ok: false });
  }
});

// ============================================================
// ANALYTICS
// ============================================================
app.get('/api/analytics', auth, (req, res) => {
  const { period = '30' } = req.query;
  const days = Math.min(Math.max(parseInt(period) || 30, 7), 365);

  // Filtro por atendente para não-admins
  const agentFilter = req.user.role !== 'admin'
    ? `AND attendant_id = ${req.user.attendant_id || -1}`
    : '';

  // ── Leads por dia (últimos N dias) ────────────────────────
  const leadsByDay = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as total
    FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
    ${agentFilter}
    GROUP BY day ORDER BY day ASC
  `).all(days);

  // Preenche dias sem leads com zero
  const dayMap = {};
  leadsByDay.forEach(r => { dayMap[r.day] = r.total; });
  const allDays = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    allDays.push({ day: key, total: dayMap[key] || 0 });
  }

  // ── Totais do período ─────────────────────────────────────
  const periodTotal = db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days') ${agentFilter}
  `).get(days).n;

  const prevTotal = db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
      AND date(created_at) < date('now', '-' || ? || ' days') ${agentFilter}
  `).get(days * 2, days).n;

  // ── Breakdown por status (período) ───────────────────────
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as total FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days') ${agentFilter}
    GROUP BY status
  `).all(days);

  // ── Leads por empreendimento (período) ────────────────────
  const byInterest = db.prepare(`
    SELECT interest, COUNT(*) as total,
      SUM(CASE WHEN status = 'convertido' THEN 1 ELSE 0 END) as convertidos
    FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days') ${agentFilter}
    GROUP BY interest ORDER BY total DESC LIMIT 15
  `).all(days);

  // ── Leads por fonte ───────────────────────────────────────
  const bySource = db.prepare(`
    SELECT source, COUNT(*) as total FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days') ${agentFilter}
    GROUP BY source ORDER BY total DESC
  `).all(days);

  // ── Performance dos atendentes (período) ─────────────────
  const attendantPerf = db.prepare(`
    SELECT a.name,
      COUNT(l.id) as total,
      SUM(CASE WHEN l.status = 'convertido' THEN 1 ELSE 0 END) as convertidos,
      SUM(CASE WHEN l.status = 'em_atendimento' THEN 1 ELSE 0 END) as em_atendimento,
      SUM(CASE WHEN l.status = 'perdido' THEN 1 ELSE 0 END) as perdidos
    FROM leads l
    LEFT JOIN attendants a ON l.attendant_id = a.id
    WHERE date(l.created_at) >= date('now', '-' || ? || ' days') ${agentFilter}
    GROUP BY l.attendant_id ORDER BY total DESC
  `).all(days);

  // ── Leads por hora do dia ─────────────────────────────────
  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hora, COUNT(*) as total
    FROM leads
    WHERE date(created_at) >= date('now', '-' || ? || ' days') ${agentFilter}
    GROUP BY hora ORDER BY hora ASC
  `).all(days);
  const hourMap = {};
  byHour.forEach(r => { hourMap[r.hora] = r.total; });
  const allHours = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: hourMap[h] || 0 }));

  // ── Totais globais (todos os tempos) ─────────────────────
  const allTime = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'convertido' THEN 1 ELSE 0 END) as convertido,
      SUM(CASE WHEN status = 'novo' THEN 1 ELSE 0 END) as novo,
      SUM(CASE WHEN status = 'em_atendimento' THEN 1 ELSE 0 END) as em_atendimento,
      SUM(CASE WHEN status = 'perdido' THEN 1 ELSE 0 END) as perdido
    FROM leads WHERE 1=1 ${agentFilter}
  `).get();

  // ── Tráfego: sessões e pageviews por dia ──────────────────
  const trafficByDay = db.prepare(`
    SELECT date(created_at) as day,
      COUNT(DISTINCT session_id) as sessions,
      COUNT(*) as views
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
    GROUP BY day ORDER BY day ASC
  `).all(days);

  const trafficDayMap = {};
  trafficByDay.forEach(r => { trafficDayMap[r.day] = { sessions: r.sessions, views: r.views }; });
  const allTrafficDays = allDays.map(d => ({
    day: d.day,
    sessions: trafficDayMap[d.day]?.sessions || 0,
    views: trafficDayMap[d.day]?.views || 0,
  }));

  // Totais de tráfego no período
  const trafficTotals = db.prepare(`
    SELECT
      COUNT(DISTINCT session_id) as totalSessions,
      COUNT(*) as totalViews
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
  `).get(days);

  const trafficPrevTotals = db.prepare(`
    SELECT COUNT(DISTINCT session_id) as totalSessions
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
      AND date(created_at) < date('now', '-' || ? || ' days')
  `).get(days * 2, days);

  // ── Tráfego por canal/fonte ───────────────────────────────
  const byTrafficType = db.prepare(`
    SELECT traffic_type, COUNT(DISTINCT session_id) as sessions, COUNT(*) as views
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
    GROUP BY traffic_type ORDER BY sessions DESC
  `).all(days);

  // ── Tráfego por dispositivo ───────────────────────────────
  const byDevice = db.prepare(`
    SELECT device, COUNT(DISTINCT session_id) as sessions
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
    GROUP BY device ORDER BY sessions DESC
  `).all(days);

  // ── Tráfego por cidade ────────────────────────────────────
  const byCity = db.prepare(`
    SELECT city, region, COUNT(DISTINCT session_id) as sessions
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
      AND city != '' AND city IS NOT NULL
    GROUP BY city ORDER BY sessions DESC LIMIT 20
  `).all(days);

  // ── Páginas mais visitadas ────────────────────────────────
  const byPage = db.prepare(`
    SELECT page, COUNT(*) as views, COUNT(DISTINCT session_id) as sessions
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
    GROUP BY page ORDER BY views DESC LIMIT 20
  `).all(days);

  // ── Campanhas UTM ─────────────────────────────────────────
  const byCampaign = db.prepare(`
    SELECT utm_campaign, utm_source, utm_medium,
      COUNT(DISTINCT session_id) as sessions, COUNT(*) as views
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
      AND utm_campaign != '' AND utm_campaign IS NOT NULL
    GROUP BY utm_campaign ORDER BY sessions DESC LIMIT 20
  `).all(days);

  // ── Referrers ─────────────────────────────────────────────
  const byReferrer = db.prepare(`
    SELECT referrer, COUNT(DISTINCT session_id) as sessions
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
      AND referrer != '' AND referrer IS NOT NULL
    GROUP BY referrer ORDER BY sessions DESC LIMIT 20
  `).all(days);

  // ── Navegador ─────────────────────────────────────────────
  const byBrowser = db.prepare(`
    SELECT browser, COUNT(DISTINCT session_id) as sessions
    FROM page_views
    WHERE date(created_at) >= date('now', '-' || ? || ' days')
      AND browser != '' AND browser IS NOT NULL
    GROUP BY browser ORDER BY sessions DESC
  `).all(days);

  res.json({
    period: days,
    periodTotal,
    prevTotal,
    allTime,
    leadsByDay: allDays,
    byStatus,
    byInterest,
    bySource,
    attendantPerf,
    byHour: allHours,
    // Tráfego
    trafficByDay: allTrafficDays,
    trafficTotals,
    trafficPrevTotals,
    byTrafficType,
    byDevice,
    byCity,
    byPage,
    byCampaign,
    byReferrer,
    byBrowser,
  });
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
// HEALTH CHECK
// ============================================================
app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', db: true, uptime: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ status: 'error', db: false });
  }
});

// ============================================================
// START
// ============================================================
const server = app.listen(PORT, () => {
  console.log(`\n✅ Portal Cury rodando em http://localhost:${PORT}`);
  console.log(`   Admin CRM: http://localhost:${PORT}/admin`);
  console.log(`   Health:    http://localhost:${PORT}/health\n`);
});

// Graceful shutdown — fecha banco antes de sair
function shutdown(signal) {
  console.log(`\n[${signal}] Encerrando servidor...`);
  server.close(() => {
    db.close();
    console.log('Banco de dados fechado. Até logo!');
    process.exit(0);
  });
  // Força saída após 10s se não finalizar
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
