module.exports = {
  apps: [
    {
      name: 'slack-hiware-api',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      kill_timeout: 10000,
    },
    {
      name: 'slack-hiware-worker',
      script: 'src/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      kill_timeout: 10000,
    },
  ],
};
