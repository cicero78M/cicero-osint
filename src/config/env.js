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
  INSTALOADER_CMD: z.string().default('./.venv/bin/instaloader'),
  INSTALOADER_WORKDIR: z.string().default('./runtime/instaloader'),
  INSTALOADER_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  INSTALOADER_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  THEHARVESTER_CMD: z.string().default('./.venv/bin/theHarvester'),
  THEHARVESTER_WORKDIR: z.string().default('./runtime/theharvester'),
  THEHARVESTER_SOURCES: z.string().default('crtsh,bing,duckduckgo,yahoo'),
  THEHARVESTER_LIMIT: z.coerce.number().int().positive().default(500),
  THEHARVESTER_DNS_BRUTE: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  THEHARVESTER_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  THEHARVESTER_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  EXIFTOOL_CMD: z.string().default('exiftool'),
  EXIFTOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  EXIF_CONFIRMATION_TTL_MS: z.coerce.number().int().positive().default(300000),
  GOOGLE_DORK_DOC_TYPES: z.string().default('pdf,doc,docx,xls,xlsx,ppt,pptx'),
  MINI_MALTEGO_WORKDIR: z.string().default('./runtime/mini-maltego'),
  MINI_MALTEGO_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  MINI_MALTEGO_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(3500),
  MINI_MALTEGO_USER_AGENT: z.string().default('mini-maltego-osint/1.0'),
  MINI_MALTEGO_SOCIAL_SITES: z.string().default('[{"name":"GitHub","url_template":"https://github.com/{username}"},{"name":"Instagram","url_template":"https://www.instagram.com/{username}/"},{"name":"TikTok","url_template":"https://www.tiktok.com/@{username}"},{"name":"X","url_template":"https://x.com/{username}"},{"name":"YouTube","url_template":"https://www.youtube.com/@{username}"}]'),
  GOOGLE_DORK_DEFAULT_SITE: z.string().default(''),
  GOOGLE_DORK_MAX_RESULTS: z.coerce.number().int().positive().default(20),

  X_BEARER_TOKEN: z.string().default(''),
  PG_URL: z.string().default(''),
  X_ISSUE_HUNTER_WORKDIR: z.string().default('./runtime/x-issue-hunter'),
  WHATSAPP_SEND_QR_TO_TERMINAL: z
    .string()
    .default('true')
    .transform((v) => v === 'true')
});

const env = schema.parse(process.env);
const resolveFromCwd = (targetPath) => path.resolve(process.cwd(), targetPath);
const parseNormalizedCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

env.SESSION_DIR = resolveFromCwd(env.SESSION_DIR);
env.SHERLOCK_WORKDIR = resolveFromCwd(env.SHERLOCK_WORKDIR);
env.HOLEHE_WORKDIR = resolveFromCwd(env.HOLEHE_WORKDIR);
env.MAIGRET_WORKDIR = resolveFromCwd(env.MAIGRET_WORKDIR);
env.INSTALOADER_WORKDIR = resolveFromCwd(env.INSTALOADER_WORKDIR);
env.THEHARVESTER_WORKDIR = resolveFromCwd(env.THEHARVESTER_WORKDIR);
env.MINI_MALTEGO_WORKDIR = resolveFromCwd(env.MINI_MALTEGO_WORKDIR);
env.X_ISSUE_HUNTER_WORKDIR = resolveFromCwd(env.X_ISSUE_HUNTER_WORKDIR);
env.GOOGLE_DORK_DOC_TYPES = parseNormalizedCsv(env.GOOGLE_DORK_DOC_TYPES);
if (env.GOOGLE_DORK_DOC_TYPES.length === 0) {
  env.GOOGLE_DORK_DOC_TYPES = parseNormalizedCsv('pdf,doc,docx,xls,xlsx,ppt,pptx');
}
env.GOOGLE_DORK_DEFAULT_SITE = String(env.GOOGLE_DORK_DEFAULT_SITE || '').trim().toLowerCase();

try {
  const parsedSocialSites = JSON.parse(env.MINI_MALTEGO_SOCIAL_SITES);
  env.MINI_MALTEGO_SOCIAL_SITES = Array.isArray(parsedSocialSites)
    ? parsedSocialSites
        .map((site) => ({ name: String(site?.name || '').trim(), url_template: String(site?.url_template || '').trim() }))
        .filter((site) => site.name && site.url_template)
    : [];
} catch {
  env.MINI_MALTEGO_SOCIAL_SITES = [];
}

module.exports = { env };
