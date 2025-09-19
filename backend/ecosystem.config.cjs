// backend/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: '1logic-backend',
      cwd: '/var/www/1logic/backend',   // всегда из стабильного симлинка
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
