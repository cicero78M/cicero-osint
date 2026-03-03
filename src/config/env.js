const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().default('production'),
  BOT_PREFIX: z.string().default('!'),
  SESSION_DIR: z.string().default('./session'),
  SHERLOCK_CMD: z.string().default('python3 -m sherlock'),
  SHERLOCK_WORKDIR: z.string().default('./runtime'),
  SHERLOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  SHERLOCK_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  WHATSAPP_SEND_QR_TO_TERMINAL: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  WHATSAPP_OWNER_JID: z.string().optional()
});

const env = schema.parse(process.env);

env.SESSION_DIR = path.resolve(process.cwd(), env.SESSION_DIR);
env.SHERLOCK_WORKDIR = path.resolve(process.cwd(), env.SHERLOCK_WORKDIR);

module.exports = { env };
