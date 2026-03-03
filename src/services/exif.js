const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { env } = require('../config/env');

function pick(data, keys) {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      return data[key];
    }
  }
  return null;
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

  const output = await new Promise((resolve, reject) => {
    execFile(env.EXIFTOOL_CMD, args, { timeout: env.EXIFTOOL_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message || 'ExifTool gagal dijalankan').trim()));
        return;
      }
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
  const device = [pick(data, ['Make']), pick(data, ['Model'])].filter(Boolean).join(' ');
  const software = pick(data, ['Software', 'ProcessingSoftware', 'CreatorTool', 'HistorySoftwareAgent']);
  const lat = pick(data, ['GPSLatitude']);
  const lon = pick(data, ['GPSLongitude']);
  const altitude = pick(data, ['GPSAltitude']);
  const edited = Boolean(software);

  const lines = [
    '✅ *Ringkasan Metadata Gambar*',
    `• Tanggal metadata: ${toPrintable(createDate)}`,
    `• Perangkat: ${toPrintable(device)}`,
    `• Lokasi GPS: ${lat !== null && lon !== null ? `${lat}, ${lon}` : '-'}`,
    `• Ketinggian GPS: ${toPrintable(altitude)}`,
    `• Software/Edit: ${toPrintable(software)}`,
    `• Indikasi pernah diedit: ${edited ? 'Ya' : 'Tidak terdeteksi'}`
  ];

  return lines.join('\n');
}

async function processExifFromBuffer(buffer, mimeType) {
  let tempPath;
  try {
    tempPath = await writeTempImage(buffer, mimeType);
    const raw = await runExifTool(tempPath);
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
