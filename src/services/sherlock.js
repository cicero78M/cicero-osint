const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { env } = require('../config/env');

function splitCmd(cmd) {
  const parts = cmd.trim().split(/\s+/);
  return { bin: parts[0], args: parts.slice(1) };
}

async function ensureWorkdir() {
  await fs.mkdir(env.SHERLOCK_WORKDIR, { recursive: true });
}

function sanitizeUsername(input) {
  const username = String(input || '').trim();
  if (!username) throw new Error('Username kosong. Gunakan: !sherlock <username>');
  if (!/^[a-zA-Z0-9_.-]{1,50}$/.test(username)) {
    throw new Error('Format username tidak valid. Hanya huruf, angka, underscore, titik, dan strip.');
  }
  return username;
}

async function runSherlock(rawUsername) {
  const username = sanitizeUsername(rawUsername);
  await ensureWorkdir();

  const ts = Date.now();
  const targetDir = path.join(env.SHERLOCK_WORKDIR, `${username}-${ts}`);
  await fs.mkdir(targetDir, { recursive: true });

  const { bin, args } = splitCmd(env.SHERLOCK_CMD);
  const finalArgs = [...args, username, '--print-found', '--folderoutput', targetDir];

  const output = await new Promise((resolve, reject) => {
    execFile(bin, finalArgs, { timeout: env.SHERLOCK_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const text = `${stdout || ''}\n${stderr || ''}`.trim();
        reject(new Error(text || error.message));
        return;
      }

      resolve(`${stdout || ''}\n${stderr || ''}`.trim());
    });
  });

  const truncated = output.slice(0, env.SHERLOCK_MAX_OUTPUT_CHARS);
  const suffix = output.length > truncated.length ? '\n\n[output dipotong]' : '';

  return {
    username,
    output: truncated + suffix,
    reportDir: targetDir
  };
}

module.exports = { runSherlock };
