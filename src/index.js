const fs = require('fs/promises');
const { env } = require('./config/env');
const { startWhatsAppClient } = require('./whatsapp/client');

async function bootstrap() {
  await fs.mkdir(env.SHERLOCK_WORKDIR, { recursive: true });
  await startWhatsAppClient();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
