const { runSherlock } = require('../services/sherlock');
const { runHolehe } = require('../services/holehe');
const { runMaigret } = require('../services/maigret');
const { runInstaloader } = require('../services/instaloader');
const { runTheHarvester } = require('../services/theharvester');
const { runGoogleDork, DOCUMENT_TYPES } = require('../services/googleDork');
const { runMiniMaltego } = require('../services/miniMaltego');
const { runSocialMediaIntel } = require('../services/socialMediaIntel');
const { runTwitterIssueHunter } = require('../services/twitterIssueHunter');
const { runTikTokIssueHunter } = require('../services/tiktokIssueHunter');
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
    `${env.BOT_PREFIX}instaloader <username>`,
    `${env.BOT_PREFIX}theharvester <domain>`,
    `${env.BOT_PREFIX}dorkdoc <keyword> (pencarian luas tanpa batasan filetype)`,
    `${env.BOT_PREFIX}dork <keyword> (pencarian luas tanpa batasan filetype)`,
    `${env.BOT_PREFIX}dorkdoc <keyword> <target|-> <domain|-> <tipe_dokumen>`,
    `${env.BOT_PREFIX}exif (reply gambar)`,
    `${env.BOT_PREFIX}minim <domain|-> <email_csv|-> <username_csv|-> (alias: miniosint, maltego)`,
    `${env.BOT_PREFIX}socmint <handle_csv|-> <email_csv|-> <link_csv|-> <keyword_csv|-> <hashtag_csv|->`,
    `${env.BOT_PREFIX}xissue <keyword_csv> <window_menit(15-1440)|60>`,
    `${env.BOT_PREFIX}ttissue <keyword_csv> <window_menit(15-1440)|60>`,
    `${env.BOT_PREFIX}help`,
    '',
    `Tipe dokumen preset: ${DOCUMENT_TYPES.join(', ')}`,
    env.GOOGLE_DORK_DEFAULT_SITE
      ? `Default domain (opsional): ${env.GOOGLE_DORK_DEFAULT_SITE} (pakai '-' jika ingin default)`
      : 'Default domain (opsional): belum di-set'
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


  if (command === 'instaloader') {
    const username = rest.join(' ');
    try {
      const result = await runInstaloader(username);
      return [
        `✅ Proses Instaloader selesai untuk *${result.username}*`,
        `📁 Direktori hasil: ${result.reportDir}`,
        `📄 File output: ${result.outputFile}`,
        '',
        '*Ringkasan hasil eksekusi:*',
        '```',
        result.output || 'Tidak ada output.',
        '```'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Instaloader command failed:', {
        username,
        error: error?.stack || error?.message || String(error)
      });

      const isRateLimited = error?.code === 'RATE_LIMITED';
      const statusMessage = isRateLimited
        ? `Status: *${error.message || 'Instagram membatasi permintaan (HTTP 429).*'}`
        : 'Status: *Proses selesai dengan kegagalan*';

      return [
        '❌ *Informasi Proses Instaloader*',
        `Target username: *${username || '-'}*`,
        statusMessage,
        '',
        isRateLimited
          ? 'Silakan tunggu sampai jeda rate limit selesai, lalu jalankan kembali perintah.'
          : 'Silakan coba kembali. Jika kendala berulang, mohon hubungi operator untuk pemeriksaan log server.'
      ].join('\n');
    }
  }


  if (command === 'dorkdoc' || command === 'dork') {
    const [keyword, targetInput, domainInput, fileTypeInput, ...extra] = rest;

    const useWidePreset = rest.length === 1;
    const target = useWidePreset ? '' : targetInput;
    const domain = useWidePreset ? '' : domainInput;
    const fileType = useWidePreset ? '' : fileTypeInput;

    const isInvalidWideMode = useWidePreset && (!keyword || extra.length > 0);
    const isInvalidFullMode = !useWidePreset && (!keyword || !fileTypeInput || extra.length > 0);

    if (isInvalidWideMode || isInvalidFullMode) {
      return [
        `❌ *Informasi Proses Google Dork*`,
        'Status: *Argumen tidak lengkap atau format tidak valid*',
        '',
        `Format cepat: ${env.BOT_PREFIX}dorkdoc <keyword> (pencarian luas tanpa filetype)`,
        `Gunakan format: ${env.BOT_PREFIX}dorkdoc <keyword> <target|-> <domain|-> <tipe_dokumen|->`,
        `Alias: ${env.BOT_PREFIX}dork <keyword> <target|-> <domain|-> <tipe_dokumen|->`,
        `Tipe dokumen preset: ${DOCUMENT_TYPES.join(', ')}`,
        env.GOOGLE_DORK_DEFAULT_SITE
          ? `Gunakan '-' pada domain untuk memakai default: ${env.GOOGLE_DORK_DEFAULT_SITE}`
          : `Gunakan '-' pada target/domain jika ingin pencarian lebih luas tanpa filter tambahan.`
      ].join('\n');
    }

    try {
      const normalizedTarget = target === '-' ? '' : target;
      const normalizedDomain = domain === '-' ? (env.GOOGLE_DORK_DEFAULT_SITE || '') : domain;
      const result = await runGoogleDork({ keyword, target: normalizedTarget, domain: normalizedDomain, fileType });
      return [
        '✅ *Informasi Proses Google Dork*',
        `Keyword: *${result.keyword}*`,
        `Target: *${result.target || '-'}*`,
        `Domain: *${result.domain || '-'}*`,
        `Tipe dokumen: *${result.fileType || '-'}*`,
        `Jumlah URL didapat: *${result.totalDiscovered || 0}*`,
        `Jumlah URL diproses: *${(result.links || []).length}*`,
        'Status: *Query berhasil dibuat*',
        '',
        '*Ringkasan hasil eksekusi:*',
        '```',
        result.output || 'Tidak ada output.',
        '```',
        '',
        '*Log proses:*',
        '```',
        (result.processLog || []).join('\n') || 'Log proses tidak tersedia.',
        '```'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Google dork command failed:', {
        keyword,
        target,
        domain,
        fileType,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Google Dork*',
        `Keyword: *${keyword || '-'}*`,
        `Target: *${target || '-'}*`,
        `Domain: *${domain || '-'}*`,
        `Tipe dokumen: *${fileType || '-'}*`,
        `Status: *${error?.message || 'Proses selesai dengan kegagalan'}*`,
        '',
        'Silakan periksa kembali parameter lalu coba ulangi perintah.'
      ].join('\n');
    }
  }


  if (command === 'minim' || command === 'miniosint' || command === 'maltego') {
    const [domain, emails, handles, ...extra] = rest;
    if (extra.length > 0) {
      return [
        '❌ *Informasi Proses Mini-Maltego OSINT*',
        'Status: *Format argumen tidak valid*',
        '',
        `Gunakan format: ${env.BOT_PREFIX}minim <domain|-> <email_csv|-> <username_csv|->`,
        'Contoh: !minim example.com admin@example.com,jane@example.com john,jane_doe'
      ].join('\n');
    }

    try {
      const result = await runMiniMaltego({ domain, emails, handles });
      const text = [
        '✅ *Mini-Maltego OSINT selesai*',
        `Case ID: *${result.caseId}*`,
        `Output folder: ${result.outDir}`,
        `JSON graph: ${result.jsonPath}`,
        `Neo4j nodes CSV: ${result.nodesPath}`,
        `Neo4j edges CSV: ${result.edgesPath}`,
        '',
        '*Ringkasan:*',
        '```',
        result.output || 'Tidak ada ringkasan.',
        '```'
      ].join('\n');

      return {
        text,
        attachments: [
          {
            type: 'document',
            path: result.nodesPath,
            fileName: `${result.caseId}-neo4j_nodes.csv`,
            mimetype: 'text/csv'
          },
          {
            type: 'document',
            path: result.edgesPath,
            fileName: `${result.caseId}-neo4j_edges.csv`,
            mimetype: 'text/csv'
          }
        ]
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Mini-Maltego command failed:', {
        domain,
        emails,
        handles,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Mini-Maltego OSINT*',
        `Domain: *${domain || '-'}*`,
        `Emails: *${emails || '-'}*`,
        `Usernames: *${handles || '-'}*`,
        `Status: *${error?.message || 'Proses selesai dengan kegagalan'}*`,
        '',
        'Cek format input dan ulangi command.'
      ].join('\n');
    }
  }



  if (command === 'socmint' || command === 'socialmint' || command === 'socmed') {
    const [handles, emails, links, keywords, hashtags, ...extra] = rest;
    if (extra.length > 0) {
      return [
        '❌ *Informasi Proses Social Media Information Gathering*',
        'Status: *Format argumen tidak valid*',
        '',
        `Gunakan format: ${env.BOT_PREFIX}socmint <handle_csv|-> <email_csv|-> <link_csv|-> <keyword_csv|-> <hashtag_csv|->`,
        `Contoh: ${env.BOT_PREFIX}socmint john_doe,jane - linktr.ee/john pemilu,bansos #pemilu,#politik`
      ].join('\n');
    }

    try {
      const result = await runSocialMediaIntel({ handles, emails, links, keywords, hashtags });
      return result.output;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Social media intel command failed:', {
        handles,
        emails,
        links,
        keywords,
        hashtags,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Social Media Information Gathering*',
        `Handles: *${handles || '-'}*`,
        `Emails: *${emails || '-'}*`,
        `Links: *${links || '-'}*`,
        `Keywords: *${keywords || '-'}*`,
        `Hashtags: *${hashtags || '-'}*`,
        `Status: *${error?.message || 'Proses selesai dengan kegagalan'}*`,
        '',
        'Cek format input dan ulangi command.'
      ].join('\n');
    }
  }



  if (command === 'ttissue' || command === 'tiktokissue' || command === 'tthunter') {
    const [keywords, windowMinutesInput, ...extra] = rest;
    if (!keywords || extra.length > 0) {
      return [
        '❌ *Informasi Proses TikTok Issue Hunter*',
        'Status: *Format argumen tidak valid*',
        '',
        `Gunakan format: ${env.BOT_PREFIX}ttissue <keyword_csv> <window_menit(15-1440)|60>`,
        `Contoh: ${env.BOT_PREFIX}ttissue bansos,pilkada,macet 60`
      ].join('\n');
    }

    try {
      const result = await runTikTokIssueHunter({ keywords, windowMinutes: windowMinutesInput || 60 });
      const issueLines = result.issues.slice(0, 5).map((issue, idx) => `${idx + 1}. ${issue.label} | burst=${issue.burstScore} | size=${issue.size}`);

      return [
        '✅ *TikTok Issue Hunter selesai*',
        `Case ID: *${result.caseId}*`,
        `Ingestion (window ${result.ingestion.windowMinutes}m): ${result.ingestion.inserted} post tersimpan`,
        `Issue terdeteksi: ${result.issues.length}`,
        `Actor network edges: ${result.actorNetwork.length}`,
        '',
        '*Top issue cluster:*',
        ...(issueLines.length ? issueLines : ['- Belum ada cluster issue yang memenuhi threshold minimum.']),
        '',
        '*Export artifacts:*',
        `- issues.json: ${result.exports.issueJson}`,
        `- nodes.csv: ${result.exports.nodesCsv}`,
        `- edges.csv: ${result.exports.edgesCsv}`,
        '',
        '_Catatan: sumber data berasal dari RapidAPI tiktok-api23 dan dibatasi untuk isu wilayah Jawa Timur (Jatim)._'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('TikTok issue hunter command failed:', {
        keywords,
        windowMinutesInput,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses TikTok Issue Hunter*',
        `Keywords: *${keywords || '-'}*`,
        `Window: *${windowMinutesInput || 60}* menit`,
        `Status: *${error?.message || 'Proses selesai dengan kegagalan'}*`,
        '',
        'Pastikan TIKTOK_RAPIDAPI_KEY, PG_URL, dan schema database tiktok_issue_hunter sudah terpasang.'
      ].join('\n');
    }
  }


  if (command === 'xissue' || command === 'twitterissue' || command === 'xhunter') {
    const [keywords, windowMinutesInput, ...extra] = rest;
    if (!keywords || extra.length > 0) {
      return [
        '❌ *Informasi Proses Twitter/X Issue Hunter*',
        'Status: *Format argumen tidak valid*',
        '',
        `Gunakan format: ${env.BOT_PREFIX}xissue <keyword_csv> <window_menit(15-1440)|60>`,
        `Contoh: ${env.BOT_PREFIX}xissue bansos,pilkada,macet 60`
      ].join('\n');
    }

    try {
      const result = await runTwitterIssueHunter({ keywords, windowMinutes: windowMinutesInput || 60 });
      const issueLines = result.issues.slice(0, 5).map((issue, idx) => `${idx + 1}. ${issue.label} | burst=${issue.burstScore} | size=${issue.size}`);

      return [
        '✅ *Twitter/X Issue Hunter selesai*',
        `Case ID: *${result.caseId}*`,
        `Ingestion (window ${result.ingestion.windowMinutes}m): ${result.ingestion.inserted} post tersimpan`,
        `Issue terdeteksi: ${result.issues.length}`,
        `Actor network edges: ${result.actorNetwork.length}`,
        '',
        '*Top issue cluster:*',
        ...(issueLines.length ? issueLines : ['- Belum ada cluster issue yang memenuhi threshold minimum.']),
        '',
        '*Export artifacts:*',
        `- issues.json: ${result.exports.issueJson}`,
        `- nodes.csv: ${result.exports.nodesCsv}`,
        `- edges.csv: ${result.exports.edgesCsv}`,
        '',
        '_Catatan: pipeline dibatasi untuk isu wilayah Jawa Timur (Jatim) via query rule regional._'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Twitter issue hunter command failed:', {
        keywords,
        windowMinutesInput,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses Twitter/X Issue Hunter*',
        `Keywords: *${keywords || '-'}*`,
        `Window: *${windowMinutesInput || 60}* menit`,
        `Status: *${error?.message || 'Proses selesai dengan kegagalan'}*`,
        '',
        'Pastikan X_BEARER_TOKEN, PG_URL, dan schema database x_issue_hunter sudah terpasang.'
      ].join('\n');
    }
  }

  if (command === 'theharvester') {
    const domain = rest.join(' ');
    try {
      const result = await runTheHarvester(domain);
      return [
        `✅ Proses theHarvester selesai untuk *${result.domain || domain}*`,
        `📄 File output: ${result.outputFile}`,
        '',
        '*Ringkasan hasil eksekusi:*',
        '```',
        result.output || 'Tidak ada output.',
        '```'
      ].join('\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('theHarvester command failed:', {
        domain,
        error: error?.stack || error?.message || String(error)
      });

      return [
        '❌ *Informasi Proses theHarvester*',
        `Target domain: *${domain || '-'}*`,
        'Status: *Proses selesai dengan kegagalan*',
        '',
        'Silakan coba kembali. Jika kendala berulang, mohon hubungi operator untuk pemeriksaan log server.'
      ].join('\n');
    }
  }

  return `Perintah tidak dikenal. Ketik ${env.BOT_PREFIX}help`;
}

module.exports = { handleCommand, getHelpMessage };
