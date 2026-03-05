const fs = require('fs/promises');
const path = require('path');
const { runSherlock } = require('./sherlock');
const { runMaigret } = require('./maigret');
const { env } = require('../config/env');

const HANDLE_REGEX = /^[a-z0-9._-]{1,50}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeCsv(input, mapper = (value) => value) {
  if (!input || input === '-') return [];
  return [...new Set(String(input).split(',').map((item) => mapper(item.trim())).filter(Boolean))];
}

function normalizeHandle(value) {
  const cleaned = String(value || '').replace(/^@/, '').toLowerCase();
  return HANDLE_REGEX.test(cleaned) ? cleaned : null;
}

function normalizeEmail(value) {
  const cleaned = String(value || '').toLowerCase();
  return EMAIL_REGEX.test(cleaned) ? cleaned : null;
}

function normalizeUrl(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTag(value) {
  const cleaned = String(value || '').trim().toLowerCase().replace(/^#/, '');
  return cleaned || null;
}

class IntelGraph {
  constructor(caseId) {
    this.caseId = caseId;
    this.nodes = new Map();
    this.edges = [];
    this.evidenceStore = [];
  }

  addNode(type, key, props = {}) {
    const id = `${type}:${key}`;
    const existing = this.nodes.get(id);
    if (existing) {
      existing.props = { ...existing.props, ...props };
      return id;
    }
    this.nodes.set(id, { id, type, key, props: { key, ...props } });
    return id;
  }

  addEdge(from, to, type, confidence, evidenceRefs = [], reasonCodes = []) {
    this.edges.push({ from_id: from, to_id: to, type, confidence, evidence_refs: evidenceRefs, reason_codes: reasonCodes });
  }

  addEvidence(tool, rawPath, extractedJson = {}) {
    const ref = `ev-${Date.now()}-${this.evidenceStore.length + 1}`;
    this.evidenceStore.push({ ref, tool, raw_path: rawPath, extracted_json: extractedJson, ts: new Date().toISOString() });
    return ref;
  }
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s)\]}]+/gi) || [];
  return [...new Set(matches)];
}

function handleSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length, 1);
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] === b[i]) same += 1;
  }
  return same / maxLen;
}

function scoreRelationship(signals) {
  let score = 0;
  const reasonCodes = [];

  if (signals.sameBioLink) {
    score += 30;
    reasonCodes.push('same_bio_link');
  }
  if (signals.sameAvatarHash) {
    score += 25;
    reasonCodes.push('same_avatar_hash');
  }
  if (signals.repeatedAmplify) {
    score += 20;
    reasonCodes.push('repeated_amplify');
  }
  if (signals.stylometrySimilarity) {
    score += 15;
    reasonCodes.push('linguistic_similarity');
  }
  if (signals.activityTimeSimilarity) {
    score += 10;
    reasonCodes.push('co_activity');
  }
  if (signals.handlePattern) {
    score += 8;
    reasonCodes.push('handle_pattern');
  }
  if (signals.existsOnly) {
    score += 3;
    reasonCodes.push('exists_signal_only');
  }

  return { score, reasonCodes };
}

function classifyScore(score) {
  if (score > 60) return 'strong';
  if (score > 40) return 'likely';
  if (score >= 15) return 'possible';
  return 'unconfirmed';
}


function buildProfessionalAnalysis(outputData) {
  const discovered = outputData.runtime.stage_1_2.discovered_accounts;
  const correlated = outputData.runtime.stage_3.correlated_pairs;
  const issues = outputData.runtime.stage_4.issue_clusters;
  const hashtags = outputData.runtime.stage_4.hashtags;

  const totalPossiblePairs = discovered > 1 ? (discovered * (discovered - 1)) / 2 : 0;
  const correlationRate = totalPossiblePairs > 0
    ? `${((correlated / totalPossiblePairs) * 100).toFixed(1)}%`
    : '0.0%';

  return {
    executiveSummary: discovered > 0
      ? 'Pipeline discovery dan validasi akun berhasil dijalankan. Sistem menemukan kandidat akun lintas platform beserta indikasi korelasi awal sockpuppet.'
      : 'Pipeline sudah berjalan, namun belum ada akun terverifikasi dari seed yang diberikan.',
    keyFindings: [
      `Total akun discovered/validated: ${discovered}`,
      `Relasi LIKELY_SAME_OPERATOR (>=possible): ${correlated}`,
      `Issue cluster terpetakan: ${issues}`,
      `Hashtag terpetakan: ${hashtags}`,
      `Kerapatan korelasi antar akun: ${correlationRate}`
    ],
    recommendation: discovered > 0
      ? 'Prioritaskan verifikasi manual pada edge dengan confidence tertinggi dan reason code dominan, lalu lanjutkan ekspor graph ke Neo4j untuk analisis ring/diffusion lanjutan.'
      : 'Perlu memperkaya seed (handle/email/link) agar coverage discovery meningkat sebelum korelasi dan issue mapping tahap lanjut.'
  };
}

