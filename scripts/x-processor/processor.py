"""Twitter/X Issue Hunter processor skeleton.

Flow:
1) pull posts from PostgreSQL window
2) embed multilingual text (sentence-transformers)
3) cluster with HDBSCAN
4) label cluster (c-TF-IDF style)
5) burst score vs baseline 7d
6) write x_issue and x_issue_map
"""

from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import psycopg

try:
    from sentence_transformers import SentenceTransformer
    import hdbscan
except Exception:  # optional runtime dependency for skeleton
    SentenceTransformer = None
    hdbscan = None


@dataclass
class PostRow:
    post_id: str
    author_id: str
    created_at: datetime
    text: str


class XProcessor:
    def __init__(self) -> None:
        self.pg_url = os.getenv("PG_URL")
        if not self.pg_url:
            raise RuntimeError("PG_URL harus di-set.")

        model_name = os.getenv("X_EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
        self.model = SentenceTransformer(model_name) if SentenceTransformer else None

    def _get_conn(self):
        return psycopg.connect(self.pg_url)

    def load_posts(self, window_minutes: int = 60) -> list[PostRow]:
        with self._get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                select post_id, author_id, created_at, text
                from x_post
                where created_at >= now() - (%s::int || ' minutes')::interval
                order by created_at asc
                """,
                (window_minutes,),
            )
            return [PostRow(*row) for row in cur.fetchall()]

    def embed(self, posts: list[PostRow]):
        if not self.model:
            raise RuntimeError("sentence-transformers belum terpasang.")
        texts = [p.text for p in posts]
        return self.model.encode(texts, normalize_embeddings=True)

    def cluster(self, vectors):
        if not hdbscan:
            raise RuntimeError("hdbscan belum terpasang.")
        model = hdbscan.HDBSCAN(min_cluster_size=5, min_samples=2)
        return model.fit_predict(vectors)

    def label_clusters(self, posts: list[PostRow], labels):
        grouped: dict[int, list[PostRow]] = defaultdict(list)
        for post, label in zip(posts, labels):
            if label >= 0:
                grouped[int(label)].append(post)

        output = {}
        for cluster_id, items in grouped.items():
            tokens = []
            for item in items:
                tokens.extend(w.lower() for w in item.text.split() if len(w) > 3)
            top = [word for word, _ in Counter(tokens).most_common(8)]
            output[cluster_id] = {
                "label": " | ".join(top[:5]) or f"cluster-{cluster_id}",
                "post_ids": [i.post_id for i in items],
                "size": len(items),
            }
        return output

    def compute_burst(self, keyword_tokens: list[str], current_size: int) -> float:
        if not keyword_tokens:
            return float(current_size)

        with self._get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int
                from x_post
                where created_at between now() - interval '7 day' and now() - interval '1 day'
                  and text ilike any(%s)
                """,
                ([f"%{token}%" for token in keyword_tokens],),
            )
            baseline = cur.fetchone()[0] or 1
        return round(current_size / max(1, baseline), 3)

    def persist(self, cluster_data: dict[int, dict], window_minutes: int = 60):
        with self._get_conn() as conn, conn.cursor() as cur:
            for data in cluster_data.values():
                tokens = data["label"].split(" | ")
                burst_score = self.compute_burst(tokens, data["size"])
                cur.execute(
                    """
                    insert into x_issue(label, window_start, window_end, size, burst_score, top_entities, top_hashtags, top_domains)
                    values (
                      %s,
                      now() - (%s::int || ' minutes')::interval,
                      now(),
                      %s,
                      %s,
                      %s::jsonb,
                      '[]'::jsonb,
                      '[]'::jsonb
                    )
                    returning issue_id
                    """,
                    (data["label"], window_minutes, data["size"], burst_score, json.dumps(tokens)),
                )
                issue_id = cur.fetchone()[0]
                for post_id in data["post_ids"]:
                    cur.execute(
                        "insert into x_issue_map(issue_id, post_id) values (%s, %s) on conflict do nothing",
                        (issue_id, post_id),
                    )
            conn.commit()


if __name__ == "__main__":
    processor = XProcessor()
    window = int(os.getenv("X_PROCESSOR_WINDOW_MIN", "60"))
    posts = processor.load_posts(window)
    if not posts:
        print("No posts in window")
        raise SystemExit(0)

    vectors = processor.embed(posts)
    labels = processor.cluster(vectors)
    cluster_data = processor.label_clusters(posts, labels)
    processor.persist(cluster_data, window)
    print(f"Processed {len(posts)} posts, clusters={len(cluster_data)}")
