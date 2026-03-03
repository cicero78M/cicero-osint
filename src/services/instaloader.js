const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { env } = require('../config/env');
const { splitCmd } = require('./sherlock');

function parseInstaloaderError(output, fallbackMessage) {
  const text = String(output || '').trim();

  if (/429\s*-\s*Too Many Requests|429\s+Too Many Requests/i.test(text)) {
    const retryMatch = text.match(/retried in\s+([^\n.]+)/i);
    const retryInfo = retryMatch ? retryMatch[1].trim() : null;
    const message = retryInfo
      ? `Instagram membatasi permintaan (HTTP 429). Coba lagi dalam ${retryInfo}.`
      : 'Instagram membatasi permintaan (HTTP 429). Coba lagi beberapa saat lagi.';

    return { code: 'RATE_LIMITED', message, rawOutput: text };
  }

  return {
    code: 'EXEC_FAILED',
    message: text || fallbackMessage,
    rawOutput: text
  };
}

function sanitizeUsername(input) {
  const username = String(input || '').trim();
  if (!username) throw new Error('Username kosong. Gunakan: !instaloader <username>');
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
    throw new Error('Format username Instagram tidak valid. Hanya huruf, angka, underscore, dan titik.');
  }
  return username;
}

async function ensureWorkdir() {
  await fs.mkdir(env.INSTALOADER_WORKDIR, { recursive: true });
}

async function runInstaloader(rawUsername) {
  const username = sanitizeUsername(rawUsername);
  await ensureWorkdir();

  const ts = Date.now();
  const reportDir = path.join(env.INSTALOADER_WORKDIR, `${username}-${ts}`);
  await fs.mkdir(reportDir, { recursive: true });

  const outputFile = path.join(reportDir, `instaloader-${username}-${ts}.txt`);
  const { bin, args } = splitCmd(env.INSTALOADER_CMD);
  const resolvedBin = path.isAbsolute(bin) ? bin : path.resolve(process.cwd(), bin);
  const finalArgs = [
    ...args,
    '--no-pictures',
    '--no-videos',
    '--no-video-thumbnails',
    '--',
    username
  ];

  // eslint-disable-next-line no-console
  console.info('[instaloader] memulai eksekusi', {
    username,
    bin: resolvedBin,
    args: finalArgs,
    reportDir,
    outputFile
  });

  const output = await new Promise((resolve, reject) => {
    execFile(
      resolvedBin,
      finalArgs,
      { timeout: env.INSTALOADER_TIMEOUT_MS, cwd: reportDir },
      async (error, stdout, stderr) => {
        const text = `${stdout || ''}\n${stderr || ''}`.trim();

        try {
          await fs.writeFile(outputFile, text || '[instaloader] tidak ada output');
        } catch (writeError) {
          // eslint-disable-next-line no-console
          console.error('[instaloader] gagal menyimpan output', {
            username,
            outputFile,
            message: writeError.message
          });
        }

        if (error) {
          const parsedError = parseInstaloaderError(text, error.message);
          // eslint-disable-next-line no-console
          console.error('[instaloader] eksekusi gagal', {
            username,
            code: parsedError.code,
            message: parsedError.message,
            output: parsedError.rawOutput
          });

          const wrappedError = new Error(parsedError.message);
          wrappedError.code = parsedError.code;
          wrappedError.rawOutput = parsedError.rawOutput;
          reject(wrappedError);
          return;
        }

        resolve(text);
      }
    );
  });

  // eslint-disable-next-line no-console
  console.info('[instaloader] eksekusi selesai', {
    username,
    outputChars: output.length,
    reportDir,
    outputFile
  });

  const truncated = output.slice(0, env.INSTALOADER_MAX_OUTPUT_CHARS);
  const suffix = output.length > truncated.length ? '\n\n[output dipotong]' : '';

  return {
    username,
    output: truncated + suffix,
    outputFile,
    reportDir
  };
}

module.exports = { runInstaloader, sanitizeUsername, parseInstaloaderError };
