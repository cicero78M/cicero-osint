const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().default('production'),
  BOT_PREFIX: z.string().default('!'),
  SESSION_DIR: z.string().default('./session'),
  SHERLOCK_CMD: z.string().default('./.venv/bin/sherlock'),
  SHERLOCK_WORKDIR: z.string().default('./runtime'),
  SHERLOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  SHERLOCK_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  HOLEHE_CMD: z.string().default('./.venv/bin/holehe'),
  HOLEHE_WORKDIR: z.string().default('./runtime/holehe'),
  HOLEHE_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  HOLEHE_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  MAIGRET_CMD: z.string().default('./.venv/bin/maigret'),
  MAIGRET_WORKDIR: z.string().default('./runtime/maigret'),
  MAIGRET_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  MAIGRET_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  EXIFTOOL_CMD: z.string().default('exiftool'),
  EXIFTOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  WHATSAPP_SEND_QR_TO_TERMINAL: z
    .string()
    .default('true')
    .transform((v) => v === 'true')
});

const env = schema.parse(process.env);

env.SESSION_DIR = path.resolve(process.cwd(), env.SESSION_DIR);
env.SHERLOCK_WORKDIR = path.resolve(process.cwd(), env.SHERLOCK_WORKDIR);
env.HOLEHE_WORKDIR = path.resolve(process.cwd(), env.HOLEHE_WORKDIR);
env.MAIGRET_WORKDIR = path.resolve(process.cwd(), env.MAIGRET_WORKDIR);

module.exports = { env };
