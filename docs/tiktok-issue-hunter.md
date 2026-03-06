# TikTok Issue Hunter Engine (Jatim-focused)

Implementasi ini menambahkan engine `TikTok Issue Hunter` berbasis **RapidAPI tiktok-api23** untuk kebutuhan:

1. discovery issue cluster,
2. burst/trend detection,
3. actor network mapping,
4. export graph untuk Neo4j/Graph DB,
5. realtime narrative tracking (RTNT) untuk deteksi burst, drift, dan takeover narasi.

## Service split

- `tt-ingestor` (Node/JS): `src/services/tiktokIssueHunter.js`
  - batch `search video` via RapidAPI endpoint
  - simpan ke PostgreSQL (`tiktok_post`, `tiktok_hashtag`)
- `tt-processor` (Node/JS): method `discoverIssues`
  - tokenisasi + clustering similarity sederhana
  - issue labeling + burst scoring
- `tt-rtnt` (Node/JS): method `runRealtimeNarrativeTracker`
  - assign post ke `tiktok_narrative` (centroid sparse-vector)
  - update `tiktok_narrative_window` (window 5-15 menit)
  - deteksi event `BURST`, `DRIFT`, `TAKEOVER`
  - publish event via `tiktok_narrative_event` + `pg_notify`
- `tt-graph` (Node/JS): method `exportGraphArtifacts`
  - export `issues.json`, `nodes.csv`, `edges.csv`

## Fokus wilayah Jawa Timur (Jatim)

Filter otomatis memprioritaskan konten dengan term regional Jatim:

- `jawa timur`, `jatim`, `surabaya`, `malang`, `sidoarjo`, dst.

Sehingga issue yang diproses tetap relevan untuk pipeline monitoring Jatim.

## WhatsApp command + submenu

```text
!ttmenu
!ttissue <keyword_csv> <window_menit(15-1440)|60>
!ttissue <submenu:all|crawl|issue|sockpuppet|graph|narrative|rtnt> <keyword_csv> <window_menit(15-1440)|60>
```

Contoh:

```text
!ttissue bansos,pilkada,jalanrusak 60
!ttissue crawl polisi,tilang,surabaya 60
!ttissue sockpuppet bansos,pilkada 120
!ttissue narrative polisi,tilang,surabaya 60
```

## Prasyarat env

Tambahkan ke `.env`:

```env
TIKTOK_RAPIDAPI_KEY=...
TIKTOK_RAPIDAPI_HOST=tiktok-api23.p.rapidapi.com
TIKTOK_RAPIDAPI_BASE_URL=https://tiktok-api23.p.rapidapi.com
TIKTOK_RAPIDAPI_SEARCH_PATH=/api/search/video
TIKTOK_RAPIDAPI_MAX_COUNT=20
PG_URL=postgres://user:pass@host:5432/db
TIKTOK_ISSUE_HUNTER_WORKDIR=./runtime/tiktok-issue-hunter
```

## SQL schema

Jalankan file:

```bash
psql "$PG_URL" -f sql/tiktok_issue_hunter_schema.sql
```

## Output artifacts

Untuk mode `narrative/rtnt`, output utama ada di database:

- `tiktok_narrative` (state narasi aktif),
- `tiktok_narrative_map` (mapping post→narrative),
- `tiktok_narrative_window` (time-series metrics),
- `tiktok_narrative_event` (audit event realtime).


Per eksekusi case, engine menulis:

- `issues.json`
- `nodes.csv`
- `edges.csv`

Semua file berada di:

- `runtime/tiktok-issue-hunter/<case-id>/`

## Catatan produksi

- Endpoint RapidAPI yang dipakai default:
  - `GET /api/search/video`
- Retry `429` menggunakan exponential backoff di `requestWithRetry`.
- Untuk throughput tinggi, disarankan worker async berbasis queue (Redis/BullMQ) untuk pemrosesan lanjutan.

## Sockpuppet detection

Engine menilai kandidat akun berdasarkan:

- overlap hashtag
- kedekatan waktu posting (<= 5 menit)

Hasil disimpan ke tabel `tiktok_sockpuppet_cluster` dan `tiktok_sockpuppet_member`.
