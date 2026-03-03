const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { env } = require('../config/env');
const { splitCmd } = require('./sherlock');

function sanitizeUsername(input) {
  const username = String(input || '').trim();
  if (!username) throw new Error('Username kosong. Gunakan: !maigret <username>');
  if (!/^[a-zA-Z0-9_.-]{1,50}$/.test(username)) {
    throw new Error('Format username tidak valid. Hanya huruf, angka, underscore, titik, dan strip.');
  }
  return username;
}

function extractPositiveFindings(rawOutput) {
  const normalized = String(rawOutput || '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '\n');

  const positiveLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\[\+\]\s+/.test(line));

  if (!positiveLines.length) {
    return 'Tidak ditemukan akun tertaut ([+]).';
  }

  return positiveLines.join('\n');
}

async function ensureWorkdir() {
  await fs.mkdir(env.MAIGRET_WORKDIR, { recursive: true });
}

async function runMaigret(rawUsername) {
  const username = sanitizeUsername(rawUsername);
  await ensureWorkdir();

  const ts = Date.now();
  const outputFile = path.join(env.MAIGRET_WORKDIR, `maigret-${username}-${ts}.txt`);

  const { bin, args } = splitCmd(env.MAIGRET_CMD);
  const finalArgs = [...args, username];

  // eslint-disable-next-line no-console
  console.info('[maigret] memulai eksekusi', { username, bin, args: finalArgs, outputFile });

  const output = await new Promise((resolve, reject) => {
    execFile(bin, finalArgs, { timeout: env.MAIGRET_TIMEOUT_MS }, async (error, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`.trim();

      try {
        await fs.writeFile(outputFile, text || '[maigret] tidak ada output');
      } catch (writeError) {
        // eslint-disable-next-line no-console
        console.error('[maigret] gagal menyimpan output', {
          username,
          outputFile,
          message: writeError.message
        });
      }

      if (error) {
        // eslint-disable-next-line no-console
        console.error('[maigret] eksekusi gagal', {
          username,
          message: error.message,
          output: text
        });
        reject(new Error(text || error.message));
        return;
      }

      resolve(text);
    });
  });

  // eslint-disable-next-line no-console
  console.info('[maigret] eksekusi selesai', {
    username,
    outputChars: output.length,
    outputFile
  });

  const filteredOutput = extractPositiveFindings(output);
  const truncated = filteredOutput.slice(0, env.MAIGRET_MAX_OUTPUT_CHARS);
  const suffix = filteredOutput.length > truncated.length ? '\n\n[output dipotong]' : '';

  return {
    username,
    output: truncated + suffix,
    outputFile
  };
}

module.exports = { runMaigret, sanitizeUsername, extractPositiveFindings };
