const fs = require('fs/promises');
const path = require('path');
const pg = require('pg');
const { env } = require('../config/env');

const { Pool } = pg;

const JATIM_REGION_TERMS = [
  'jawa timur',
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

function logProcess(stage, detail = {}) {
  // eslint-disable-next-line no-console
  console.info('[TikTokIssueHunter]', JSON.stringify({ stage, ...detail }));
}

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

function extractEntities(text) {
  const normalized = String(text || '');
  const hashtags = (normalized.match(/#\w+/g) || []).map((tag) => tag.toLowerCase());
  const mentions = (normalized.match(/@\w+/g) || []).map((tag) => tag.toLowerCase());
  return {
    hashtags: [...new Set(hashtags)],
    mentions: [...new Set(mentions)]
  };
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

function parseRapidItems(payload) {
  if (Array.isArray(payload?.data?.videos)) return payload.data.videos;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.aweme_list)) return payload.aweme_list;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractPost(item) {
  const postId = String(item?.aweme_id || item?.id || item?.video_id || '').trim();
  if (!postId) return null;
  const desc = item?.desc || item?.title || item?.text || '';
  const author = item?.author || item?.authorInfo || item?.user || {};
  const authorId = String(author?.uid || author?.id || author?.unique_id || author?.sec_uid || 'unknown').trim();
  const authorUsername = String(author?.unique_id || author?.nickname || author?.username || '').trim();
  const stats = item?.statistics || item?.stats || {};
  const hashtags = Array.isArray(item?.textExtra)
    ? item.textExtra.map((entry) => String(entry?.hashtagName || '').trim().toLowerCase()).filter(Boolean)
    : [];

  const createTime = Number(item?.create_time || item?.createTime || item?.create_timestamp || 0);
  const createdAt = Number.isFinite(createTime) && createTime > 0
    ? new Date(createTime * 1000)
    : new Date();

  return {
    postId,
    authorId,
    authorUsername: authorUsername || null,
    text: String(desc),
    createdAt: createdAt.toISOString(),
    likeCount: Number(stats?.digg_count || stats?.likeCount || stats?.likes || 0),
    commentCount: Number(stats?.comment_count || stats?.commentCount || stats?.comments || 0),
    shareCount: Number(stats?.share_count || stats?.shareCount || stats?.shares || 0),
    playCount: Number(stats?.play_count || stats?.playCount || stats?.views || 0),
    hashtags,
    mentions: extractEntities(desc).mentions,
    followerCount: Number(author?.follower_count || author?.followerCount || author?.fans || author?.fansCount || 0),
    followingCount: Number(author?.following_count || author?.followingCount || author?.following || 0),
    videoCount: Number(author?.aweme_count || author?.videoCount || author?.video_count || 0),
    raw: item
  };
}

class TikTokIssueHunter {
  constructor() {
    this.pool = new Pool({ connectionString: env.PG_URL });
  }

  async requestWithRetry(url, maxRetry = 5) {
    let retry = 0;
    while (true) {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': env.TIKTOK_RAPIDAPI_KEY,
          'x-rapidapi-host': env.TIKTOK_RAPIDAPI_HOST
        }
      });

      if (response.ok) return response.json();
      if (response.status !== 429 || retry >= maxRetry) {
        const body = await response.text();
        throw new Error(`TikTok RapidAPI request gagal (${response.status}): ${body.slice(0, 300)}`);
      }

      const backoffMs = (2 ** retry) * 1000;
      logProcess('rapidapi_retry_429', { url, retry, backoffMs });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      retry += 1;
    }
  }

  async ingestRecent(keywords, windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    const regionRegex = new RegExp(`\\b(${JATIM_REGION_TERMS.join('|')})\\b`, 'i');
    let inserted = 0;

    logProcess('ingestion_started', { keywordsCount: keywords.length, windowMinutes: safeWindow });

    for (const keyword of keywords) {
      const searchParams = new URLSearchParams({
        keyword,
        count: String(clamp(env.TIKTOK_RAPIDAPI_MAX_COUNT, 10, 50, 20)),
        cursor: '0'
      });
      const url = `${env.TIKTOK_RAPIDAPI_BASE_URL}${env.TIKTOK_RAPIDAPI_SEARCH_PATH}?${searchParams.toString()}`;
      // eslint-disable-next-line no-await-in-loop
      const payload = await this.requestWithRetry(url);
      const items = parseRapidItems(payload).map(extractPost).filter(Boolean);
      const filtered = items.filter((item) => regionRegex.test(normalizeText(item.text)));

      logProcess('ingestion_keyword_fetched', { keyword, fetchedItems: items.length, matchedRegion: filtered.length });

      for (const post of filtered) {
        // eslint-disable-next-line no-await-in-loop
        await this.pool.query(
          `insert into tiktok_post(post_id, author_id, author_username, created_at, text, like_count, comment_count, share_count, play_count, raw)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (post_id) do update set
           author_id = excluded.author_id,
           author_username = excluded.author_username,
           created_at = excluded.created_at,
           text = excluded.text,
           like_count = excluded.like_count,
           comment_count = excluded.comment_count,
           share_count = excluded.share_count,
           play_count = excluded.play_count,
           raw = excluded.raw`,
          [
            post.postId,
            post.authorId,
            post.authorUsername,
            post.createdAt,
            post.text,
            post.likeCount,
            post.commentCount,
            post.shareCount,
            post.playCount,
            post.raw
          ]
        );

        for (const hashtag of post.hashtags) {
          // eslint-disable-next-line no-await-in-loop
          await this.pool.query(
            `insert into tiktok_hashtag(post_id, hashtag) values ($1,$2) on conflict do nothing`,
            [post.postId, hashtag]
          );
        }

        for (const mention of post.mentions) {
          // eslint-disable-next-line no-await-in-loop
          await this.pool.query(
            `insert into tiktok_mention(post_id, mention) values ($1,$2) on conflict do nothing`,
            [post.postId, mention]
          );
        }

        // eslint-disable-next-line no-await-in-loop
        await this.pool.query(
          `insert into tiktok_author(author_id, username, follower_count, following_count, video_count, raw)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (author_id) do update set
           username = excluded.username,
           follower_count = excluded.follower_count,
           following_count = excluded.following_count,
           video_count = excluded.video_count,
           raw = excluded.raw`,
          [post.authorId, post.authorUsername, post.followerCount, post.followingCount, post.videoCount, post.raw?.author || null]
        );

        // eslint-disable-next-line no-await-in-loop
        await this.pool.query(
          `insert into tiktok_post_keyword(post_id, keyword)
           values ($1,$2)
           on conflict (post_id, keyword) do nothing`,
          [post.postId, keyword.toLowerCase()]
        );

        inserted += 1;
      }
    }

    logProcess('ingestion_completed', { inserted, windowMinutes: safeWindow });
    return { inserted, windowMinutes: safeWindow };
  }

  async discoverIssues(windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    logProcess('issue_discovery_started', { windowMinutes: safeWindow });
    const postsResult = await this.pool.query(
      `select post_id, author_id, created_at, text
       from tiktok_post
       where created_at >= now() - ($1::int || ' minutes')::interval
       order by created_at desc`,
      [safeWindow]
    );

    const posts = postsResult.rows.map((post) => ({ ...post, tokens: tokenize(post.text) })).filter((post) => post.tokens.length > 0);
    const clusters = bucketBySimilarity(posts, 0.34).filter((cluster) => cluster.posts.length >= 3);
    logProcess('issue_discovery_source_loaded', { posts: posts.length, candidateClusters: clusters.length });
    const issues = [];

    for (const cluster of clusters) {
      const postIds = cluster.posts.map((post) => post.post_id);
      const topTokens = [...new Set(cluster.posts.flatMap((post) => post.tokens))].slice(0, 6);
      const label = topTokens.join(' | ') || 'issue-unknown';
      const repPost = cluster.posts[0];

      const baseline = await this.pool.query(
        `select count(*)::int as volume,
                count(distinct author_id)::int as uniq_authors
         from tiktok_post
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
        `insert into tiktok_issue(label, window_start, window_end, size, burst_score, top_entities)
         values ($1, now() - ($2::int || ' minutes')::interval, now(), $3, $4, $5::jsonb)
         returning issue_id`,
        [label, safeWindow, currentVolume, burstScore, JSON.stringify(topTokens)]
      );

      const issueId = issueInsert.rows[0].issue_id;
      for (const postId of postIds) {
        // eslint-disable-next-line no-await-in-loop
        await this.pool.query(`insert into tiktok_issue_map(issue_id, post_id) values ($1,$2) on conflict do nothing`, [issueId, postId]);
      }

      issues.push({ issueId, label, size: currentVolume, burstScore, representativePostId: repPost.post_id });
    }

    logProcess('issue_discovery_completed', { issues: issues.length, windowMinutes: safeWindow });
    return issues;
  }

  async buildActorNetwork(windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    logProcess('actor_network_started', { windowMinutes: safeWindow });
    const result = await this.pool.query(
      `with issue_posts as (
         select im.issue_id, p.post_id, p.author_id
         from tiktok_issue_map im
         join tiktok_post p on p.post_id = im.post_id
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

    logProcess('actor_network_completed', { edges: result.rows.length, windowMinutes: safeWindow });
    return result.rows;
  }

  async detectSockpuppet(windowMinutes = 60) {
    const safeWindow = clamp(windowMinutes, 15, 1440, 60);
    logProcess('sockpuppet_detection_started', { windowMinutes: safeWindow });
    const candidateResult = await this.pool.query(
      `with recent_posts as (
         select post_id, author_id, author_username, text, created_at
         from tiktok_post
         where created_at >= now() - ($1::int || ' minutes')::interval
       ),
       hashtag_overlap as (
         select p1.author_id as author_a,
                p2.author_id as author_b,
                count(distinct h1.hashtag)::int as hashtag_overlap
         from tiktok_hashtag h1
         join recent_posts p1 on p1.post_id = h1.post_id
         join tiktok_hashtag h2 on h1.hashtag = h2.hashtag and h1.post_id <> h2.post_id
         join recent_posts p2 on p2.post_id = h2.post_id and p1.author_id <> p2.author_id
         group by p1.author_id, p2.author_id
       ),
       time_proximity as (
         select p1.author_id as author_a,
                p2.author_id as author_b,
                count(*)::int as near_time_posts
         from recent_posts p1
         join recent_posts p2
           on p1.author_id <> p2.author_id
          and abs(extract(epoch from (p1.created_at - p2.created_at))) <= 300
         group by p1.author_id, p2.author_id
       )
       select coalesce(h.author_a, t.author_a) as author_a,
              coalesce(h.author_b, t.author_b) as author_b,
              coalesce(h.hashtag_overlap, 0)::int as hashtag_overlap,
              coalesce(t.near_time_posts, 0)::int as near_time_posts
       from hashtag_overlap h
       full outer join time_proximity t on h.author_a = t.author_a and h.author_b = t.author_b
       where coalesce(h.hashtag_overlap, 0) >= 2 or coalesce(t.near_time_posts, 0) >= 2
       order by hashtag_overlap desc, near_time_posts desc
       limit 100`,
      [safeWindow]
    );

    const clusters = [];
    for (const candidate of candidateResult.rows) {
      const score = Number((Math.min(1, (candidate.hashtag_overlap / 10)) * 0.6 + Math.min(1, (candidate.near_time_posts / 10)) * 0.4).toFixed(3));
      if (score < 0.35) continue;

      const clusterInsert = await this.pool.query(
        `insert into tiktok_sockpuppet_cluster(score, evidence)
         values ($1, $2::jsonb)
         returning cluster_id`,
        [score, JSON.stringify(candidate)]
      );
      const clusterId = clusterInsert.rows[0].cluster_id;

      // eslint-disable-next-line no-await-in-loop
      await this.pool.query(
        `insert into tiktok_sockpuppet_member(cluster_id, author_id, similarity)
         values ($1,$2,$3),($1,$4,$3)
         on conflict do nothing`,
        [clusterId, candidate.author_a, score, candidate.author_b]
      );

      clusters.push({ clusterId, score, ...candidate });
    }

    logProcess('sockpuppet_detection_completed', { clusters: clusters.length });
    return clusters;
  }

  async exportGraphArtifacts(caseId) {
    const outDir = path.join(env.TIKTOK_ISSUE_HUNTER_WORKDIR, caseId);
    logProcess('graph_export_started', { caseId, outDir });
    await fs.mkdir(outDir, { recursive: true });

    const issuesResult = await this.pool.query(`select * from tiktok_issue order by created_at desc limit 50`);
    const nodes = [];
    const edges = [];

    for (const issue of issuesResult.rows) {
      nodes.push({ id: `Issue:${issue.issue_id}`, label: 'Issue', name: issue.label, burst_score: issue.burst_score });

      const postRows = await this.pool.query(
        `select p.post_id, p.author_id, p.author_username
         from tiktok_issue_map im
         join tiktok_post p on p.post_id = im.post_id
         where im.issue_id = $1`,
        [issue.issue_id]
      );

      for (const post of postRows.rows) {
        nodes.push({ id: `Post:${post.post_id}`, label: 'Post' });
        nodes.push({ id: `Account:${post.author_id}`, label: 'Account', name: post.author_username || post.author_id });
        edges.push({ start: `Account:${post.author_id}`, end: `Post:${post.post_id}`, type: 'POSTED' });
        edges.push({ start: `Post:${post.post_id}`, end: `Issue:${issue.issue_id}`, type: 'IN_ISSUE' });

        const hashtagRows = await this.pool.query(`select hashtag from tiktok_hashtag where post_id = $1`, [post.post_id]);
        for (const hashtagRow of hashtagRows.rows) {
          const tag = hashtagRow.hashtag?.startsWith('#') ? hashtagRow.hashtag : `#${hashtagRow.hashtag}`;
          nodes.push({ id: `Hashtag:${tag}`, label: 'Hashtag', name: tag });
          edges.push({ start: `Post:${post.post_id}`, end: `Hashtag:${tag}`, type: 'HAS_TAG' });
        }
      }
    }

    const uniqNodes = Object.values(nodes.reduce((acc, node) => ({ ...acc, [node.id]: node }), {}));
    const issueJson = path.join(outDir, 'issues.json');
    const nodesCsv = path.join(outDir, 'nodes.csv');
    const edgesCsv = path.join(outDir, 'edges.csv');

    await fs.writeFile(issueJson, JSON.stringify(issuesResult.rows, null, 2));
    await fs.writeFile(nodesCsv, [':ID,:LABEL,name,burst_score', ...uniqNodes.map((node) => `${node.id},${node.label},${node.name || ''},${node.burst_score || ''}`)].join('\n'));
    await fs.writeFile(edgesCsv, [':START_ID,:END_ID,:TYPE', ...edges.map((edge) => `${edge.start},${edge.end},${edge.type}`)].join('\n'));

    logProcess('graph_export_completed', { caseId, issues: issuesResult.rows.length, nodes: uniqNodes.length, edges: edges.length });
    return { outDir, issueJson, nodesCsv, edgesCsv };
  }

  async close() {
    await this.pool.end();
  }
}

async function runTikTokIssueHunter({ keywords, windowMinutes, mode = 'all' }) {
  const parsedKeywords = parseCsv(keywords);
  if (!parsedKeywords.length) {
    throw new Error('Berikan minimal 1 keyword, contoh: !ttissue bansos,pemilu 60');
  }
  if (!env.TIKTOK_RAPIDAPI_KEY) {
    throw new Error('TIKTOK_RAPIDAPI_KEY belum diatur.');
  }

  const safeWindow = clamp(windowMinutes, 15, 1440, 60);
  const safeMode = ['all', 'crawl', 'issue', 'sockpuppet', 'graph'].includes(String(mode).toLowerCase())
    ? String(mode).toLowerCase()
    : 'all';
  logProcess('pipeline_started', { keywords: parsedKeywords, windowMinutes: safeWindow, mode: safeMode });

  const engine = new TikTokIssueHunter();
  try {
    const shouldIngest = safeMode === 'all' || safeMode === 'crawl';
    const shouldIssue = safeMode === 'all' || safeMode === 'issue';
    const shouldSockpuppet = safeMode === 'all' || safeMode === 'sockpuppet';
    const shouldGraph = safeMode === 'all' || safeMode === 'graph';

    const ingestion = shouldIngest
      ? await engine.ingestRecent(parsedKeywords, safeWindow)
      : { inserted: 0, windowMinutes: safeWindow };
    const issues = shouldIssue ? await engine.discoverIssues(safeWindow) : [];
    const actorNetwork = shouldIssue ? await engine.buildActorNetwork(safeWindow) : [];
    const sockpuppetClusters = shouldSockpuppet ? await engine.detectSockpuppet(safeWindow) : [];
    const caseId = `ttissue-${Date.now()}`;
    const exported = shouldGraph
      ? await engine.exportGraphArtifacts(caseId)
      : { outDir: env.TIKTOK_ISSUE_HUNTER_WORKDIR, issueJson: '-', nodesCsv: '-', edgesCsv: '-' };

    logProcess('pipeline_completed', {
      caseId,
      inserted: ingestion.inserted,
      issues: issues.length,
      actorNetworkEdges: actorNetwork.length,
      sockpuppetClusters: sockpuppetClusters.length
    });

    return {
      caseId,
      ingestion,
      issues,
      actorNetwork,
      sockpuppetClusters,
      mode: safeMode,
      exports: exported
    };
  } catch (error) {
    logProcess('pipeline_failed', {
      message: error?.message || String(error),
      stack: error?.stack || null
    });
    throw error;
  } finally {
    await engine.close();
  }
}

module.exports = {
  TikTokIssueHunter,
  runTikTokIssueHunter
};
