const fs = require('fs/promises');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');
const { env } = require('../config/env');

const DOMAIN_MAX_LENGTH = 253;
const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_REGEX = /^[a-z0-9._-]{1,50}$/i;
const SCRAPE_EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
const HREF_REGEX = /href\s*=\s*["']([^"']+)["']/gi;

function logStage(stage, details = {}) {
  // eslint-disable-next-line no-console
  console.info('[mini-maltego]', { stage, ...details });
}

class Graph {
  constructor(caseId) {
    this.caseId = caseId;
    this.createdAt = Math.floor(Date.now() / 1000);
    this.nodeMap = new Map();
    this.edges = [];
  }

  upsertNode(type, key, props = {}) {
    const id = `${type}:${key}`;
    const existing = this.nodeMap.get(id);
    if (existing) {
      existing.props = { ...existing.props, ...stripUndefined(props) };
      return id;
    }

    this.nodeMap.set(id, { id, type, key, props: stripUndefined({ key, ...props }) });
    return id;
  }

  addEdge(src, dst, type, props = {}) {
    this.edges.push({ src, dst, type, props: stripUndefined(props) });
  }

  nodes() {
    return Array.from(this.nodeMap.values());
  }
}

function stripUndefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

function sanitizeDomain(input) {
  if (!input || input === '-') return null;
  const domain = String(input).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return null;
  if (domain.length > DOMAIN_MAX_LENGTH) throw new Error('Domain terlalu panjang. Maksimum 253 karakter.');
  if (!DOMAIN_REGEX.test(domain)) throw new Error('Format domain tidak valid. Contoh benar: example.com');
  return domain;
}

function sanitizeEmails(raw) {
  if (!raw || raw === '-') return [];
  return String(raw)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((email) => EMAIL_REGEX.test(email));
}

function sanitizeHandles(raw) {
  if (!raw || raw === '-') return [];
  return String(raw)
    .split(',')
    .map((item) => item.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
    .filter((handle) => HANDLE_REGEX.test(handle));
}

async function safeFetch(url, method = 'GET') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.MINI_MALTEGO_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': env.MINI_MALTEGO_USER_AGENT }
    });
    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanDomain(domain, graph) {
  const domainNode = graph.upsertNode('Domain', domain, { domain });

  try {
    const addresses = await dns.resolve4(domain);
    for (const ip of addresses) {
      const ipNode = graph.upsertNode('IP', ip, { ip });
      graph.addEdge(domainNode, ipNode, 'RESOLVES_TO');
    }
  } catch {}

  try {
    const mxRecords = await dns.resolveMx(domain);
    for (const record of mxRecords) {
      const value = `${record.exchange}:${record.priority}`;
      const recNode = graph.upsertNode('DNSRecord', `${domain}:MX:${value}`, { rtype: 'MX', value });
      graph.addEdge(domainNode, recNode, 'HAS_DNS_RECORD');
    }
  } catch {}

  try {
    const nsRecords = await dns.resolveNs(domain);
    for (const value of nsRecords) {
      const recNode = graph.upsertNode('DNSRecord', `${domain}:NS:${value}`, { rtype: 'NS', value });
      graph.addEdge(domainNode, recNode, 'HAS_DNS_RECORD');
    }
  } catch {}

  try {
    const txtRecords = await dns.resolveTxt(domain);
    for (const record of txtRecords) {
      const value = record.join('');
      const recNode = graph.upsertNode('DNSRecord', `${domain}:TXT:${value}`, { rtype: 'TXT', value });
      graph.addEdge(domainNode, recNode, 'HAS_DNS_RECORD');
    }
  } catch {}

  const rdap = await safeFetch(`https://rdap.org/domain/${domain}`);
  if (rdap && rdap.ok) {
    try {
      const data = await rdap.json();
      const whoisNode = graph.upsertNode('Whois', domain, {
        registrar: data?.registrar || data?.port43 || '',
        handle: data?.handle || ''
      });
      graph.addEdge(domainNode, whoisNode, 'HAS_WHOIS');
    } catch {}
  }

  let pageUrl = `https://${domain}`;
  let response = await safeFetch(pageUrl);
  if (!response || !response.ok) {
    pageUrl = `http://${domain}`;
    response = await safeFetch(pageUrl);
  }

  if (!response || !response.ok) return;

  const html = await response.text();
  const pageNode = graph.upsertNode('WebPage', pageUrl, { url: pageUrl, status: response.status });
  graph.addEdge(domainNode, pageNode, 'HAS_PAGE');

  const foundEmails = new Set(html.match(SCRAPE_EMAIL_REGEX) || []);
  for (const email of foundEmails) {
    const emailNode = graph.upsertNode('Email', email.toLowerCase(), { email: email.toLowerCase() });
    graph.addEdge(pageNode, emailNode, 'MENTIONS_EMAIL');
    graph.addEdge(domainNode, emailNode, 'ASSOCIATED_EMAIL');
  }

  const links = new Set();
  let match;
  while ((match = HREF_REGEX.exec(html)) !== null) {
    const href = (match[1] || '').trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('#')) continue;
    let url = href;
    if (url.startsWith('//')) url = `https:${url}`;
    if (url.startsWith('/')) url = `${pageUrl.replace(/\/$/, '')}${url}`;
    if (url.startsWith('http')) links.add(url);
  }

  for (const link of links) {
    const linkNode = graph.upsertNode('WebPage', link, { url: link });
    graph.addEdge(pageNode, linkNode, 'LINKS_TO');
  }
}

