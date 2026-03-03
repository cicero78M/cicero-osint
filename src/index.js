const fs = require('fs/promises');
const { execFile } = require('child_process');
const { env } = require('./config/env');
const { splitCmd } = require('./services/sherlock');
const { startWhatsAppClient } = require('./whatsapp/client');

async function runPreflight(bin, args, checkArgs, name) {
  return new Promise((resolve, reject) => {
    execFile(bin, [...args, ...checkArgs], { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        const details = `${stdout || ''}\n${stderr || ''}`.trim() || error.message;
        reject(new Error(`${name}: ${details}`));
        return;
      }

      resolve();
    });
  });
}

async function verifyCommand(command, name, checks) {
  const { bin, args } = splitCmd(command);
  let lastError;

  for (const checkArgs of checks) {
    try {
      await runPreflight(bin, args, checkArgs, name);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`${name}: preflight gagal`);
}

async function bootstrap() {
  await fs.mkdir(env.SHERLOCK_WORKDIR, { recursive: true });
  await fs.mkdir(env.HOLEHE_WORKDIR, { recursive: true });
  await fs.mkdir(env.MAIGRET_WORKDIR, { recursive: true });
  await fs.mkdir(env.INSTALOADER_WORKDIR, { recursive: true });
  await fs.mkdir(env.THEHARVESTER_WORKDIR, { recursive: true });

  const requiredChecks = [
    { command: env.SHERLOCK_CMD, name: 'sherlock', checks: [['--version'], ['--help']] },
    { command: env.HOLEHE_CMD, name: 'holehe', checks: [['--help']] },
    { command: env.MAIGRET_CMD, name: 'maigret', checks: [['--help']] },
    { command: env.INSTALOADER_CMD, name: 'instaloader', checks: [['--help']] },
    { command: env.THEHARVESTER_CMD, name: 'theHarvester', checks: [['--help'], ['-h']] },
    { command: env.EXIFTOOL_CMD, name: 'exiftool', checks: [['-ver']] }
  ];

  try {
    for (const tool of requiredChecks) {
      // eslint-disable-next-line no-await-in-loop
      await verifyCommand(tool.command, tool.name, tool.checks);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Preflight tool gagal. Jalankan setup dependencies lalu restart service. Root cause:', error);
    throw new Error(
      'Sherlock/Holehe/Maigret/Instaloader/theHarvester/EXIFTOOL command tidak siap. Pastikan EXIFTool terpasang (Ubuntu: apt install exiftool), lalu jalankan setup dependencies dan restart service.'
    );
  }


  await startWhatsAppClient();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
