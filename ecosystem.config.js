// Configuração PM2 – gerenciador de processos para VPS
// Uso:
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup

module.exports = {
  apps: [
    {
      name: 'centralcuryvendas',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Aponte para um diretório fora da pasta do projeto para que o banco
        // sobreviva a git pulls e atualizações. Crie o diretório antes:
        //   sudo mkdir -p /var/lib/centralcuryvendas && sudo chown $USER /var/lib/centralcuryvendas
        DATA_DIR: '/var/lib/centralcuryvendas',
      },
      // Logs
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
