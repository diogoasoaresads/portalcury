const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data', 'portalcury.db'));
const columns = db.prepare("PRAGMA table_info(leads)").all();
console.log(JSON.stringify(columns, null, 2));
db.close();