async function ensureWorkdir() {
  const workdir = path.join(env.MINI_MALTEGO_WORKDIR, 'social-media');
  await fs.mkdir(workdir, { recursive: true });
  return workdir;
}

async function runSocialMediaIntel({ handles, emails, links, keywords, hashtags }) {
  const normalizedHandles = normalizeCsv(handles, normalizeHandle);
  const normalizedEmails = normalizeCsv(emails, normalizeEmail);
  const normalizedLinks = normalizeCsv(links, normalizeUrl);
  const normalizedKeywords = normalizeCsv(keywords, (value) => value.trim().toLowerCase() || null);
  const normalizedHashtags = normalizeCsv(hashtags, normalizeTag);

  if (!normalizedHandles.length && !normalizedEmails.length && !normalizedLinks.length) {
    throw new Error('Minimal berikan 1 seed pada handles/email/link.');
  }

  const caseId = `socmint-${Date.now()}`;
  const baseDir = await ensureWorkdir();
  const outDir = path.join(baseDir, caseId);
  await fs.mkdir(outDir, { recursive: true });

  const graph = new IntelGraph(caseId);
  const logs = [];

  const stageNode = graph.addNode('WorkflowStage', 'stage-0-seeds', { name: 'Stage 0 - Seeds' });
  for (const handle of normalizedHandles) graph.addEdge(stageNode, graph.addNode('Seed', `handle:${handle}`, { seed_type: 'handle', value: handle }), 'USES_SEED', 100);
  for (const email of normalizedEmails) graph.addEdge(stageNode, graph.addNode('Seed', `email:${email}`, { seed_type: 'email', value: email }), 'USES_SEED', 100);
  for (const link of normalizedLinks) graph.addEdge(stageNode, graph.addNode('Seed', `link:${link}`, { seed_type: 'link', value: link }), 'USES_SEED', 100);

  const discoveredAccounts = [];

  for (const handle of normalizedHandles) {
    try {
      logs.push(`Stage 1 Discover: Sherlock -> ${handle}`);
      // eslint-disable-next-line no-await-in-loop
      const sherlock = await runSherlock(handle);
      const evRef = graph.addEvidence('sherlock', sherlock.reportDir, { output: sherlock.output });
      const urls = extractUrls(sherlock.output);
      urls.forEach((url) => {
        const platform = new URL(url).hostname;
        const accountId = graph.addNode('Account', `${platform}:${handle}`, { platform, handle, url });
        discoveredAccounts.push({ id: accountId, handle, platform, url, evidence: evRef });
        graph.addEdge(graph.addNode('Seed', `handle:${handle}`, { seed_type: 'handle', value: handle }), accountId, 'DISCOVERED_AS', 35, [evRef], ['sherlock_exists']);
      });
    } catch (error) {
      logs.push(`Stage 1 Discover: Sherlock gagal untuk ${handle}: ${error.message}`);
    }

    try {
      logs.push(`Stage 2 Validate: Maigret -> ${handle}`);
      // eslint-disable-next-line no-await-in-loop
      const maigret = await runMaigret(handle);
      const evRef = graph.addEvidence('maigret', maigret.outputFile, { output: maigret.output });
      const urls = extractUrls(maigret.output);
      urls.forEach((url) => {
        const platform = new URL(url).hostname;
        const accountId = graph.addNode('Account', `${platform}:${handle}`, { platform, handle, url });
        discoveredAccounts.push({ id: accountId, handle, platform, url, evidence: evRef });
        graph.addEdge(graph.addNode('Seed', `handle:${handle}`, { seed_type: 'handle', value: handle }), accountId, 'VALIDATED_AS', 50, [evRef], ['maigret_validated']);
      });
    } catch (error) {
      logs.push(`Stage 2 Validate: Maigret gagal untuk ${handle}: ${error.message}`);
    }
  }

  for (let i = 0; i < discoveredAccounts.length; i += 1) {
    for (let j = i + 1; j < discoveredAccounts.length; j += 1) {
      const left = discoveredAccounts[i];
      const right = discoveredAccounts[j];
      if (left.id === right.id) continue;

      const leftHost = new URL(left.url).hostname;
      const rightHost = new URL(right.url).hostname;

      const signals = {
        sameBioLink: leftHost === rightHost,
        sameAvatarHash: false,
        repeatedAmplify: false,
        stylometrySimilarity: false,
        activityTimeSimilarity: false,
        handlePattern: handleSimilarity(left.handle, right.handle) >= 0.85,
        existsOnly: true
      };

      const { score, reasonCodes } = scoreRelationship(signals);
      const category = classifyScore(score);
      if (category !== 'unconfirmed') {
        graph.addEdge(left.id, right.id, 'LIKELY_SAME_OPERATOR', score, [left.evidence, right.evidence], reasonCodes);
        graph.addEdge(left.id, right.id, 'RELATIONSHIP_TIER', score, [], [category]);
      }
    }
  }

  const issueStage = graph.addNode('WorkflowStage', 'stage-4-issue-graph', { name: 'Stage 4 - Issue Graph' });
  normalizedKeywords.forEach((keyword) => {
    const issueNode = graph.addNode('IssueCluster', keyword, { keyword, cadence: '24h' });
    graph.addEdge(issueStage, issueNode, 'TRACKS_TOPIC', 100);
    discoveredAccounts.forEach((account) => graph.addEdge(account.id, issueNode, 'POSTS_ABOUT', 20, [account.evidence], ['seed_based_mapping']));
  });
  normalizedHashtags.forEach((tag) => {
    const hashtagNode = graph.addNode('Hashtag', tag, { hashtag: tag });
    graph.addEdge(issueStage, hashtagNode, 'TRACKS_HASHTAG', 100);
  });

  const outputData = {
    case_id: caseId,
    runtime: {
      stage_0: { handles: normalizedHandles, emails: normalizedEmails, links: normalizedLinks, keywords: normalizedKeywords, hashtags: normalizedHashtags },
      stage_1_2: { discovered_accounts: discoveredAccounts.length },
      stage_3: { correlated_pairs: graph.edges.filter((edge) => edge.type === 'LIKELY_SAME_OPERATOR').length },
      stage_4: { issue_clusters: normalizedKeywords.length, hashtags: normalizedHashtags.length }
    },
    entities_account: Array.from(graph.nodes.values()).filter((node) => node.type === 'Account'),
    entities_issue_cluster: Array.from(graph.nodes.values()).filter((node) => node.type === 'IssueCluster'),
    edges: graph.edges,
    evidence_store: graph.evidenceStore,
    logs
  };

  const jsonPath = path.join(outDir, 'social-media-intel.json');
  await fs.writeFile(jsonPath, JSON.stringify(outputData, null, 2));

  const professionalAnalysis = buildProfessionalAnalysis(outputData);

  const summary = [
    '✅ *SOCMINT Intelligence Report*',
    '',
    `Case ID: *${caseId}*`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '*Executive Summary*',
    professionalAnalysis.executiveSummary,
    '',
    '*JSON Output (Ringkasan)*',
    '```json',
    JSON.stringify({
      case_id: outputData.case_id,
      runtime: outputData.runtime,
      output_file: jsonPath
    }, null, 2),
    '```',
    '',
    '*Analysis*',
    ...professionalAnalysis.keyFindings.map((line) => `- ${line}`),
    `- Recommendation: ${professionalAnalysis.recommendation}`,
    '',
    '*Workflow Blueprint*',
    '- Stage 0: Seeds (handle/email/link/keyword/hashtag)',
    '- Stage 1: Discover (Sherlock broad sweep)',
    '- Stage 2: Validate & Extract (Maigret)',
    '- Stage 3: Correlate (confidence + reason codes)',
    '- Stage 4: Issue Graph (issue cluster + hashtag mapping)',
    '- Stage 5: Export JSON evidence bundle',
    '',
    `Output JSON evidence lengkap: ${jsonPath}`
  ].join('\n');

  return { caseId, outDir, jsonPath, output: summary };
}

module.exports = { runSocialMediaIntel };
