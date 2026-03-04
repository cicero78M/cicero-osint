const { env } = require('../config/env');
const XLSX = require('xlsx');

const DOCUMENT_TYPES = env.GOOGLE_DORK_DOC_TYPES;
const GOOGLE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};
const GOOGLE_SEARCH_VARIANTS = [
  { name: 'default', extraParams: '' },
  { name: 'basic', extraParams: '&gbv=1' },
  { name: 'web', extraParams: '&udm=14' }
];

function sanitizeKeyword(input) {
  const keyword = String(input || '').trim();
  if (!keyword) {
    throw new Error('Keyword kosong. Gunakan: !dorkdoc <keyword> atau !dorkdoc <keyword> <target|-> <domain|-> <tipe_dokumen|->');
  }
  if (keyword.length > 120) {
    throw new Error('Keyword terlalu panjang. Maksimal 120 karakter.');
  }
  return keyword;
}

function sanitizeTarget(input) {
  const target = String(input || '').trim();
  if (!target) {
    return '';
  }
  if (target.length > 120) {
    throw new Error('Target terlalu panjang. Maksimal 120 karakter.');
  }
  return target;
}

function sanitizeDomain(input) {
  const domain = String(input || '').trim().toLowerCase();
  if (!domain) {
    return '';
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error('Format domain tidak valid. Contoh: example.com');
  }
  return domain;
}

function sanitizeFileType(input) {
  const fileType = String(input || '').trim().toLowerCase().replace(/^\./, '');
  if (!fileType || fileType === '-' || fileType === 'all' || fileType === 'any') {
    return '';
  }
  if (!DOCUMENT_TYPES.includes(fileType)) {
    throw new Error(`Tipe dokumen tidak didukung. Pilihan: ${DOCUMENT_TYPES.join(', ')}, -, all, any`);
  }
  return fileType;
}

function matchesFileType(url, fileType) {
  if (!fileType) return true;
  const safeType = String(fileType).replace(/[^a-z0-9]/gi, '');
  if (!safeType) return false;
  const regex = new RegExp(`\\.${safeType}(?:\\?|$)`, 'i');
  return regex.test(url);
}

