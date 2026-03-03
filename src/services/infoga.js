const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { env } = require('../config/env');
const { splitCmd } = require('./sherlock');
const { sanitizeDomain } = require('./theharvester');

function sanitizeEmail(input) {
  const email = String(input || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Target kosong. Gunakan: !infoga <email|domain>');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Format email tidak valid. Gunakan email yang benar.');
  }
  return email;
}

function sanitizeInfogaTarget(input) {
  const rawTarget = String(input || '').trim();
  if (!rawTarget) {
    throw new Error('Target kosong. Gunakan: !infoga <email|domain>');
  }

  if (rawTarget.includes('@')) {
    return { mode: 'email', target: sanitizeEmail(rawTarget) };
  }

  return { mode: 'domain', target: sanitizeDomain(rawTarget) };
}

async function ensureWorkdir() {
  await fs.mkdir(env.INFOGA_WORKDIR, { recursive: true });
}

async function runInfoga(rawTarget) {
  const { mode, target } = sanitizeInfogaTarget(rawTarget);
  await ensureWorkdir();

  const ts = Date.now();
  const normalizedTarget = target.replace(/[^a-z0-9]/gi, '_');
  const outputFile = path.join(env.INFOGA_WORKDIR, `infoga-${mode}-${normalizedTarget}-${ts}.txt`);

  const { bin, args } = splitCmd(env.INFOGA_CMD);
  const finalArgs = [...args, target];

  // eslint-disable-next-line no-console
  console.info('[infoga] memulai eksekusi', { mode, target, bin, args: finalArgs, outputFile });

  const output = await new Promise((resolve, reject) => {
    execFile(bin, finalArgs, { timeout: env.INFOGA_TIMEOUT_MS }, async (error, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`.trim();

      try {
        await fs.writeFile(outputFile, text || '[infoga] tidak ada output');
      } catch (writeError) {
        // eslint-disable-next-line no-console
        console.error('[infoga] gagal menyimpan output', {
          mode,
          target,
          outputFile,
          message: writeError.message
        });
      }

      if (error) {
        if (
          text.includes('membutuhkan interpreter Python 2') ||
          text.includes('python2/python2.7')
        ) {
          resolve({
            text,
            unavailable: true
          });
          return;
        }

        // eslint-disable-next-line no-console
        console.error('[infoga] eksekusi gagal', {
          mode,
          target,
          message: error.message,
          output: text
        });
        reject(new Error(text || error.message));
        return;
      }

      resolve({
        text,
        unavailable: false
      });
    });
  });

  // eslint-disable-next-line no-console
  console.info('[infoga] eksekusi selesai', {
    mode,
    target,
    outputChars: output.text.length,
    outputFile
  });

  const truncated = output.text.slice(0, env.INFOGA_MAX_OUTPUT_CHARS);
  const suffix = output.text.length > truncated.length ? '\n\n[output dipotong]' : '';

  return {
    mode,
    target,
    unavailable: output.unavailable,
    output: truncated + suffix,
    outputFile
  };
}

module.exports = { runInfoga, sanitizeInfogaTarget, sanitizeEmail };
