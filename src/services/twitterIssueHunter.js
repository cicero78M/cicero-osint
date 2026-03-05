const fs = require('fs/promises');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');
const pg = require('pg');
const { env } = require('../config/env');

const { Pool } = pg;

const JATIM_REGION_TERMS = [
  '"jawa timur"',
  'jatim',
  'surabaya',
  'malang',
  'sidoarjo',
  'gresik',
  'kediri',
  'jember',
  'banyuwangi',
  'madiun',
  'mojokerto',
  'probolinggo',
  'pasuruan',
  'lamongan',
  'tuban',
  'bojonegoro',
  'sumenep',
  'pamekasan',
  'bangkalan',
  'sampang'
];

function parseCsv(input) {
  if (!input || input === '-') return [];
  return [...new Set(String(input).split(',').map((item) => item.trim()).filter(Boolean))];
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}#@\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !token.startsWith('@') && !token.startsWith('#'));
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((v) => sb.has(v)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

function bucketBySimilarity(items, threshold = 0.33) {
  const clusters = [];
  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      const sim = jaccard(item.tokens, cluster.centroidTokens);
      if (sim >= threshold) {
        cluster.posts.push(item);
        const aggregate = cluster.posts.flatMap((post) => post.tokens);
        cluster.centroidTokens = [...new Set(aggregate)].slice(0, 40);
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push({
        id: `tmp-${clusters.length + 1}`,
        posts: [item],
        centroidTokens: [...new Set(item.tokens)].slice(0, 40)
      });
    }
  }
  return clusters;
}

function getEntityMap(post) {
  const entities = post.raw?.data?.entities || post.raw?.entities || {};
  const hashtags = (entities.hashtags || []).map((item) => String(item.tag || item).toLowerCase()).filter(Boolean);
  const mentions = (entities.mentions || []).map((item) => String(item.username || item).toLowerCase()).filter(Boolean);
  const urls = (entities.urls || [])
    .map((item) => item.expanded_url || item.url)
    .filter(Boolean)
    .map((url) => {
      try {
        const domain = new URL(url).hostname.toLowerCase();
        return { url, domain };
      } catch {
        return { url, domain: null };
      }
    });
  return { hashtags, mentions, urls };
}

class TwitterIssueHunter {
  constructor() {
    this.client = new TwitterApi(env.X_BEARER_TOKEN);
    this.pool = new Pool({ connectionString: env.PG_URL });
  }

  buildRule(keyword) {
    const sanitized = String(keyword || '').trim();
    if (!sanitized) return null;
    return `(${sanitized}) (${JATIM_REGION_TERMS.join(' OR ')}) lang:id -is:retweet`;
  }

  async requestWithRetry(requestFn, maxRetry = 5) {
    let retry = 0;
    while (true) {
      try {
        return await requestFn();
      } catch (error) {
        const status = Number(error?.code || error?.status || error?.data?.status);
        const is429 = status === 429 || String(error?.message || '').includes('429');
        if (!is429 || retry >= maxRetry) throw error;
        const backoffMs = (2 ** retry) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        retry += 1;
      }
    }
  }

  async upsertFilteredRules(keywords) {
    const rules = keywords.map((keyword) => ({ value: this.buildRule(keyword), tag: `jatim:${keyword}` })).filter((item) => item.value);
    if (!rules.length) return { added: 0 };

    const current = await this.requestWithRetry(() => this.client.v2.streamRules());
    const existing = (current?.data || []).filter((rule) => String(rule.tag || '').startsWith('jatim:'));

    if (existing.length) {
      await this.requestWithRetry(() => this.client.v2.updateStreamRules({ delete: { ids: existing.map((rule) => rule.id) } }));
    }

    await this.requestWithRetry(() => this.client.v2.updateStreamRules({ add: rules }));
    return { added: rules.length };
  }