async function scanEmail(email, graph) {
  const emailNode = graph.upsertNode('Email', email, { email });
  const domain = email.split('@').pop();
  const domainNode = graph.upsertNode('Domain', domain, { domain });
  graph.addEdge(emailNode, domainNode, 'BELONGS_TO_DOMAIN');

  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404`;
  const response = await safeFetch(gravatarUrl, 'HEAD');
  const gravatarNode = graph.upsertNode('Gravatar', hash, {
    hash,
    url: gravatarUrl,
    exists: Boolean(response && response.status === 200)
  });
  graph.addEdge(emailNode, gravatarNode, 'HAS_GRAVATAR');
}

async function scanSocial(handle, graph) {
  const handleNode = graph.upsertNode('Handle', handle, { handle });
  for (const site of env.MINI_MALTEGO_SOCIAL_SITES) {
    const url = String(site.url_template || '').replace('{username}', encodeURIComponent(handle));
    if (!url) continue;

    const response = await safeFetch(url, 'HEAD');
    const status = response ? response.status : null;
    const exists = Boolean(status && [200, 301, 302].includes(status));
    const accountNode = graph.upsertNode('SocialAccount', `${site.name}:${handle}`, {
      platform: site.name,
      url,
      status,
      exists
    });
    graph.addEdge(handleNode, accountNode, 'HAS_ACCOUNT');
  }
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function scoreSockpuppet(graph) {
  const handles = graph.nodes().filter((node) => node.type === 'Handle');
  for (let i = 0; i < handles.length; i += 1) {
    for (let j = i + 1; j < handles.length; j += 1) {
      const a = handles[i].key;
      const b = handles[j].key;
      const dist = levenshtein(a, b);
      const similarity = 1 - dist / Math.max(a.length, b.length, 1);
      if (similarity >= 0.85) {
        graph.addEdge(handles[i].id, handles[j].id, 'POSSIBLE_SOCKPUPPET', {
          score: Number(similarity.toFixed(3)),
          reason: 'handle_similarity'
        });
      }
    }
  }
}

async function exportArtifacts(graph, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const nodes = graph.nodes();
  const edges = graph.edges;

  const jsonPath = path.join(outDir, 'graph.json');
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        case_id: graph.caseId,
        created_at: graph.createdAt,
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, ...n.props })),
        edges: edges.map((e) => ({ src: e.src, dst: e.dst, type: e.type, ...e.props }))
      },
      null,
      2
    )
  );

  const nodePropKeys = [...new Set(nodes.flatMap((node) => Object.keys(node.props)))].sort();
  const nodeCsv = [ [':ID', ':LABEL', ...nodePropKeys].join(',') ];
  for (const node of nodes) {
    nodeCsv.push([
      csvEscape(node.id),
      csvEscape(node.type),
      ...nodePropKeys.map((key) => csvEscape(node.props[key] ?? ''))
    ].join(','));
  }

  const edgePropKeys = [...new Set(edges.flatMap((edge) => Object.keys(edge.props)))].sort();
  const edgeCsv = [ [':START_ID', ':END_ID', ':TYPE', ...edgePropKeys].join(',') ];
  for (const edge of edges) {
    edgeCsv.push([
      csvEscape(edge.src),
      csvEscape(edge.dst),
      csvEscape(edge.type),
      ...edgePropKeys.map((key) => csvEscape(edge.props[key] ?? ''))
    ].join(','));
  }

  const nodesPath = path.join(outDir, 'neo4j_nodes.csv');
  const edgesPath = path.join(outDir, 'neo4j_edges.csv');
  await fs.writeFile(nodesPath, `${nodeCsv.join('\n')}\n`);
  await fs.writeFile(edgesPath, `${edgeCsv.join('\n')}\n`);

  return { jsonPath, nodesPath, edgesPath };
}


function toList(values, fallback = '-') {
  const items = [...new Set((values || []).filter(Boolean))];
  return items.length ? items.join(', ') : fallback;
}

async function buildStructuredSummaryFromGraphJson(jsonPath, maxChars) {
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  } catch {
    return 'Ringkasan tidak tersedia: gagal membaca graph.json.';
  }

  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload?.edges) ? payload.edges : [];

  const byType = nodes.reduce((acc, node) => {
    const type = String(node?.type || 'Unknown');
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const domains = nodes.filter((n) => n.type === 'Domain').map((n) => n.domain || n.key);
  const emails = nodes.filter((n) => n.type === 'Email').map((n) => n.email || n.key);
  const ips = nodes.filter((n) => n.type === 'IP').map((n) => n.ip || n.key);
  const handles = nodes.filter((n) => n.type === 'Handle').map((n) => n.handle || n.key);
  const socialAccounts = nodes.filter((n) => n.type === 'SocialAccount');
  const activeAccounts = socialAccounts.filter((n) => n.exists === true);
  const activeAccountLinks = activeAccounts.map((n) => n.url || n.key).filter(Boolean);
  const dnsRecords = nodes.filter((n) => n.type === 'DNSRecord').map((n) => `${n.rtype || '?'}:${n.value || n.key}`);
  const webPages = nodes.filter((n) => n.type === 'WebPage').map((n) => n.url || n.key);
  const gravatars = nodes.filter((n) => n.type === 'Gravatar');
  const gravatarExists = gravatars.filter((n) => n.exists === true).length;
  const sockpuppetEdges = edges.filter((e) => e.type === 'POSSIBLE_SOCKPUPPET');

  const scoreLines = sockpuppetEdges
    .map((e) => `- ${String(e.src || '').replace('Handle:', '')} ↔ ${String(e.dst || '').replace('Handle:', '')} (score=${e.score ?? '-'})`)
    .slice(0, 5);

  const typeSummary = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}:${count}`)
    .join(', ') || '-';

  const lines = [
    '📌 *Laporan Mini-Maltego OSINT*',
    `Case ID: *${payload?.case_id || '-'}*`,
    '',
    '*Statistik Graph*',
    `- Total node: ${nodes.length}`,
    `- Total edge: ${edges.length}`,
    `- Komposisi node: ${typeSummary}`,
    '',
    '*Hasil Domain & Infrastruktur*',
    `- Domain terdeteksi: ${toList(domains)}`,
    `- IP resolve: ${toList(ips)}`,
    `- DNS record: ${dnsRecords.length ? dnsRecords.slice(0, 8).join('; ') : '-'}`,
    '',
    '*Hasil Identitas*',
    `- Email terdeteksi: ${toList(emails)}`,
    `- Handle/username: ${toList(handles)}`,
    `- Gravatar aktif: ${gravatarExists}/${gravatars.length}`,
    '',
    '*Hasil Social Presence*',
    `- Akun social dipindai: ${socialAccounts.length}`,
    `- Akun terindikasi aktif (exists=true): ${activeAccounts.length}`,
    `- Link aktif: ${activeAccountLinks.length ? activeAccountLinks.join(' | ') : '-'}`,
    '',
    '*Hasil Web Mapping*',
    `- Web page terpetakan: ${webPages.length}`,
    `- Semua URL: ${webPages.length ? webPages.join(' | ') : '-'}`,
    '',
    '*Indikasi Sockpuppet (heuristik, bukan bukti)*',
    ...(scoreLines.length ? scoreLines : ['- Tidak ada pasangan melewati threshold kemiripan.'])
  ];

  const output = lines.join('\n').trim();
  if (!maxChars || output.length <= maxChars) return output;
  return `${output.slice(0, maxChars - 25)}\n\n[ringkasan dipotong]`;
}

