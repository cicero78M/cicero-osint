# Twitter/X Issue Hunter Engine (Jatim-focused)

Implementasi ini menambahkan skeleton engine `Twitter/X Issue Hunter` berbasis **X API v2 resmi** (tanpa scraping) untuk kebutuhan:

1. discovery issue cluster,
2. burst/trend detection,
3. actor network mapping,
4. narrative timeline,
5. export graph untuk Neo4j/Graph DB.

## Service split

- `x-ingestor` (Node/JS): `src/services/twitterIssueHunter.js`
  - real-time `filtered stream`
  - batch `recent search`
  - simpan ke PostgreSQL (`x_post`, `x_author`, `x_hashtag`, `x_mention`, `x_url`)
- `x-processor` (Python skeleton): `scripts/x-processor/processor.py`
  - embedding multilingual
  - clustering HDBSCAN
  - label issue + burst scoring
- `x-graph` (Node/JS): method `exportGraphArtifacts`
  - export `issues.json`, `nodes.csv`, `edges.csv`
- `x-alerts` (integrasi lanjutan)
  - trigger alert berbasis `burst_score` + lonjakan akun unik.

## Fokus wilayah Jawa Timur (Jatim)

Query default otomatis menambahkan region terms:

- `"jawa timur"`, `jatim`, `surabaya`, `malang`, `sidoarjo`, dst.

Sehingga isu dilokalisasi untuk pipeline monitoring Jatim.

## WhatsApp command baru

```text
!xissue <keyword_csv> <window_menit(15-1440)|60>
```

Contoh:

```text
!xissue bansos,pilkada,jalanrusak 60
```

## Prasyarat env

Tambahkan ke `.env`:

```env
X_BEARER_TOKEN=...
PG_URL=postgres://user:pass@host:5432/db
X_ISSUE_HUNTER_WORKDIR=./runtime/x-issue-hunter
```

## SQL schema

Jalankan file:

```bash
psql "$PG_URL" -f sql/x_issue_hunter_schema.sql
```

## Output artifacts

Per eksekusi case, engine menulis:

- `issues.json`
- `nodes.csv`
- `edges.csv`

Semua file berada di:

- `runtime/x-issue-hunter/<case-id>/`

## Catatan produksi

- Endpoint X API v2 yang dipakai:
  - `/2/tweets/search/recent`
  - `/2/tweets/search/stream`
  - `/2/tweets/search/stream/rules`
- Retry 429 menggunakan exponential backoff di `requestWithRetry`.
- Untuk throughput tinggi, disarankan queue worker (BullMQ/Redis) untuk write & processing asynchronous.