function extractGoogleResultUrls(html) {
  const links = [];

  const decodeHtmlEntities = (value) =>
    String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');

  const isGoogleOwnedUrl = (candidateUrl) => {
    try {
      const host = new URL(candidateUrl).hostname.toLowerCase();
      return (
        host === 'google.com' ||
        host.endsWith('.google.com') ||
        host === 'google.co.id' ||
        host.endsWith('.google.co.id') ||
        host.endsWith('.googleusercontent.com') ||
        host.endsWith('.gstatic.com')
      );
    } catch (_) {
      return true;
    }
  };

  const pushIfValid = (url) => {
    if (!/^https?:\/\//i.test(url)) return;
    if (isGoogleOwnedUrl(url)) return;
    if (/google\.[a-z.]+\/search\?/i.test(url)) return;
    links.push(url);
  };

  const pushDecodedIfValid = (candidate) => {
    if (!candidate) return;
    const decoded = decodeHtmlEntities(candidate).trim();
    try {
      pushIfValid(decodeURIComponent(decoded));
    } catch (_) {
      pushIfValid(decoded);
    }
  };

  const hrefRegex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let hrefMatch = hrefRegex.exec(html);

  while (hrefMatch) {
    const href = decodeHtmlEntities(hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim();
    if (href.startsWith('/url?')) {
      try {
        const parsed = new URL(`https://www.google.com${href}`);
        const externalUrl = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        if (externalUrl) {
          pushDecodedIfValid(externalUrl);
        }
      } catch (_) {
        // abaikan href yang tidak valid
      }
    } else {
      pushDecodedIfValid(href);
    }
    hrefMatch = hrefRegex.exec(html);
  }

  const normalizedForFallback = String(html || '')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');

  const runFallbackExtraction = (source) => {
    const fallbackRegex = /\/url\?[^"'\s<>]*?(?:[?&](?:q|url)=)([^&"'\s<>]+)/gi;
    let fallbackMatch = fallbackRegex.exec(source);
    while (fallbackMatch) {
      pushDecodedIfValid(fallbackMatch[1]);
      fallbackMatch = fallbackRegex.exec(source);
    }

    const genericUrlRegex = /https?:\/\/[\w.-]+(?:\/[\w\-./?%&=:#]*)?/gi;
    let genericMatch = genericUrlRegex.exec(source);
    while (genericMatch) {
      pushDecodedIfValid(genericMatch[0]);
      genericMatch = genericUrlRegex.exec(source);
    }
  };

  // fallback jika format HTML tidak menyimpan link hasil pada elemen <a href>
  if (links.length === 0) {
    runFallbackExtraction(html);
  }

  // fallback tambahan untuk variasi markup/serialized payload Google modern
  if (links.length === 0) {
    runFallbackExtraction(normalizedForFallback);
  }

  return [...new Set(links)];
}

function detectGoogleBlock(html) {
  const content = String(html || '').toLowerCase();
  return [
    'detected unusual traffic',
    'our systems have detected unusual traffic',
    '/sorry/index',
    'captcha',
    'recaptcha',
    'verify you are human'
  ].some((pattern) => content.includes(pattern));
}

async function fetchGoogleResultUrls(query, fileType, maxResults) {
  const attempts = [];
  const diagnostics = [];
  let resultUrls = [];
  let detectedBlocking = false;

  for (const variant of GOOGLE_SEARCH_VARIANTS) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=100&hl=id&safe=off&pws=0${variant.extraParams}`;
    const response = await fetch(searchUrl, { headers: GOOGLE_HEADERS, redirect: 'follow' });
    if (!response.ok) {
      attempts.push(`${variant.name}:HTTP_${response.status}`);
      diagnostics.push({ variant: variant.name, status: 'http_error', httpStatus: response.status });
      continue;
    }

    const html = await response.text();
    if (detectGoogleBlock(html)) {
      detectedBlocking = true;
      attempts.push(`${variant.name}:BLOCKED`);
      diagnostics.push({ variant: variant.name, status: 'blocked', htmlLength: html.length });
      continue;
    }

    resultUrls = extractGoogleResultUrls(html);
    diagnostics.push({
      variant: variant.name,
      status: 'ok',
      htmlLength: html.length,
      extractedUrlCount: resultUrls.length
    });
    attempts.push(`${variant.name}:${resultUrls.length}`);
    if (resultUrls.length > 0) break;
  }

  if (resultUrls.length === 0 && detectedBlocking) {
    throw new Error('Google memblokir permintaan otomatis (captcha/unusual traffic). Coba lagi dari IP berbeda atau kurangi frekuensi request.');
  }

  const uniqueUrls = [...new Set(resultUrls)];
  if (uniqueUrls.length === 0) {
    return { links: [], attempts, totalDiscovered: 0, diagnostics };
  }

  if (!fileType) {
    return { links: uniqueUrls.slice(0, maxResults), attempts, totalDiscovered: uniqueUrls.length, diagnostics };
  }

  const matched = uniqueUrls.filter((url) => matchesFileType(url, fileType));
  const remaining = uniqueUrls.filter((url) => !matchesFileType(url, fileType));
  return {
    links: [...matched, ...remaining].slice(0, maxResults),
    attempts,
    totalDiscovered: uniqueUrls.length,
    diagnostics
  };
}

function summarizeGoogleDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return 'Tidak ada data diagnostik pengambilan URL dari Google.';
  }

  return diagnostics
    .map((item) => {
      const details = [
        `varian=${item.variant || '-'}`,
        `status=${item.status || '-'}`,
        `http=${item.httpStatus || '-'}`,
        `html=${item.htmlLength || 0}`,
        `url=${item.extractedUrlCount || 0}`
      ];
      return `- ${details.join(', ')}`;
    })
    .join('\n');
}

async function fetchUrlBody(url) {
  const response = await fetch(url, { headers: { 'User-Agent': GOOGLE_HEADERS['User-Agent'] } });
  if (!response.ok) {
    throw new Error(`Download file gagal (HTTP ${response.status}).`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

function parseExcelRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils
    .sheet_to_json(worksheet, { header: 1, blankrows: false, raw: false })
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim()))
    .slice(0, 500);
}

function extractTextFromBuffer({ buffer, contentType, sourceUrl }) {
  const lowercaseUrl = String(sourceUrl || '').toLowerCase();

  if (/\.xlsx?(\?|$)/i.test(lowercaseUrl) || contentType.includes('spreadsheet') || contentType.includes('excel')) {
    const rows = parseExcelRows(buffer);
    return rows.map((row) => row.map((cell) => String(cell || '').trim()).filter(Boolean).join(' | ')).filter(Boolean);
  }

  if (/\.csv(\?|$)/i.test(lowercaseUrl) || contentType.includes('text/csv')) {
    return String(buffer.toString('utf8') || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 500);
  }

  if (
    contentType.includes('text/plain') ||
    contentType.includes('application/json') ||
    contentType.includes('application/xml') ||
    contentType.includes('text/xml') ||
    contentType.includes('text/html') ||
    /\.(txt|json|xml|html?|md|log)(\?|$)/i.test(lowercaseUrl)
  ) {
    const normalized = buffer
      .toString('utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return [];

    return normalized
      .split(/(?<=[.!?])\s+|\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 500);
  }

  return [];
}

function normalizeCell(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRelevantRows({ rows, keyword, target, sourceUrl }) {
  const terms = [keyword, target].map((item) => String(item || '').toLowerCase()).filter(Boolean);
  const extracted = [];

  for (const rowText of rows) {
    const text = normalizeCell(rowText);
    if (!text) continue;

    const lowercaseText = text.toLowerCase();
    const isRelevant = terms.some((term) => lowercaseText.includes(term));
    if (!isRelevant) continue;

    extracted.push({ sourceUrl, text });
    if (extracted.length >= 10) break;
  }

  return extracted;
}

function formatProfessionalReport({ query, searchUrl, links, extractedRows, fileType, maxResults, totalDiscovered, diagnostics }) {
  const lines = [
    'Laporan Google Dork',
    `Query: ${query}`,
    `URL: ${searchUrl}`,
    '',
    `Filter file: ${fileType || 'tanpa filter filetype'}`,
    `Jumlah URL didapat dari Google: ${totalDiscovered}`,
    `Jumlah URL yang diproses: ${links.length} (maks konfigurasi: ${maxResults})`,
    'Daftar URL hasil pencarian:'
  ];

  if (links.length === 0) {
    lines.push('- Tidak ada URL hasil yang bisa diekstrak dari Google.');
  } else {
    lines.push(...links.map((link, index) => `${index + 1}. ${link}`));
  }

  lines.push('', 'Data relevan (gabungan hasil):');

  if (extractedRows.length === 0) {
    lines.push('- Tidak ditemukan baris relevan dari URL yang berhasil diunduh/diolah.');
  } else {
    extractedRows.forEach((item, index) => {
      lines.push(`${index + 1}. [Sumber] ${item.sourceUrl}`);
      lines.push(`   [Konten] ${item.text}`);
    });
  }

  lines.push('', 'Diagnostik proses Google:');
  lines.push(summarizeGoogleDiagnostics(diagnostics));

  lines.push('', 'Catatan: hanya baris yang relevan dengan keyword/target yang ditampilkan.');
  return lines.join('\n');
}

async function runGoogleDork({ keyword: rawKeyword, target: rawTarget, domain: rawDomain, fileType: rawFileType }) {
  const processLog = [];
  const logStep = (message, metadata) => {
    const timestamp = new Date().toISOString();
    const serializedMetadata = metadata ? ` | data=${JSON.stringify(metadata)}` : '';
    const line = `[${timestamp}] ${message}${serializedMetadata}`;
    processLog.push(line);
    // eslint-disable-next-line no-console
    console.info(`[GoogleDork] ${line}`);
  };

  logStep('Memulai proses Google Dork.');
  const keyword = sanitizeKeyword(rawKeyword);
  const target = sanitizeTarget(rawTarget);
  const domain = sanitizeDomain(rawDomain);
  const fileType = sanitizeFileType(rawFileType);
  const maxResults = Math.max(1, Number(env.GOOGLE_DORK_MAX_RESULTS) || 20);
  logStep('Validasi parameter selesai (keyword, target, domain, tipe dokumen).');

  const queryParts = [];
  if (domain) {
    queryParts.push(`site:${domain}`);
  }
  if (target) {
    queryParts.push(`intitle:"${target}"`);
  }
  queryParts.push(`"${keyword}"`);
  if (fileType) {
    queryParts.push(`filetype:${fileType}`);
  }
  const query = queryParts.join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  logStep(`Query berhasil dibentuk: ${query}`);

  logStep('Mengambil URL hasil dari Google Search.');
  const { links, attempts, totalDiscovered, diagnostics } = await fetchGoogleResultUrls(query, fileType, maxResults);
  logStep(`Strategi ekstraksi URL Google: ${attempts.join(', ') || '-'}`);
  logStep(`Ditemukan ${totalDiscovered} URL dari Google, ${links.length} URL dipilih untuk diproses.`, {
    attempts,
    diagnostics
  });

  const extractedRows = [];
  for (const url of links) {
    logStep(`Mengunduh URL: ${url}`);
    try {
      const { buffer, contentType } = await fetchUrlBody(url);
      const rows = extractTextFromBuffer({ buffer, contentType, sourceUrl: url });
      logStep(`Ekstraksi konten selesai (${rows.length} baris kandidat, content-type: ${contentType || '-'})`, {
        url,
        rows: rows.length,
        contentType: contentType || '-'
      });
      const relevantRows = buildRelevantRows({ rows, keyword, target, sourceUrl: url });
      extractedRows.push(...relevantRows);
      logStep(`Filter relevansi selesai (${relevantRows.length} baris relevan).`, {
        url,
        relevantRows: relevantRows.length
      });
    } catch (error) {
      logStep(`Gagal memproses URL: ${error?.message || 'unknown error'}`, { url });
    }
  }

  logStep(`Proses selesai. Total temuan relevan: ${extractedRows.length}.`);

  return {
    keyword,
    target,
    domain,
    fileType,
    query,
    searchUrl,
    totalDiscovered,
    links,
    diagnostics,
    processLog,
    output: formatProfessionalReport({ query, searchUrl, links, extractedRows, fileType, maxResults, totalDiscovered, diagnostics })
  };
}

module.exports = {
  runGoogleDork,
  DOCUMENT_TYPES,
  __testables: { extractGoogleResultUrls, detectGoogleBlock, matchesFileType, summarizeGoogleDiagnostics }
};
