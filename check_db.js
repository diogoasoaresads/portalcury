const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'portalcury.db');

console.log('--- DIAGNÓSTICO DB ---');
console.log('Caminho do banco:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('ERRO: Banco de dados não encontrado!');
    process.exit(1);
}

const db = new Database(dbPath);

try {
    const convCount = db.prepare('SELECT COUNT(*) as c FROM wa_conversations').get().c;
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM wa_messages').get().c;
    const logCount = db.prepare('SELECT COUNT(*) as c FROM wa_logs').get().c;

    console.log('Conversas:', convCount);
    console.log('Mensagens:', msgCount);
    console.log('Logs:', logCount);

    if (logCount > 0) {
        console.log('\nÚltimos 5 logs:');
        const logs = db.prepare('SELECT * FROM wa_logs ORDER BY id DESC LIMIT 5').all();
        logs.forEach(l => console.log(`[${l.created_at}] ${l.msg}`));
    } else {
        console.log('\nTabela wa_logs está VAZIA.');
    }

} catch (err) {
    console.error('ERRO ao ler tabelas:', err.message);
} finally {
    db.close();
}
