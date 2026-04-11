/**
 * reset_crm.js — Zera todos os dados do CRM, mantendo apenas o usuário PO.
 *
 * Uso no terminal do EasyPanel:
 *   node reset_crm.js
 */

const Database = require('better-sqlite3');
const bcrypt    = require('bcryptjs');
const path      = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const db      = new Database(path.join(dataDir, 'portalcury.db'));

const PO_USERNAME = 'diogoasoaresads@gmail.com';
const PO_PASSWORD = '06112005';

console.log('\n🔄 Iniciando reset do CRM...\n');

db.pragma('foreign_keys = OFF');

const tables = [
  'wa_messages',
  'wa_conversations',
  'wa_logs',
  'lead_activities',
  'leads',
  'attendants',
  'users',
  'config',
  'page_views',
];

for (const table of tables) {
  try {
    db.prepare(`DELETE FROM ${table}`).run();
    console.log(`✓ Tabela "${table}" limpa.`);
  } catch (e) {
    console.warn(`⚠ Tabela "${table}" não encontrada, pulando.`);
  }
}

// Recria o usuário PO
const hash = bcrypt.hashSync(PO_PASSWORD, 10);
db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run(PO_USERNAME, hash, 'PO');
console.log(`\n✅ Usuário PO recriado: ${PO_USERNAME}`);

db.pragma('foreign_keys = ON');
db.close();

console.log('\n✅ CRM zerado com sucesso. Reinicie o servidor.\n');
