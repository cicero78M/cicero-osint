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

  const getMessageContext = (key = {}) => ({
    remoteJid: key.remoteJid || '-',
    id: key.id || '-',
    participant: key.participant || '-'
  });

  const toErrorText = (errorLike) => {
    if (!errorLike) return '';
    if (typeof errorLike === 'string') return errorLike;
    return [
      errorLike.message,
      errorLike.data,
      errorLike.output?.payload?.message,
      errorLike.output?.payload?.error,
      errorLike.output?.statusCode,
      errorLike.stack
    ]
      .filter(Boolean)
      .join(' | ');
  };

  const isPreKeyIssue = (errorLike) => PREKEY_SIGNATURE.test(toErrorText(errorLike));

  const scheduleReconnect = ({ reason, context = {}, force = false }) => {
    const now = Date.now();
    const exponent = Math.max(0, reconnectState.retryCount - 1);
    const delay = force
      ? BASE_RECONNECT_DELAY_MS
      : Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (2 ** exponent));
    const executeAt = Math.max(now + delay, reconnectState.nextAllowedAt);
    const waitMs = Math.max(0, executeAt - now);

    if (reconnectState.timer) {
      logger.warn(
        {
          ...context,
          retryCount: reconnectState.retryCount,
          recoveryAction: 'reconnect-already-scheduled',
          waitMs,
          reason
        },
        'Skipping duplicate reconnect schedule'
      );
      return;
    }

    reconnectState.timer = setTimeout(() => {
      reconnectState.timer = null;
      startWhatsAppClient().catch((err) => {
        logger.error(
          { err, retryCount: reconnectState.retryCount, recoveryAction: 'reconnect-failed' },
          'Reconnect failed'
        );
      });
    }, waitMs);

    logger.warn(
      {
        ...context,
        retryCount: reconnectState.retryCount,
        recoveryAction: 'scheduled-reconnect',
        waitMs,
        reason
      },
      'Reconnect scheduled'
    );
  };

  const runPreKeyRecovery = async ({ error, key, source }) => {
    const context = getMessageContext(key);
    const sessionKey = `${context.remoteJid}:${context.participant}`;
    const now = Date.now();
    const previous = preKeyThrottleBySession.get(sessionKey);
    const withinWindow = previous && now - previous.windowStart < PREKEY_THROTTLE_WINDOW_MS;
    const retryCount = withinWindow ? previous.retryCount + 1 : 1;

    preKeyThrottleBySession.set(sessionKey, {
      retryCount,
      windowStart: withinWindow ? previous.windowStart : now,
      lastAt: now
    });

    if (retryCount > PREKEY_THROTTLE_LIMIT) {
      logger.warn(
        {
          ...context,
          retryCount,
          recoveryAction: 'throttled-prekey-recovery',
          source,
          errorText: toErrorText(error)
        },
        'PreKey recovery throttled to prevent reconnect loop'
      );
      return;
    }

    reconnectState.retryCount += 1;
    reconnectState.nextAllowedAt = now + BASE_RECONNECT_DELAY_MS;

    try {
      await saveCreds();
      logger.warn(
        {
          ...context,
          retryCount,
          recoveryAction: 'persist-creds-and-reconnect',
          source,
          errorText: toErrorText(error)
        },
        'Detected PreKey drift, persisted creds before reconnect'
      );
    } catch (saveError) {
      logger.error(
        {
          ...context,
          retryCount,
          recoveryAction: 'persist-creds-failed-reconnect',
          source,
          err: saveError
        },
        'Failed to persist creds during PreKey recovery'
      );
    }

    scheduleReconnect({ reason: `${source}-prekey-remediation`, context });
  };

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
      logger.warn({ statusCode, shouldReconnect, retryCount: reconnectState.retryCount }, 'WhatsApp disconnected');

      if (isPreKeyIssue(lastDisconnect?.error)) {
        runPreKeyRecovery({ error: lastDisconnect.error, key: {}, source: 'connection.update' }).catch((err) => {
          logger.error({ err, recoveryAction: 'prekey-recovery-failed' }, 'PreKey recovery handler failed');
        });
        return;
      }

      if (shouldReconnect) {
        reconnectState.retryCount += 1;
        scheduleReconnect({ reason: 'connection-close' });
      }
    }
  });

  sock.ev.on('messages.media-update', (updates) => {
    for (const update of updates || []) {
      if (!isPreKeyIssue(update?.error)) continue;

      runPreKeyRecovery({
        error: update.error,
        key: update.key,
        source: 'messages.media-update'
      }).catch((err) => {
        logger.error({ err, recoveryAction: 'prekey-media-recovery-failed' }, 'PreKey media recovery failed');
      });
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


  function isImageDocument(documentMessage) {
    const mimeType = documentMessage?.mimetype || '';
    return /^image\//i.test(mimeType);
  }

  function getMediaMimeType(source) {
    return source?.message?.imageMessage?.mimetype || source?.message?.documentMessage?.mimetype || null;
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

    const mimeType = getMediaMimeType(pendingRequest.imageSource);
    const result = await processExifFromBuffer(buffer, mimeType);

    const chunks = [result.summary, result.fullMetadata].filter(Boolean);

    for (const chunk of chunks) {
      await sock.sendMessage(remoteJid, { text: chunk }, { quoted: incoming });
    }
  }

  function getQuotedImageSource(incoming) {
    const quotedMessage = incoming.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const hasImage = Boolean(quotedMessage?.imageMessage);
    const hasImageDocument = isImageDocument(quotedMessage?.documentMessage);

    if (!hasImage && !hasImageDocument) return null;

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

    try {
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

      if (incoming.message?.imageMessage || isImageDocument(incoming.message?.documentMessage)) {
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
                'Untuk memproses EXIF, silakan kirim gambar (atau dokumen bergambar) langsung, atau reply medianya dengan perintah *!exif*.'
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
    } catch (error) {
      if (isPreKeyIssue(error)) {
        await runPreKeyRecovery({
          error,
          key: incoming.key,
          source: 'messages.upsert'
        });
        return;
      }

      logger.error(
        {
          err: error,
          remoteJid,
          id: incoming.key?.id || '-',
          recoveryAction: 'none'
        },
        'Unhandled message processing error'
      );
    }
  });

  return sock;
}

module.exports = { startWhatsAppClient };
