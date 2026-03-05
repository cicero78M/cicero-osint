-- Twitter/X Issue Hunter schema (official X API v2 pipeline)
create table if not exists x_post (
  post_id text primary key,
  author_id text not null,
  created_at timestamptz not null,
  lang text,
  text text,
  like_count int,
  reply_count int,
  repost_count int,
  quote_count int,
  raw jsonb
);

create table if not exists x_author (
  author_id text primary key,
  username text,
  name text,
  verified boolean,
  followers_count int,
  following_count int,
  raw jsonb
);

create table if not exists x_hashtag (
  post_id text references x_post(post_id) on delete cascade,
  hashtag text not null,
  primary key (post_id, hashtag)
);

create table if not exists x_mention (
  post_id text references x_post(post_id) on delete cascade,
  mentioned_username text not null,
  primary key (post_id, mentioned_username)
);

create table if not exists x_url (
  post_id text references x_post(post_id) on delete cascade,
  url text not null,
  domain text,
  primary key (post_id, url)
);

create table if not exists x_post_embedding (
  post_id text primary key references x_post(post_id) on delete cascade,
  dim int not null,
  vector jsonb not null,
  model text not null,
  created_at timestamptz default now()
);

create table if not exists x_issue (
  issue_id bigserial primary key,
  label text,
  created_at timestamptz default now(),
  window_start timestamptz,
  window_end timestamptz,
  size int,
  burst_score numeric,
  top_hashtags jsonb,
  top_domains jsonb,
  top_entities jsonb
);

create table if not exists x_issue_map (
  issue_id bigint references x_issue(issue_id) on delete cascade,
  post_id text references x_post(post_id) on delete cascade,
  primary key (issue_id, post_id)
);

create index if not exists idx_x_post_created_at on x_post(created_at);
create index if not exists idx_x_post_author_id on x_post(author_id);
create index if not exists idx_x_issue_created_at on x_issue(created_at);
create index if not exists idx_x_hashtag_tag on x_hashtag(hashtag);
create index if not exists idx_x_url_domain on x_url(domain);
