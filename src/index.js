const fs = require('fs/promises');
const { execFile } = require('child_process');
const { env } = require('./config/env');
const { splitCmd } = require('./services/sherlock');
const { startWhatsAppClient } = require('./whatsapp/client');

async function verifySherlockCommand() {
  const { bin, args } = splitCmd(env.SHERLOCK_CMD);

  await new Promise((resolve, reject) => {
    execFile(bin, [...args, '--version'], { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        const details = `${stdout || ''}\n${stderr || ''}`.trim() || error.message;
        reject(new Error(details));
        return;
      }

      resolve();
    });
  });
}

async function bootstrap() {
  await fs.mkdir(env.SHERLOCK_WORKDIR, { recursive: true });

  try {
    await verifySherlockCommand();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Sherlock preflight gagal. Jalankan ./scripts/setup_sherlock.sh lalu restart service. Root cause:', error);
    throw new Error('Sherlock command tidak siap. Jalankan ./scripts/setup_sherlock.sh lalu restart service.');
  }

  await startWhatsAppClient();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