function csvEscape(value) {
  const raw = String(value ?? '');
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

async function runMiniMaltego({ domain, emails, handles }) {
  const normalizedDomain = sanitizeDomain(domain);
  const normalizedEmails = sanitizeEmails(emails);
  const normalizedHandles = sanitizeHandles(handles);

  logStage('seed.normalized', {
    domain: normalizedDomain || '-',
    emails: normalizedEmails.length,
    usernames: normalizedHandles.length
  });

  if (!normalizedDomain && normalizedEmails.length === 0 && normalizedHandles.length === 0) {
    throw new Error('Minimal isi salah satu seed: domain / emails / usernames.');
  }

  const caseId = `case-${Date.now()}`;
  const graph = new Graph(caseId);

  logStage('case.start', { caseId });

  if (normalizedDomain) {
    logStage('scan.domain.start', { caseId, domain: normalizedDomain });
    await scanDomain(normalizedDomain, graph);
    logStage('scan.domain.done', { caseId, domain: normalizedDomain });
  }
  for (const email of normalizedEmails) {
    logStage('scan.email.start', { caseId, email });
    // eslint-disable-next-line no-await-in-loop
    await scanEmail(email, graph);
    logStage('scan.email.done', { caseId, email });
  }
  for (const handle of normalizedHandles) {
    logStage('scan.social.start', { caseId, username: handle });
    // eslint-disable-next-line no-await-in-loop
    await scanSocial(handle, graph);
    logStage('scan.social.done', { caseId, username: handle });
  }

  logStage('sockpuppet.scoring.start', { caseId });
  scoreSockpuppet(graph);
  logStage('sockpuppet.scoring.done', { caseId });

  const caseDir = path.join(env.MINI_MALTEGO_WORKDIR, `${caseId}`);
  logStage('export.start', { caseId, outDir: caseDir });
  const artifacts = await exportArtifacts(graph, caseDir);
  const summary = await buildStructuredSummaryFromGraphJson(artifacts.jsonPath, env.MINI_MALTEGO_MAX_OUTPUT_CHARS);

  logStage('case.done', {
    caseId,
    nodes: graph.nodes().length,
    edges: graph.edges.length,
    outDir: caseDir
  });

  return {
    caseId,
    output: summary.slice(0, env.MINI_MALTEGO_MAX_OUTPUT_CHARS),
    ...artifacts,
    outDir: caseDir
  };
}

module.exports = { runMiniMaltego };
