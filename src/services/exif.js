const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { env } = require('../config/env');

function pick(data, keys) {
  for (const key of keys) {
    const value = normalizeValue(data[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '-' || /^(null|undefined)$/i.test(trimmed)) {
      return null;
    }
    return trimmed;
  }
  return value;
}

function toPrintable(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function getImageExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('gif')) return 'gif';
  return 'jpg';
}

async function writeTempImage(buffer, mimeType) {
  const ext = getImageExtension(mimeType);
  const fileName = `cicero-exif-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function runExifTool(filePath) {
  const args = ['-j', '-n', filePath];

  // eslint-disable-next-line no-console
  console.info('[exif] memulai eksekusi exiftool', {
    filePath,
    cmd: env.EXIFTOOL_CMD,
    args,
    timeoutMs: env.EXIFTOOL_TIMEOUT_MS
  });

  const output = await new Promise((resolve, reject) => {
    execFile(env.EXIFTOOL_CMD, args, { timeout: env.EXIFTOOL_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[exif] eksekusi exiftool gagal', {
          filePath,
          message: error.message,
          stderr: (stderr || '').trim(),
          stdout: (stdout || '').trim()
        });
        reject(new Error((stderr || stdout || error.message || 'ExifTool gagal dijalankan').trim()));
        return;
      }

      // eslint-disable-next-line no-console
      console.info('[exif] exiftool selesai', {
        filePath,
        stdoutChars: (stdout || '').length,
        stderrChars: (stderr || '').length
      });
      resolve(stdout || '[]');
    });
  });

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Data EXIF tidak ditemukan pada gambar.');
  }

  return parsed[0];
}

function summarizeExif(data) {
  const createDate = pick(data, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
  const fallbackDate = pick(data, ['DateCreated', 'CreationDate', 'MediaCreateDate', 'TrackCreateDate', 'FileModifyDate']);
  const device = [pick(data, ['Make']), pick(data, ['Model'])].filter(Boolean).join(' ');
  const software = pick(data, ['Software', 'ProcessingSoftware', 'CreatorTool', 'HistorySoftwareAgent']);
  const lat = pick(data, ['GPSLatitude']);
  const lon = pick(data, ['GPSLongitude']);
  const gpsPosition = pick(data, ['GPSPosition']);
  const altitude = pick(data, ['GPSAltitude']);
  const edited = Boolean(software);

  const location = lat !== null && lon !== null ? `${lat}, ${lon}` : toPrintable(gpsPosition);
  const effectiveDate = createDate || fallbackDate;

  if (!effectiveDate && !device && !software && !gpsPosition && lat === null && lon === null && altitude === null) {
    // eslint-disable-next-line no-console
    console.warn('[exif] metadata inti kosong', {
      keysFound: Object.keys(data || {}).length,
      sourceFile: data.SourceFile || '-'
    });
  }

  const lines = [
    '✅ *Ringkasan Metadata Gambar*',
    `• Tanggal metadata: ${toPrintable(effectiveDate)}`,
    `• Perangkat: ${toPrintable(device)}`,
    `• Lokasi GPS: ${location}`,
    `• Ketinggian GPS: ${toPrintable(altitude)}`,
    `• Software/Edit: ${toPrintable(software)}`,
    `• Indikasi pernah diedit: ${edited ? 'Ya' : 'Tidak terdeteksi'}`
  ];

  if (location === '-' && !effectiveDate && !device && !software) {
    lines.push('• Catatan: Metadata kemungkinan sudah terhapus karena kompresi WhatsApp. Coba kirim file sebagai *dokumen* agar metadata asli tetap terbaca.');
  }

  return lines.join('\n');
}

async function processExifFromBuffer(buffer, mimeType) {
  let tempPath;
  try {
    // eslint-disable-next-line no-console
    console.info('[exif] menerima buffer untuk diproses', {
      mimeType: mimeType || '-',
      bytes: Buffer.isBuffer(buffer) ? buffer.length : 0
    });
    tempPath = await writeTempImage(buffer, mimeType);
    const raw = await runExifTool(tempPath);
    // eslint-disable-next-line no-console
    console.info('[exif] parsing metadata selesai', {
      keysFound: Object.keys(raw || {}).length,
      sourceFile: raw?.SourceFile || '-'
    });
    return {
      summary: summarizeExif(raw),
      raw
    };
  } finally {
    if (tempPath) {
      await fs.rm(tempPath, { force: true });
    }
  }
}

module.exports = {
  processExifFromBuffer,
  getImageExtension,
  summarizeExif
};
