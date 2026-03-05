# CICERO Sherlock WhatsApp Bot (Baileys)

Project ini menjalankan perintah Sherlock, Holehe, Maigret, Instaloader, dan theHarvester melalui WhatsApp menggunakan Baileys.

## 1) Prasyarat Server (Ubuntu)

- Node.js 18+
- Python 3.10+
- git
- pm2
- exiftool

```bash
sudo apt update
sudo apt install -y git curl python3 python3-venv python3-pip exiftool
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2) Setup Project

```bash
git clone <repo-anda> cicero-sherlock-wa-bot
cd cicero-sherlock-wa-bot
npm install
cp .env.example .env
```

## 3) Install OSINT dependencies (Python tools)

```bash
./scripts/setup_sherlock.sh
```

Script ini akan menginstal Sherlock, Holehe, Maigret, dan Instaloader ke `.venv`. Khusus theHarvester diisolasi ke virtualenv terpisah `.venv-theharvester` untuk mencegah konflik dependency dengan Maigret; command yang dipakai aplikasi tetap `./.venv/bin/theHarvester` melalui wrapper.

Khusus theHarvester, installer mengambil source resmi dari repository upstream `laramies/theHarvester` melalui pip VCS (`git+https://github.com/laramies/theHarvester.git`). Secara default, script memilih versi `4.9.2` saat Python host >= 3.12, dan otomatis fallback ke `4.6.0` saat Python host < 3.12 (kompatibel Python 3.9+). Anda bisa override dengan `THEHARVESTER_SOURCE_REPO` dan/atau `THEHARVESTER_VERSION` saat eksekusi setup bila diperlukan. Untuk menjaga kompatibilitas Maigret, dependency `aiohttp-socks` di `.venv` dipin ke `<0.11.0` sesuai requirement Maigret. Setelah proses install, script melakukan validasi eksplisit bahwa command `./.venv/bin/theHarvester` (wrapper ke `.venv-theharvester`) benar-benar executable sebelum lanjut ke verifikasi `--help`.

Jika lokasi executable EXIFTool berbeda dari default, set override pada `.env`:

```env
EXIFTOOL_CMD=exiftool
```

## 4) Jalankan bot

```bash
npm start
```

- Saat pertama kali jalan, QR akan tampil di terminal.
- Scan dari WhatsApp utama (Linked Devices).

## 5) Daftar perintah WA

- `!help`
- `!minim <domain|-> <email_csv|-> <username_csv|->` (mini-Maltego OSINT + export JSON/Neo4j CSV)
- `!ping`
- `!socmint <handle_csv|-> <email_csv|-> <link_csv|-> <keyword_csv|-> <hashtag_csv|->` (social media information gathering: identity + sockpuppet + issue mapping)
- `!xissue <keyword_csv> <window_menit(15-1440)|60>` (Twitter/X Issue Hunter Jatim: clustering issue + burst + network export)
- `!ttmenu` (lihat submenu TikTok Issue Hunter)
- `!ttissue <keyword_csv> <window_menit(15-1440)|60>` (default submenu `all`)
- `!ttissue <submenu:all|crawl|issue|sockpuppet|graph> <keyword_csv> <window_menit(15-1440)|60>`
- `!sherlock <username>`
- `!holehe <email>`
- `!maigret <username>`
- `!instaloader <username>`
- `!theharvester <domain>`
- `!dorkdoc <keyword>` (alias: `!dork`, mode cepat pencarian luas tanpa batasan filetype)
- `!dorkdoc <keyword> <target|-> <domain|-> <tipe_dokumen|->` (mode lengkap)
- `!exif` (reply gambar)

Contoh:

```text
!sherlock johndoe
!holehe target@email.com
!maigret johndoe
!instaloader johndoe
!theharvester example.com
!dorkdoc 3575022502870001
!dorkdoc payroll login example.com pdf
!dork breach invoice - -
!socmint cicero_admin,cicero.ops - linktr.ee/cicero pemilu,bansos #pemilu,#politik
```

### Tuning theHarvester (default lebih tajam)

Service `!theharvester` sekarang otomatis menjalankan parameter berikut agar hasil subdomain lebih kaya:

- `-b crtsh,bing,duckduckgo,yahoo`
- `-l 500`
- `-c` (DNS brute)
- `-f <report_prefix>` (theHarvester menulis report bawaan `.json/.xml/.html` sesuai versi)

Jika ingin override tanpa ubah kode, pakai environment variable:

