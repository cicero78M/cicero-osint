const fs = require('fs/promises');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const { env } = require('../config/env');
const { handleCommand } = require('../commands/registry');
const { processExifFromBuffer } = require('../services/exif');

const logger = P({ level: 'info' });

let baileys;
const pendingExifRequests = new Map();
const EXIF_CONFIRMATION_TTL_MS = env.EXIF_CONFIRMATION_TTL_MS;

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
    downloadMediaMessage,
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


  clearPendingExifRequests('startup');
  const pendingExifSweepInterval = setInterval(evictExpiredPendingExifRequests, Math.min(EXIF_CONFIRMATION_TTL_MS, 60000));

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && env.WHATSAPP_SEND_QR_TO_TERMINAL) {
      qrcode.generate(qr, { small: true });
      logger.info('QR baru dibuat. Scan di WhatsApp > Linked Devices.');
    }

    if (connection === 'open') {
      clearPendingExifRequests('connection-open');
      logger.info('WhatsApp connected');
    }

    if (connection === 'close') {
      clearInterval(pendingExifSweepInterval);
      clearPendingExifRequests('connection-close');
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, 'WhatsApp disconnected');

      if (shouldReconnect) {
        startWhatsAppClient().catch((err) => logger.error(err, 'Reconnect failed'));
      }
    }
  });

  function getPendingKey(message) {
    const remoteJid = message?.key?.remoteJid || '-';
    const participant = message?.key?.participant || remoteJid;
    return `${remoteJid}:${participant}`;
  }

  function clearPendingExifRequests(reason) {
    if (pendingExifRequests.size > 0) {
      logger.info({ reason, cleared: pendingExifRequests.size }, 'Membersihkan pending EXIF requests');
      pendingExifRequests.clear();
    }
  }

  function evictExpiredPendingExifRequests() {
    const now = Date.now();

    for (const [key, request] of pendingExifRequests.entries()) {
      if (!request?.createdAt || now - request.createdAt > EXIF_CONFIRMATION_TTL_MS) {
        pendingExifRequests.delete(key);
      }
    }
  }

  async function askExifConfirmation(remoteJid, incoming, imageSource) {
    const pendingKey = getPendingKey(incoming);
    pendingExifRequests.set(pendingKey, {
      imageSource,
      createdAt: Date.now()
    });

    await sock.sendMessage(
      remoteJid,
      {
        text: [
          '📷 *Analisis Metadata Gambar*',
          'Kami menerima gambar Anda.',
          'Apakah Anda ingin memproses metadata EXIF sekarang?',
          "Silakan balas dengan *ya* untuk melanjutkan atau *tidak* untuk membatalkan."
        ].join('\n')
      },
      { quoted: incoming }
    );
  }

  async function processPendingExif(remoteJid, incoming, pendingRequest) {
    const buffer = await downloadMediaMessage(
      pendingRequest.imageSource,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage
      }
    );

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Gagal mengunduh media gambar dari WhatsApp.');
    }

    const mimeType = pendingRequest.imageSource?.message?.imageMessage?.mimetype;
    const result = await processExifFromBuffer(buffer, mimeType);

    await sock.sendMessage(remoteJid, { text: result.summary }, { quoted: incoming });
  }

  function getQuotedImageSource(incoming) {
    const quotedMessage = incoming.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage?.imageMessage) return null;

    return {
      key: {
        remoteJid: incoming.key.remoteJid,
        id: incoming.message.extendedTextMessage.contextInfo?.stanzaId,
        participant: incoming.message.extendedTextMessage.contextInfo?.participant
      },
      message: quotedMessage
    };
  }

  sock.ev.on('messages.upsert', async (msg) => {
    const incoming = msg.messages?.[0];
    if (!incoming || incoming.key.fromMe) return;

    const remoteJid = incoming.key.remoteJid;
    if (!remoteJid) return;

    const text =
      incoming.message?.conversation ||
      incoming.message?.extendedTextMessage?.text ||
      '';
    const normalizedText = text.trim();
    evictExpiredPendingExifRequests();
    const pendingKey = getPendingKey(incoming);
    const pendingRequest = pendingExifRequests.get(pendingKey);

    if (!pendingRequest && /^(ya|tidak)$/i.test(normalizedText)) {
      await sock.sendMessage(
        remoteJid,
        {
          text: [
            '⌛ Permintaan EXIF sebelumnya sudah kedaluwarsa atau tidak ditemukan.',
            'Silakan kirim ulang gambar atau reply gambar dengan perintah *!exif* untuk memulai lagi.'
          ].join('\n')
        },
        { quoted: incoming }
      );
      return;
    }

    if (pendingRequest && /^ya$/i.test(normalizedText)) {
      pendingExifRequests.delete(pendingKey);
      await sock.sendMessage(
        remoteJid,
        { text: '⏳ Permintaan diproses. Sistem sedang mengekstrak metadata EXIF gambar Anda.' },
        { quoted: incoming }
      );

      try {
        await processPendingExif(remoteJid, incoming, pendingRequest);
      } catch (error) {
        logger.error({ err: error }, 'Gagal memproses EXIF');
        await sock.sendMessage(
          remoteJid,
          {
            text: [
              '❌ *Analisis Metadata Gambar*',
              'Proses EXIF gagal dijalankan karena EXIF tool belum terpasang atau belum dikonfigurasi.',
              `Detail: ${error?.message || 'Terjadi kesalahan tidak terduga.'}`
            ].join('\n')
          },
          { quoted: incoming }
        );
      }
      return;
    }

    if (pendingRequest && /^tidak$/i.test(normalizedText)) {
      pendingExifRequests.delete(pendingKey);
      await sock.sendMessage(
        remoteJid,
        { text: 'Permintaan pemrosesan metadata dibatalkan sesuai instruksi Anda.' },
        { quoted: incoming }
      );
      return;
    }

    const sherlockPrefix = `${env.BOT_PREFIX}sherlock`;
    const holehePrefix = `${env.BOT_PREFIX}holehe`;
    const exifPrefix = `${env.BOT_PREFIX}exif`;

    if (incoming.message?.imageMessage) {
      await askExifConfirmation(remoteJid, incoming, incoming);
      return;
    }

    if (!normalizedText) return;

    if (normalizedText.toLowerCase().startsWith(exifPrefix.toLowerCase())) {
      const quotedImageSource = getQuotedImageSource(incoming);
      if (!quotedImageSource) {
        await sock.sendMessage(
          remoteJid,
          {
            text: [
              'Untuk memproses EXIF, silakan kirim gambar langsung atau reply gambar dengan perintah *!exif*.'
            ].join('\n')
          },
          { quoted: incoming }
        );
        return;
      }

      await askExifConfirmation(remoteJid, incoming, quotedImageSource);
      return;
    }

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
