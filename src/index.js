const fs = require('fs/promises');
const { execFile } = require('child_process');
const { env } = require('./config/env');
const { splitCmd } = require('./services/sherlock');
const { startWhatsAppClient } = require('./whatsapp/client');

async function verifyCommand(command, name) {
  const { bin, args } = splitCmd(command);

  await new Promise((resolve, reject) => {
    execFile(bin, [...args, '--version'], { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        const details = `${stdout || ''}\n${stderr || ''}`.trim() || error.message;
        reject(new Error(`${name}: ${details}`));
        return;
      }

      resolve();
    });
  });
}

async function bootstrap() {
  await fs.mkdir(env.SHERLOCK_WORKDIR, { recursive: true });
  await fs.mkdir(env.HOLEHE_WORKDIR, { recursive: true });

  try {
    await verifyCommand(env.SHERLOCK_CMD, 'sherlock');
    await verifyCommand(env.HOLEHE_CMD, 'holehe');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Preflight tool gagal. Jalankan setup dependencies lalu restart service. Root cause:', error);
    throw new Error('Sherlock/Holehe command tidak siap. Jalankan setup dependencies lalu restart service.');
  }

  await startWhatsAppClient();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
