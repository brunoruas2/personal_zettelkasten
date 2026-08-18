module.exports = {
  apps: [
    {
      name: 'zettelkasten',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'zettelkasten-api',
      cwd: './apps/api',
      script: './api',
      env_file: './apps/api/.env',
    },
  ],
};
