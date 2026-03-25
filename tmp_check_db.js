const Database = require('better-sqlite3');
const path = require('path');
const db = new Database('data/database.sqlite');

console.log('--- VERIFICANDO ÍNDICES ---');
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='wa_messages'").all();
console.log('Índices em wa_messages:', JSON.stringify(indexes, null, 2));

console.log('\n--- ÚLTIMAS 10 MENSAGENS ---');
const msgs = db.prepare("SELECT id, conversation_id, direction, body, message_id, created_at FROM wa_messages ORDER BY id DESC LIMIT 10").all();
console.log(JSON.stringify(msgs, null, 2));

console.log('\n--- CONTAGEM DE DUPLICATAS POR ID ---');
const dups = db.prepare("SELECT message_id, COUNT(*) as c FROM wa_messages WHERE message_id != '' GROUP BY message_id HAVING c > 1").all();
console.log('Duplicatas encontradas:', JSON.stringify(dups, null, 2));

db.close();
