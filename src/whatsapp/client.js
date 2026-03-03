const fs = require('fs/promises');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const { env } = require('../config/env');
const { handleCommand } = require('../commands/registry');

const logger = P({ level: 'info' });

let baileys;

async function loadBaileys() {
  if (!baileys) {
    const module = await import('@whiskeysockets/baileys');
    baileys = module.default ? { ...module, default: module.default } : module;
  }


  return baileys;
}

async function ensureSessionDir() {
  await fs.mkdir(env.SESSION_DIR, { recursive: true });
}

async function startWhatsAppClient() {
  await ensureSessionDir();

  const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
  } = await loadBaileys();

  const { state, saveCreds } = await useMultiFileAuthState(env.SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });


  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && env.WHATSAPP_SEND_QR_TO_TERMINAL) {
      qrcode.generate(qr, { small: true });
      logger.info('QR baru dibuat. Scan di WhatsApp > Linked Devices.');
    }

    if (connection === 'open') {
      logger.info('WhatsApp connected');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, 'WhatsApp disconnected');

      if (shouldReconnect) {
        startWhatsAppClient().catch((err) => logger.error(err, 'Reconnect failed'));
      }
    }
  });

  sock.ev.on('messages.upsert', async (msg) => {
    const incoming = msg.messages?.[0];
    if (!incoming || incoming.key.fromMe) return;

    const remoteJid = incoming.key.remoteJid;
    if (!remoteJid) return;

    const text =
      incoming.message?.conversation ||
      incoming.message?.extendedTextMessage?.text ||
      '';

    if (!text) return;

    const normalizedText = text.trim();
    const sherlockPrefix = `${env.BOT_PREFIX}sherlock`;
    const holehePrefix = `${env.BOT_PREFIX}holehe`;

    if (normalizedText.toLowerCase().startsWith(sherlockPrefix.toLowerCase())) {
      const argsText = normalizedText.slice(sherlockPrefix.length).trim();
      const username = argsText || '-';

      await sock.sendMessage(
        remoteJid,
        {
          text: [
            '🔔 *Informasi Proses Sherlock*',
            `Target username: *${username}*`,
            'Status: *Memulai proses eksekusi di server*'
          ].join('\n')
        },
        { quoted: incoming }
      );

      await sock.sendMessage(
        remoteJid,
        {
          text: [
            '⏳ *Informasi Proses Sherlock*',
            `Target username: *${username}*`,
            'Status: *Sedang melakukan proses pencarian OSINT*'
          ].join('\n')
        },
        { quoted: incoming }
      );
    }

    if (normalizedText.toLowerCase().startsWith(holehePrefix.toLowerCase())) {
      const argsText = normalizedText.slice(holehePrefix.length).trim();
      const email = argsText || '-';

      await sock.sendMessage(
        remoteJid,
        {
          text: [
            '🔔 *Informasi Proses Holehe*',
            `Target email: *${email}*`,
            'Status: *Memulai proses eksekusi di server*'
          ].join('\n')
        },
        { quoted: incoming }
      );

      await sock.sendMessage(
        remoteJid,
        {
          text: [
            '⏳ *Informasi Proses Holehe*',
            `Target email: *${email}*`,
            'Status: *Sedang melakukan proses pencarian akun terkait email*'
          ].join('\n')
        },
        { quoted: incoming }
      );
    }

    const response = await handleCommand(text);
    if (!response) return;

    await sock.sendMessage(remoteJid, { text: response }, { quoted: incoming });
  });

  return sock;
}

module.exports = { startWhatsAppClient };
