module.exports = {
  apps: [
    {
      name: 'cicero-sherlock-wa-bot',
      script: 'src/index.js',
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