  async savePost(payload) {
    const post = payload?.data;
    if (!post?.id) return;

    const users = payload?.includes?.users || [];
    const author = users.find((item) => item.id === post.author_id);
    const metrics = post.public_metrics || {};

    await this.pool.query(
      `insert into x_post(post_id, author_id, created_at, lang, text, like_count, reply_count, repost_count, quote_count, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (post_id) do update set
       author_id = excluded.author_id,
       created_at = excluded.created_at,
       lang = excluded.lang,
       text = excluded.text,
       like_count = excluded.like_count,
       reply_count = excluded.reply_count,
       repost_count = excluded.repost_count,
       quote_count = excluded.quote_count,
       raw = excluded.raw`,
      [
        post.id,
        post.author_id,
        post.created_at,
        post.lang || null,
        post.text || '',
        metrics.like_count || 0,
        metrics.reply_count || 0,
        metrics.retweet_count || 0,
        metrics.quote_count || 0,
        payload
      ]
    );

    if (author?.id) {
      await this.pool.query(
        `insert into x_author(author_id, username, name, verified, followers_count, following_count, raw)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (author_id) do update set
         username = excluded.username,
         name = excluded.name,
         verified = excluded.verified,
         followers_count = excluded.followers_count,
         following_count = excluded.following_count,
         raw = excluded.raw`,
        [
          author.id,
          author.username || null,
          author.name || null,
          Boolean(author.verified),
          author.public_metrics?.followers_count || 0,
          author.public_metrics?.following_count || 0,
          author
        ]
      );
    }

    const entities = getEntityMap({ raw: payload });
    for (const hashtag of entities.hashtags) {
      // eslint-disable-next-line no-await-in-loop
      await this.pool.query(
        `insert into x_hashtag(post_id, hashtag) values ($1,$2) on conflict do nothing`,
        [post.id, hashtag]
      );
    }
    for (const mention of entities.mentions) {
      // eslint-disable-next-line no-await-in-loop
      await this.pool.query(
        `insert into x_mention(post_id, mentioned_username) values ($1,$2) on conflict do nothing`,
        [post.id, mention]
      );
    }
    for (const item of entities.urls) {
      // eslint-disable-next-line no-await-in-loop
      await this.pool.query(
        `insert into x_url(post_id, url, domain) values ($1,$2,$3) on conflict do nothing`,
        [post.id, item.url, item.domain]
      );
    }
  }

  async ingestRecent(keywords, windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    const now = new Date();
    const start = new Date(now.getTime() - safeWindow * 60 * 1000).toISOString();

    const query = `(${keywords.join(' OR ')}) (${JATIM_REGION_TERMS.join(' OR ')}) lang:id -is:retweet`;
    const paginator = await this.requestWithRetry(() => this.client.v2.search(query, {
      max_results: 100,
      'tweet.fields': ['created_at', 'lang', 'author_id', 'public_metrics', 'entities', 'referenced_tweets'],
      expansions: ['author_id'],
      'user.fields': ['username', 'name', 'verified', 'public_metrics'],
      start_time: start
    }));

    let inserted = 0;
    for await (const tweet of paginator) {
      const payload = {
        data: tweet,
        includes: {
          users: (paginator?.includes?.users || []).filter((item) => item.id === tweet.author_id)
        }
      };
      // eslint-disable-next-line no-await-in-loop
      await this.savePost(payload);
      inserted += 1;
    }

    return { inserted, windowMinutes: safeWindow, start, end: now.toISOString() };
  }

  async runFilteredStream(keywords, onMessage = async () => {}) {
    await this.upsertFilteredRules(keywords);
    const stream = await this.requestWithRetry(() => this.client.v2.searchStream({
      'tweet.fields': ['created_at', 'lang', 'author_id', 'public_metrics', 'entities', 'referenced_tweets'],
      expansions: ['author_id'],
      'user.fields': ['username', 'name', 'verified', 'public_metrics']
    }));
    stream.autoReconnect = true;

    for await (const message of stream) {
      await this.savePost(message);
      await onMessage(message);
    }
  }

  async discoverIssues(windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    const postsResult = await this.pool.query(
      `select post_id, author_id, created_at, text
       from x_post
       where created_at >= now() - ($1::int || ' minutes')::interval
       order by created_at desc`,
      [safeWindow]
    );

    const posts = postsResult.rows.map((post) => ({ ...post, tokens: tokenize(post.text) })).filter((post) => post.tokens.length > 0);
    const clusters = bucketBySimilarity(posts, 0.34).filter((cluster) => cluster.posts.length >= 3);
    const issues = [];

    for (const cluster of clusters) {
      const postIds = cluster.posts.map((post) => post.post_id);
      const topTokens = [...new Set(cluster.posts.flatMap((post) => post.tokens))].slice(0, 6);
      const label = topTokens.join(' | ') || 'issue-unknown';
      const repPost = cluster.posts[0];

      const baseline = await this.pool.query(
        `select count(*)::int as volume,
                count(distinct author_id)::int as uniq_authors
         from x_post
         where created_at between now() - interval '7 days' and now() - interval '1 day'
           and text ilike any ($1::text[])`,
        [topTokens.map((token) => `%${token}%`)]
      );

      const baselineVolume = Math.max(1, baseline.rows[0]?.volume || 1);
      const baselineAuthors = Math.max(1, baseline.rows[0]?.uniq_authors || 1);
      const currentVolume = cluster.posts.length;
      const currentAuthors = new Set(cluster.posts.map((post) => post.author_id)).size;
      const burstScore = Number((((currentVolume / baselineVolume) * 0.7) + ((currentAuthors / baselineAuthors) * 0.3)).toFixed(3));

      const issueInsert = await this.pool.query(
        `insert into x_issue(label, window_start, window_end, size, burst_score, top_hashtags, top_domains, top_entities)
         values ($1, now() - ($2::int || ' minutes')::interval, now(), $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         returning issue_id`,
        [label, safeWindow, currentVolume, burstScore, JSON.stringify([]), JSON.stringify([]), JSON.stringify(topTokens)]
      );

      const issueId = issueInsert.rows[0].issue_id;
      for (const postId of postIds) {
        // eslint-disable-next-line no-await-in-loop
        await this.pool.query(`insert into x_issue_map(issue_id, post_id) values ($1,$2) on conflict do nothing`, [issueId, postId]);
      }

      issues.push({ issueId, label, size: currentVolume, burstScore, representativePostId: repPost.post_id });
    }

    return issues;
  }

