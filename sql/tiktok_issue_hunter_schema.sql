-- TikTok Issue Hunter schema (RapidAPI tiktok-api23 pipeline)
create table if not exists tiktok_post (
  post_id text primary key,
  author_id text not null,
  author_username text,
  created_at timestamptz not null,
  text text,
  like_count int,
  comment_count int,
  share_count int,
  play_count int,
  raw jsonb
);

create table if not exists tiktok_hashtag (
  post_id text references tiktok_post(post_id) on delete cascade,
  hashtag text not null,
  primary key (post_id, hashtag)
);

create table if not exists tiktok_issue (
  issue_id bigserial primary key,
  label text,
  created_at timestamptz default now(),
  window_start timestamptz,
  window_end timestamptz,
  size int,
  burst_score numeric,
  top_entities jsonb
);

create table if not exists tiktok_issue_map (
  issue_id bigint references tiktok_issue(issue_id) on delete cascade,
  post_id text references tiktok_post(post_id) on delete cascade,
  primary key (issue_id, post_id)
);

create index if not exists idx_tiktok_post_created_at on tiktok_post(created_at);
create index if not exists idx_tiktok_post_author_id on tiktok_post(author_id);
create index if not exists idx_tiktok_issue_created_at on tiktok_issue(created_at);
create index if not exists idx_tiktok_hashtag_tag on tiktok_hashtag(hashtag);


create table if not exists tiktok_mention (
  post_id text references tiktok_post(post_id) on delete cascade,
  mention text not null,
  primary key (post_id, mention)
);

create table if not exists tiktok_author (
  author_id text primary key,
  username text,
  follower_count int,
  following_count int,
  video_count int,
  raw jsonb
);

create table if not exists tiktok_post_keyword (
  post_id text references tiktok_post(post_id) on delete cascade,
  keyword text not null,
  created_at timestamptz default now(),
  primary key (post_id, keyword)
);

create table if not exists tiktok_sockpuppet_cluster (
  cluster_id bigserial primary key,
  created_at timestamptz default now(),
  score numeric,
  evidence jsonb
);

create table if not exists tiktok_sockpuppet_member (
  cluster_id bigint references tiktok_sockpuppet_cluster(cluster_id) on delete cascade,
  author_id text,
  similarity numeric,
  primary key (cluster_id, author_id)
);

create index if not exists idx_tiktok_mention_value on tiktok_mention(mention);
create index if not exists idx_tiktok_author_username on tiktok_author(username);
create index if not exists idx_tiktok_post_keyword_keyword on tiktok_post_keyword(keyword);
