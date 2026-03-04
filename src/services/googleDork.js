const { env } = require('../config/env');

const DOCUMENT_TYPES = env.GOOGLE_DORK_DOC_TYPES;

function sanitizeKeyword(input) {
  const keyword = String(input || '').trim();
  if (!keyword) {
    throw new Error('Keyword kosong. Gunakan: !dorkdoc <keyword> <target> <domain> <tipe_dokumen>');
  }
  if (keyword.length > 120) {
    throw new Error('Keyword terlalu panjang. Maksimal 120 karakter.');
  }
  return keyword;
}

function sanitizeTarget(input) {
  const target = String(input || '').trim();
  if (!target) {
    throw new Error('Target kosong. Gunakan: !dorkdoc <keyword> <target> <domain> <tipe_dokumen>');
  }
  if (target.length > 120) {
    throw new Error('Target terlalu panjang. Maksimal 120 karakter.');
  }
  return target;
}

function sanitizeDomain(input) {
  const domain = String(input || '').trim().toLowerCase();
  if (!domain && env.GOOGLE_DORK_DEFAULT_SITE) {
    return env.GOOGLE_DORK_DEFAULT_SITE;
  }
  if (!domain) {
    throw new Error('Domain kosong. Gunakan: !dorkdoc <keyword> <target> <domain|-> <tipe_dokumen>');
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error('Format domain tidak valid. Contoh: example.com');
  }
  return domain;
}

function sanitizeFileType(input) {
  const fileType = String(input || '').trim().toLowerCase().replace(/^\./, '');
  if (!fileType) {
    throw new Error('Tipe dokumen kosong. Gunakan: !dorkdoc <keyword> <target> <domain> <tipe_dokumen>');
  }
  if (!DOCUMENT_TYPES.includes(fileType)) {
    throw new Error(`Tipe dokumen tidak didukung. Pilihan: ${DOCUMENT_TYPES.join(', ')}`);
  }
  return fileType;
}

function runGoogleDork({ keyword: rawKeyword, target: rawTarget, domain: rawDomain, fileType: rawFileType }) {
  const keyword = sanitizeKeyword(rawKeyword);
  const target = sanitizeTarget(rawTarget);
  const domain = sanitizeDomain(rawDomain);
  const fileType = sanitizeFileType(rawFileType);

  const siteDomain = domain || env.GOOGLE_DORK_DEFAULT_SITE;
  const query = `site:${siteDomain} intitle:"${target}" "${keyword}" filetype:${fileType}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  return {
    keyword,
    target,
    domain,
    fileType,
    query,
    searchUrl,
    output: [
      `Query: ${query}`,
      `URL: ${searchUrl}`,
      'Catatan: hasil dapat berbeda sesuai lokasi, language, dan kebijakan Google Search.'
    ].join('\n')
  };
}

module.exports = { runGoogleDork, DOCUMENT_TYPES };