```env
THEHARVESTER_SOURCES=crtsh,bing,duckduckgo,yahoo
THEHARVESTER_LIMIT=500
THEHARVESTER_DNS_BRUTE=true
```

### Konfigurasi preset Google Dork

Preset tipe dokumen dan default domain Google Dork dikontrol via environment variable berikut:

```env
GOOGLE_DORK_DOC_TYPES=pdf,doc,docx,xls,xlsx,ppt,pptx
GOOGLE_DORK_DEFAULT_SITE=
GOOGLE_DORK_MAX_RESULTS=20
```

Aturan format:

- `GOOGLE_DORK_DOC_TYPES` memakai format CSV.
- Setiap item otomatis dinormalisasi (trim, lowercase, item kosong dibuang).
- Contoh input yang tetap valid: `PDF, ,DOCX` → `pdf,docx`.
- `GOOGLE_DORK_DEFAULT_SITE` opsional. Jika diisi, command `!dorkdoc` bisa memakai `-` pada argumen domain agar otomatis pakai default site.
- `GOOGLE_DORK_MAX_RESULTS` menentukan jumlah maksimum URL hasil Google yang diproses (tidak dibatasi 3).

Contoh command dengan preset:

```text
!dorkdoc 3575022502870001
!dorkdoc payroll login example.com pdf
!dork payroll login - -
```

Pada contoh pertama, bot otomatis memakai preset cepat (pencarian luas tanpa filter filetype).
Pada mode lengkap, isi `-` pada `target`/`domain` jika ingin menonaktifkan filter tersebut. Domain `-` akan memakai `GOOGLE_DORK_DEFAULT_SITE` bila variabel itu di-set.

Fitur `dorkdoc/dork` sekarang mendukung pencarian lebih luas lintas tipe dokumen. Setelah query dibentuk, service akan:

1. Mengambil URL hasil Google hingga batas `GOOGLE_DORK_MAX_RESULTS` (diprioritaskan sesuai filetype bila filetype diisi).
2. Mengunduh setiap URL hasil, lalu mencoba ekstraksi konten berdasarkan tipe data (Excel/CSV/text/HTML/JSON/XML).
3. Menyaring data relevan berdasarkan keyword/target dan menampilkan ringkasan hasil dalam format laporan teks profesional.

Contoh manual run di server:

```bash
./.venv/bin/theHarvester -d papiqo.com -b crtsh -l 500
./.venv/bin/theHarvester -d papiqo.com -b crtsh,bing,duckduckgo,yahoo -l 500 -f ./runtime/theharvester/papiqo_com-latest
./.venv/bin/theHarvester -d papiqo.com -b crtsh -l 500 -c
```

## 6) Jalankan via PM2 (Production)

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 7) Catatan keamanan

- Jangan pakai username dari user tanpa validasi (sudah divalidasi di service).
- Akses command tidak dibatasi berdasarkan JID owner (semua chat yang masuk bisa diproses command).
- Simpan folder `session/` dengan permission ketat.

## 8) Runbook insiden WhatsApp session/key drift

Jika PM2 log menunjukkan error dekripsi/session seperti `PreKeyError` atau `Invalid PreKey ID`, gunakan urutan mitigasi berikut.

1. **Verifikasi gejala di PM2 log**
   - Cari field terstruktur berikut pada log: `remoteJid`, `id`, `retryCount`, `recoveryAction`.
   - Jika `recoveryAction=persist-creds-and-reconnect`, sistem sudah mencoba pemulihan terkendali (persist creds + reconnect bertahap).
   - Jika `recoveryAction=throttled-prekey-recovery`, artinya satu chat/session sudah melewati ambang retry dan reconnect ditahan untuk mencegah loop.

2. **Tunggu auto-recovery terlebih dahulu**
   - Bot sudah menerapkan backoff reconnect dan throttle per chat/session.
   - Jangan langsung restart berulang kali karena bisa memperparah drift key.

3. **Tindakan operator (jika tetap gagal setelah beberapa menit)**
   - Lakukan restart terkontrol service PM2:

   ```bash
   pm2 restart ecosystem.config.js --only cicero-sherlock-wa-bot
   ```

4. **Last resort: rotasi/hapus session store (`SESSION_DIR`)**
   - Gunakan langkah ini **hanya jika error dekripsi persisten** dan auto-recovery + restart terkontrol gagal.
   - Backup dulu isi session agar bisa dianalisis:

   ```bash
   cp -a "$SESSION_DIR" "${SESSION_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
   ```

   - Hapus session store lalu jalankan ulang service:

   ```bash
   rm -rf "$SESSION_DIR"
   pm2 restart ecosystem.config.js --only cicero-sherlock-wa-bot
   ```

   - Scan QR ulang pada WhatsApp Linked Devices.


