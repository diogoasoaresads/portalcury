const https = require('https');

function testWebhook() {
  const data = JSON.stringify({
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { remoteJid: '5521999999999@s.whatsapp.net', fromMe: false, id: 'TESTE_ID_' + Date.now() },
      pushName: 'Teste Debug',
      message: { conversation: 'Mensagem de teste interna para validar banco' },
      messageType: 'conversation'
    }
  });

  const options = {
    hostname: 'curymeuape.com.br',
    port: 443,
    path: '/webhook/wa-incoming',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (d) => process.stdout.write(d));
  });

  req.on('error', (error) => console.error('Erro no teste:', error));
  req.write(data);
  req.end();
}

testWebhook();
