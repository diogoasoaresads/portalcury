const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
const rows = db.prepare("SELECT id, remote_jid, LENGTH(remote_jid) as len, last_message_body FROM wa_conversations LIMIT 20;").all();
console.log(JSON.stringify(rows, null, 2));
db.close();
