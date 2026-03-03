const { runSherlock } = require('../services/sherlock');
const { env } = require('../config/env');

function getHelpMessage() {
  return [
    '*CICERO Sherlock Bot*',
    '',
    `Perintah:`,
    `${env.BOT_PREFIX}ping`,
    `${env.BOT_PREFIX}sherlock <username>`,
    `${env.BOT_PREFIX}help`
  ].join('\n');
}

async function handleCommand(text) {
  if (!text || !text.startsWith(env.BOT_PREFIX)) return null;

  const raw = text.slice(env.BOT_PREFIX.length).trim();
  const [cmd, ...rest] = raw.split(/\s+/);
  const command = (cmd || '').toLowerCase();

  if (!command || command === 'help') return getHelpMessage();

  if (command === 'ping') {
    return 'pong ✅';
  }

  if (command === 'sherlock') {
    const username = rest.join(' ');
    const startText = `🔎 Menjalankan Sherlock untuk *${username}*...`;

    try {
      const result = await runSherlock(username);
      return [
        startText,
        '',
        `✅ Selesai: *${result.username}*`,
        `📁 Output: ${result.reportDir}`,
        '',
        '```',
        result.output || 'Tidak ada output.',
        '```'
      ].join('\n');
    } catch (error) {
      return [
        `❌ Sherlock gagal untuk *${username || '-'}*`,
        '',
        '```',
        error.message || String(error),
        '```'
      ].join('\n');
    }
  }

  return `Perintah tidak dikenal. Ketik ${env.BOT_PREFIX}help`;
}

module.exports = { handleCommand, getHelpMessage };
