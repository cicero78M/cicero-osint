const fs = require('fs/promises');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const { env } = require('../config/env');
const { handleCommand } = require('../commands/registry');

const logger = P({ level: 'info' });
const store = makeInMemoryStore({ logger: P({ level: 'silent' }) });

async function ensureSessionDir() {
  await fs.mkdir(env.SESSION_DIR, { recursive: true });
}

async function startWhatsAppClient() {
  await ensureSessionDir();

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

  store.bind(sock.ev);

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

    if (env.WHATSAPP_OWNER_JID && remoteJid !== env.WHATSAPP_OWNER_JID) {
      return;
    }

    const response = await handleCommand(text);
    if (!response) return;

    await sock.sendMessage(remoteJid, { text: response }, { quoted: incoming });
  });

  return sock;
}

module.exports = { startWhatsAppClient };
