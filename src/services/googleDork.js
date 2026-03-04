const { env } = require('../config/env');
const XLSX = require('xlsx');

const DOCUMENT_TYPES = env.GOOGLE_DORK_DOC_TYPES;
const EXCEL_TYPES = ['xls', 'xlsx'];
const GOOGLE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

function sanitizeKeyword(input) {
  const keyword = String(input || '').trim();
  if (!keyword) {
    throw new Error('Keyword kosong. Gunakan: !dorkdoc <keyword> atau !dorkdoc <keyword> <target|-> <domain|-> <tipe_dokumen>');
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
  const regex = /<a\s+href="\/url\?q=([^"&]+)[^"]*"/g;
  let match = regex.exec(html);

  while (match) {
    const raw = decodeURIComponent(match[1]);
    if (/^https?:\/\//i.test(raw) && !raw.includes('google.com')) {
      links.push(raw);
    }
    match = regex.exec(html);
  }

  return [...new Set(links)];
}

async function fetchGoogleTopResultUrls(query, fileType) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=id`;
  const response = await fetch(searchUrl, { headers: GOOGLE_HEADERS });

  if (!response.ok) {
    throw new Error(`Google Search gagal diakses (HTTP ${response.status}).`);
  }

  const html = await response.text();
  const resultUrls = extractGoogleResultUrls(html);
  if (!fileType) {
    return resultUrls.slice(0, 3);
  }

  const matched = resultUrls.filter((url) => matchesFileType(url, fileType));
  const remaining = resultUrls.filter((url) => !matchesFileType(url, fileType));
  return [...matched, ...remaining].slice(0, 3);
}

async function fetchExcelAsRows(url) {
  const response = await fetch(url, { headers: { 'User-Agent': GOOGLE_HEADERS['User-Agent'] } });
  if (!response.ok) {
    throw new Error(`Download file gagal (HTTP ${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, raw: false });

  return rows
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim()))
    .slice(0, 200);
}

function normalizeCell(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRelevantRows({ rows, keyword, target, sourceUrl }) {
  const terms = [keyword, target].map((item) => String(item || '').toLowerCase()).filter(Boolean);

  const extracted = [];

  for (const row of rows) {
    const cells = row.map(normalizeCell).filter(Boolean);
    if (cells.length === 0) continue;

    const text = cells.join(' | ');
    const lowercaseText = text.toLowerCase();
    const isRelevant = terms.some((term) => lowercaseText.includes(term));
    if (!isRelevant) continue;

    extracted.push({ sourceUrl, text });
    if (extracted.length >= 6) break;
  }

  return extracted;
}

function formatProfessionalReport({ query, searchUrl, links, extractedRows, fileType }) {
  const lines = [
    'Laporan Google Dork',
    `Query: ${query}`,
    `URL: ${searchUrl}`,
    '',
    `Filter file: ${fileType || 'tanpa filter filetype'}`,
    'Top 3 hasil URL hasil pencarian:'
  ];

  if (links.length === 0) {
    lines.push('- Tidak ada URL hasil yang bisa diekstrak dari Google.');
  } else {
    lines.push(...links.map((link, index) => `${index + 1}. ${link}`));
  }

  lines.push('', 'Data relevan (gabungan hasil):');

  if (extractedRows.length === 0) {
    lines.push('- Tidak ada analisis konten tambahan untuk hasil ini (otomatis hanya untuk file xls/xlsx).');
  } else {
    extractedRows.forEach((item, index) => {
      lines.push(`${index + 1}. [Sumber] ${item.sourceUrl}`);
      lines.push(`   [Konten] ${item.text}`);
    });
  }

  lines.push('', 'Catatan: hanya baris yang relevan dengan keyword/target yang ditampilkan.');
  return lines.join('\n');
}

async function runGoogleDork({ keyword: rawKeyword, target: rawTarget, domain: rawDomain, fileType: rawFileType }) {
  const processLog = [];
  const logStep = (message) => {
    processLog.push(`[${new Date().toISOString()}] ${message}`);
  };

  logStep('Memulai proses Google Dork.');
  const keyword = sanitizeKeyword(rawKeyword);
  const target = sanitizeTarget(rawTarget);
  const domain = sanitizeDomain(rawDomain);
  const fileType = sanitizeFileType(rawFileType);
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

  logStep('Mengambil hasil teratas dari Google Search.');
  const links = await fetchGoogleTopResultUrls(query, fileType);
  logStep(`Ditemukan ${links.length} URL hasil untuk diproses.`);

  const extractedRows = [];
  const canAnalyzeExcel = !fileType || EXCEL_TYPES.includes(fileType);
  for (const url of links) {
    const isExcelUrl = /\.xlsx?(\?|$)/i.test(url);
    if (!canAnalyzeExcel || !isExcelUrl) {
      logStep(`Lewati analisis konten (bukan file excel): ${url}`);
      continue;
    }

    logStep(`Mengunduh & mengekstrak file excel: ${url}`);
    try {
      const rows = await fetchExcelAsRows(url);
      const relevantRows = buildRelevantRows({ rows, keyword, target, sourceUrl: url });
      extractedRows.push(...relevantRows);
      logStep(`Sukses memproses file (${rows.length} baris, ${relevantRows.length} baris relevan).`);
    } catch (error) {
      logStep(`Gagal memproses file: ${error?.message || 'unknown error'}`);
      extractedRows.push({
        sourceUrl: url,
        text: `Gagal mengolah file excel: ${error?.message || 'unknown error'}`
      });
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
    links,
    processLog,
    output: formatProfessionalReport({ query, searchUrl, links, extractedRows, fileType })
  };
}

module.exports = { runGoogleDork, DOCUMENT_TYPES };