  async buildActorNetwork(windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    const result = await this.pool.query(
      `with issue_posts as (
         select im.issue_id, p.post_id, p.author_id
         from x_issue_map im
         join x_post p on p.post_id = im.post_id
         where p.created_at >= now() - ($1::int || ' minutes')::interval
       )
       select left_side.author_id as src_author,
              right_side.author_id as dst_author,
              count(*)::int as weight
       from issue_posts left_side
       join issue_posts right_side
         on left_side.issue_id = right_side.issue_id
        and left_side.author_id <> right_side.author_id
       group by left_side.author_id, right_side.author_id
       having count(*) >= 2`,
      [safeWindow]
    );

    return result.rows;
  }

  async exportGraphArtifacts(caseId) {
    const outDir = path.join(env.X_ISSUE_HUNTER_WORKDIR, caseId);
    await fs.mkdir(outDir, { recursive: true });

    const issuesResult = await this.pool.query(`select * from x_issue order by created_at desc limit 50`);
    const nodes = [];
    const edges = [];

    for (const issue of issuesResult.rows) {
      nodes.push({ id: `Issue:${issue.issue_id}`, label: 'Issue', name: issue.label, burst_score: issue.burst_score });

      const postRows = await this.pool.query(
        `select p.post_id, p.author_id from x_issue_map im join x_post p on p.post_id = im.post_id where im.issue_id = $1`,
        [issue.issue_id]
      );

      for (const post of postRows.rows) {
        nodes.push({ id: `Post:${post.post_id}`, label: 'Post' });
        nodes.push({ id: `Account:${post.author_id}`, label: 'Account' });
        edges.push({ start: `Account:${post.author_id}`, end: `Post:${post.post_id}`, type: 'POSTED' });
        edges.push({ start: `Post:${post.post_id}`, end: `Issue:${issue.issue_id}`, type: 'IN_ISSUE' });
      }
    }

    const uniqNodes = Object.values(nodes.reduce((acc, node) => ({ ...acc, [node.id]: node }), {}));
    const issueJson = path.join(outDir, 'issues.json');
    const nodesCsv = path.join(outDir, 'nodes.csv');
    const edgesCsv = path.join(outDir, 'edges.csv');

    await fs.writeFile(issueJson, JSON.stringify(issuesResult.rows, null, 2));
    await fs.writeFile(nodesCsv, [':ID,:LABEL,name,burst_score', ...uniqNodes.map((node) => `${node.id},${node.label},${node.name || ''},${node.burst_score || ''}`)].join('\n'));
    await fs.writeFile(edgesCsv, [':START_ID,:END_ID,:TYPE', ...edges.map((edge) => `${edge.start},${edge.end},${edge.type}`)].join('\n'));

    return { outDir, issueJson, nodesCsv, edgesCsv };
  }

  async close() {
    await this.pool.end();
  }
}

async function runTwitterIssueHunter({ keywords, windowMinutes }) {
  const parsedKeywords = parseCsv(keywords);
  if (!parsedKeywords.length) {
    throw new Error('Berikan minimal 1 keyword, contoh: !xissue bansos,pemilu 60');
  }

  const engine = new TwitterIssueHunter();
  try {
    const ingestion = await engine.ingestRecent(parsedKeywords, windowMinutes);
    const issues = await engine.discoverIssues(windowMinutes);
    const actorNetwork = await engine.buildActorNetwork(windowMinutes);
    const caseId = `xissue-${Date.now()}`;
    const exported = await engine.exportGraphArtifacts(caseId);

    return {
      caseId,
      ingestion,
      issues,
      actorNetwork,
      exports: exported
    };
  } finally {
    await engine.close();
  }
}

module.exports = {
  JATIM_REGION_TERMS,
  TwitterIssueHunter,
  runTwitterIssueHunter
};
