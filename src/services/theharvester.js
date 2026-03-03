const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { env } = require('../config/env');
const { splitCmd } = require('./sherlock');

const DOMAIN_MAX_LENGTH = 253;
const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function sanitizeDomain(input) {
  const domain = String(input || '').trim().toLowerCase();
  if (!domain) throw new Error('Domain kosong. Gunakan: !theharvester <domain>');
  if (domain.length > DOMAIN_MAX_LENGTH) {
    throw new Error(`Domain terlalu panjang. Maksimal ${DOMAIN_MAX_LENGTH} karakter.`);
  }
  if (!DOMAIN_REGEX.test(domain)) {
    throw new Error('Format domain tidak valid. Gunakan domain FQDN, contoh: example.com');
  }
  return domain;
}

async function ensureWorkdir() {
  await fs.mkdir(env.THEHARVESTER_WORKDIR, { recursive: true });
}

async function runTheHarvester(rawDomain) {
  const domain = sanitizeDomain(rawDomain);
  await ensureWorkdir();

  const ts = Date.now();
  const reportDir = path.join(env.THEHARVESTER_WORKDIR, `${domain.replace(/\./g, '_')}-${ts}`);
  await fs.mkdir(reportDir, { recursive: true });

  const outputFile = path.join(reportDir, `theharvester-${domain.replace(/\./g, '_')}-${ts}.txt`);
  const { bin, args } = splitCmd(env.THEHARVESTER_CMD);
  const finalArgs = [...args, '-d', domain];

  // eslint-disable-next-line no-console
  console.info('[theharvester] memulai eksekusi', { domain, bin, args: finalArgs, reportDir, outputFile });

  const output = await new Promise((resolve, reject) => {
    execFile(
      bin,
      finalArgs,
      { timeout: env.THEHARVESTER_TIMEOUT_MS, cwd: reportDir },
      async (error, stdout, stderr) => {
        const text = `${stdout || ''}\n${stderr || ''}`.trim();

        try {
          await fs.writeFile(outputFile, text || '[theharvester] tidak ada output');
        } catch (writeError) {
          // eslint-disable-next-line no-console
          console.error('[theharvester] gagal menyimpan output', {
            domain,
            outputFile,
            message: writeError.message
          });
        }

        if (error) {
          // eslint-disable-next-line no-console
          console.error('[theharvester] eksekusi gagal', {
            domain,
            message: error.message,
            output: text
          });
          reject(new Error(text || error.message));
          return;
        }

        resolve(text);
      }
    );
  });

  // eslint-disable-next-line no-console
  console.info('[theharvester] eksekusi selesai', {
    domain,
    outputChars: output.length,
    reportDir,
    outputFile
  });

  const truncated = output.slice(0, env.THEHARVESTER_MAX_OUTPUT_CHARS);
  const suffix = output.length > truncated.length ? '\n\n[output dipotong]' : '';

  return {
    target: domain,
    domain,
    output: truncated + suffix,
    outputFile,
    reportDir
  };
}

module.exports = { runTheHarvester, sanitizeDomain };