### Mini-Maltego OSINT menu

Perintah baru untuk scan gabungan domain + email + social dengan heuristik sockpuppet ringan:

```text
!minim example.com admin@example.com,security@example.com cicero_admin,cicero.ops
!minim example.com - john,doe
!minim - admin@example.com -
```

Output otomatis disimpan di `runtime/mini-maltego/<case-id>/` dengan artefak:

- `graph.json`
- `neo4j_nodes.csv`
- `neo4j_edges.csv`

Environment variable opsional:

```env
MINI_MALTEGO_WORKDIR=./runtime/mini-maltego
MINI_MALTEGO_TIMEOUT_MS=15000
MINI_MALTEGO_MAX_OUTPUT_CHARS=3500
MINI_MALTEGO_USER_AGENT=mini-maltego-osint/1.0
MINI_MALTEGO_SOCIAL_SITES=[{"name":"GitHub","url_template":"https://github.com/{username}"},{"name":"Instagram","url_template":"https://www.instagram.com/{username}/"},{"name":"TikTok","url_template":"https://www.tiktok.com/@{username}"},{"name":"X","url_template":"https://x.com/{username}"},{"name":"YouTube","url_template":"https://www.youtube.com/@{username}"}]
```

```env
X_BEARER_TOKEN=
PG_URL=postgres://user:pass@host:5432/db
X_ISSUE_HUNTER_WORKDIR=./runtime/x-issue-hunter
TIKTOK_RAPIDAPI_KEY=
TIKTOK_RAPIDAPI_HOST=tiktok-api23.p.rapidapi.com
TIKTOK_RAPIDAPI_BASE_URL=https://tiktok-api23.p.rapidapi.com
TIKTOK_RAPIDAPI_SEARCH_PATH=/api/search/video
TIKTOK_RAPIDAPI_MAX_COUNT=20
TIKTOK_ISSUE_HUNTER_WORKDIR=./runtime/tiktok-issue-hunter
```

### Twitter/X Issue Hunter (Jatim)

Perintah:

```text
!xissue bansos,pilkada,jalanrusak 60
```

Pipeline memakai X API v2 resmi (filtered stream/recent search), tanpa scraping, dan mengekspor artefak graph:

- `issues.json`
- `nodes.csv`
- `edges.csv`

Skema PostgreSQL tersedia di `sql/x_issue_hunter_schema.sql`.
Dokumentasi implementasi ada di `docs/twitter-issue-hunter.md`.

### TikTok Issue Hunter (Jatim via RapidAPI)

Perintah:

```text
!ttmenu
!ttissue bansos,pilkada,jalanrusak 60
!ttissue sockpuppet bansos,pilkada,jalanrusak 60
```

Pipeline memakai RapidAPI `tiktok-api23` (`/api/search/video`) dan mengekspor artefak graph:

- `issues.json`
- `nodes.csv`
- `edges.csv`

Skema PostgreSQL tersedia di `sql/tiktok_issue_hunter_schema.sql`.
Dokumentasi implementasi ada di `docs/tiktok-issue-hunter.md`.


### Social Media Information Gathering menu

Menu `!socmint` menjalankan orkestrasi mini-Maltego khusus social-media dengan 3 jalur paralel:

1. **Identity & Account Discovery**: Sherlock (broad sweep) -> Maigret (validasi).
2. **Sockpuppet Correlation Engine**: scoring confidence + reason codes (`same_bio_link`, `handle_pattern`, `exists_signal_only`, dst).
3. **Issue Mapping**: buat graph issue dari seed keyword/hashtag untuk pemetaan narasi awal.

Format command:

```text
!socmint <handle_csv|-> <email_csv|-> <link_csv|-> <keyword_csv|-> <hashtag_csv|->
```

Contoh:

```text
!socmint john_doe,jane_doe - linktr.ee/john pemilu,bansos #pemilu,#politik
!socmint - admin@example.com example.org hoax,disinformasi #breaking
```

Output tersimpan ke folder:

- `runtime/mini-maltego/social-media/<case-id>/social-media-intel.json`

Skema output utama:

- `entities_account`
- `entities_issue_cluster`
- `edges` (`LIKELY_SAME_OPERATOR`, `POSTS_ABOUT`, dll)
- `evidence_store` (tool, raw_path, timestamp, extracted_json)
