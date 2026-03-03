const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { env } = require('../config/env');
const { splitCmd } = require('./sherlock');

function sanitizeEmail(input) {
  const email = String(input || '').trim().toLowerCase();
  if (!email) throw new Error('Email kosong. Gunakan: !holehe <email>');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Format email tidak valid. Gunakan email yang benar.');
  }
  return email;
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
    return 'Tidak ditemukan indikasi email tertaut ([+]).';
  }

  return positiveLines.join('\n');
}

async function ensureWorkdir() {
  await fs.mkdir(env.HOLEHE_WORKDIR, { recursive: true });
}

async function runHolehe(rawEmail) {
  const email = sanitizeEmail(rawEmail);
  await ensureWorkdir();

  const ts = Date.now();
  const outputFile = path.join(env.HOLEHE_WORKDIR, `holehe-${email.replace(/[^a-z0-9]/gi, '_')}-${ts}.txt`);

  const { bin, args } = splitCmd(env.HOLEHE_CMD);
  const finalArgs = [...args, email];

  // eslint-disable-next-line no-console
  console.info('[holehe] memulai eksekusi', { email, bin, args: finalArgs, outputFile });

  const output = await new Promise((resolve, reject) => {
    execFile(bin, finalArgs, { timeout: env.HOLEHE_TIMEOUT_MS }, async (error, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`.trim();

      try {
        await fs.writeFile(outputFile, text || '[holehe] tidak ada output');
      } catch (writeError) {
        // eslint-disable-next-line no-console
        console.error('[holehe] gagal menyimpan output', {
          email,
          outputFile,
          message: writeError.message
        });
      }

      if (error) {
        // eslint-disable-next-line no-console
        console.error('[holehe] eksekusi gagal', {
          email,
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
  console.info('[holehe] eksekusi selesai', {
    email,
    outputChars: output.length,
    outputFile
  });

  const filteredOutput = extractPositiveFindings(output);
  const truncated = filteredOutput.slice(0, env.HOLEHE_MAX_OUTPUT_CHARS);
  const suffix = filteredOutput.length > truncated.length ? '\n\n[output dipotong]' : '';

  return {
    email,
    output: truncated + suffix,
    outputFile
  };
}

module.exports = { runHolehe, sanitizeEmail, extractPositiveFindings };
