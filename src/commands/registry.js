const { runSherlock } = require('../services/sherlock');
const { runHolehe } = require('../services/holehe');
const { runMaigret } = require('../services/maigret');
const { env } = require('../config/env');

function getHelpMessage() {
  return [
    '*CICERO Sherlock Bot*',
    '',
    `Perintah:`,
    `${env.BOT_PREFIX}ping`,
    `${env.BOT_PREFIX}sherlock <username>`,
    `${env.BOT_PREFIX}holehe <email>`,
    `${env.BOT_PREFIX}maigret <username>`,
    `${env.BOT_PREFIX}exif (reply gambar)`,
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
    try {
      const result = await runSherlock(username);
      return [
        `✅ Proses Sherlock selesai untuk *${result.username}*`,
        `📁 Direktori hasil: ${result.reportDir}`,
        '',
        '*Ringkasan hasil eksekusi:*',
        '```',
        result.output || 'Tidak ada output.',
        '```'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Sherlock command failed:', {
        username,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Sherlock*',
        `Target username: *${username || '-'}*`,
        'Status: *Proses selesai dengan kegagalan*',
        '',
        'Silakan coba kembali. Jika kendala berulang, mohon hubungi operator untuk pemeriksaan log server.'
      ].join('\n');
    }
  }

  if (command === 'holehe') {
    const email = rest.join(' ');
    try {
      const result = await runHolehe(email);
      return [
        `✅ Proses Holehe selesai untuk *${result.email}*`,
        `📄 File output: ${result.outputFile}`,
        '',
        '*Ringkasan hasil eksekusi:*',
        '```',
        result.output || 'Tidak ada output.',
        '```'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Holehe command failed:', {
        email,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Holehe*',
        `Target email: *${email || '-'}*`,
        'Status: *Proses selesai dengan kegagalan*',
        '',
        'Silakan coba kembali. Jika kendala berulang, mohon hubungi operator untuk pemeriksaan log server.'
      ].join('\n');
    }
  }

  if (command === 'maigret') {
    const username = rest.join(' ');
    try {
      const result = await runMaigret(username);
      return [
        `✅ Proses Maigret selesai untuk *${result.username}*`,
        `📄 File output: ${result.outputFile}`,
        '',
        '*Ringkasan hasil eksekusi:*',
        '```',
        result.output || 'Tidak ada output.',
        '```'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Maigret command failed:', {
        username,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Maigret*',
        `Target username: *${username || '-'}*`,
        'Status: *Proses selesai dengan kegagalan*',
        '',
        'Silakan coba kembali. Jika kendala berulang, mohon hubungi operator untuk pemeriksaan log server.'
      ].join('\n');
    }
  }

  return `Perintah tidak dikenal. Ketik ${env.BOT_PREFIX}help`;
}

module.exports = { handleCommand, getHelpMessage };
