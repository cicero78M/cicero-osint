# CICERO Sherlock WhatsApp Bot (Baileys)

Project ini menjalankan perintah Sherlock, Holehe, Maigret, theHarvester, dan Infoga melalui WhatsApp menggunakan Baileys.

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

Script ini akan menginstal Sherlock, Holehe, Maigret, dan Infoga ke `.venv`. Khusus theHarvester diisolasi ke virtualenv terpisah `.venv-theharvester` untuk mencegah konflik dependency dengan Maigret; command yang dipakai aplikasi tetap `./.venv/bin/theHarvester` melalui wrapper.

Khusus theHarvester, installer mengambil source resmi dari repository upstream `laramies/theHarvester` melalui pip VCS (`git+https://github.com/laramies/theHarvester.git`). Secara default, script memilih versi `4.9.2` saat Python host >= 3.12, dan otomatis fallback ke `4.6.0` saat Python host < 3.12 (kompatibel Python 3.9+). Anda bisa override dengan `THEHARVESTER_SOURCE_REPO` dan/atau `THEHARVESTER_VERSION` saat eksekusi setup bila diperlukan. Untuk menjaga kompatibilitas Maigret, dependency `aiohttp-socks` di `.venv` dipin ke `<0.11.0` sesuai requirement Maigret. Setelah proses install, script melakukan validasi eksplisit bahwa command `./.venv/bin/theHarvester` (wrapper ke `.venv-theharvester`) benar-benar executable sebelum lanjut ke verifikasi `--help`.

Catatan penting untuk Infoga: package `infoga` tidak tersedia di PyPI, jadi installer memakai source git (`git+https://github.com/robertswin/Infoga.git`) secara default, dengan mode non-interaktif git (`GIT_TERMINAL_PROMPT=0`).
Jika source `git+https://...` gagal, script otomatis mencoba fallback non-git (arsip publik/codeload) agar tidak bergantung pada `git clone`.

Jika server Anda memakai mirror/private git, override source tetap didukung dengan environment variable berikut saat setup:

Catatan kompatibilitas: repo `robertswin/Infoga` bukan paket pip siap install (tidak memiliki `setup.py`/`pyproject.toml`) dan script utamanya berjalan di Python 2. Installer menyiapkan source + wrapper `./.venv/bin/infoga`; jika host tidak memiliki `python2`/`python2.7`, verifikasi Infoga akan menjadi warning (default `INFOGA_OPTIONAL=true`) dan setup tetap lanjut. Set `INFOGA_OPTIONAL=false` bila Anda ingin setup gagal keras saat Infoga tidak siap.

```bash
INFOGA_SOURCE='https://<mirror-anda>/Infoga.git' ./scripts/setup_sherlock.sh
```

Troubleshooting kredensial Infoga:

### Troubleshooting Infoga

1. **Verifikasi source final yang dipakai installer (`INFOGA_SOURCE`)**
   - Jalankan setup dan perhatikan log source final yang dicoba script (source utama + fallback archive).
   - Jika perlu memaksa source tertentu, set env secara eksplisit saat eksekusi:

   ```bash
   INFOGA_SOURCE='https://github.com/robertswin/Infoga.git' ./scripts/setup_sherlock.sh
   ```

2. **Cek konfigurasi git global yang sering menyebabkan rewrite/auth**

   ```bash
   git config --global --get-regexp 'url\..*insteadof'
   git config --global credential.helper
   ```

   Rule `url.*.insteadof` dapat me-rewrite URL publik (mis. ke host private) sehingga installer meminta auth meskipun source terlihat publik.

3. **Bypass cepat per-eksekusi setup (nonaktifkan prompt git)**
   - Jalankan installer dengan env non-interaktif git (sesuai implementasi script):

   ```bash
   GIT_TERMINAL_PROMPT=0 ./scripts/setup_sherlock.sh
   ```

   Ini mencegah prompt kredensial interaktif menggantung saat ada masalah autentikasi/akses.

4. **Gunakan mirror internal sebagai jalur produksi**
   - Jika akses GitHub langsung dibatasi oleh kebijakan jaringan/egress, arahkan installer ke mirror internal:

   ```bash
   INFOGA_SOURCE='https://<mirror-internal-anda>/Infoga.git' ./scripts/setup_sherlock.sh
   ```

   Pendekatan ini direkomendasikan untuk environment produksi yang wajib lewat repository internal.

Lalu ubah `.env` agar command Sherlock, Holehe, Maigret, theHarvester, dan Infoga memakai virtualenv (default binary):

```env
SHERLOCK_CMD=./.venv/bin/sherlock
HOLEHE_CMD=./.venv/bin/holehe
MAIGRET_CMD=./.venv/bin/maigret
THEHARVESTER_CMD=./.venv/bin/theHarvester
THEHARVESTER_SOURCES=crtsh,bing,duckduckgo,yahoo
THEHARVESTER_LIMIT=500
THEHARVESTER_DNS_BRUTE=true
INFOGA_CMD=./.venv/bin/infoga
INFOGA_OPTIONAL=true
```

Nilai di atas harus sama dengan output `Final command (.env)` dari `./scripts/setup_sherlock.sh` agar preflight saat startup tidak gagal karena binary tidak ditemukan. Khusus Infoga, startup default tidak memblokir proses saat Infoga tidak siap (`INFOGA_OPTIONAL=true`) dan hanya menulis warning di log.


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
- `!ping`
- `!sherlock <username>`
- `!holehe <email>`
- `!maigret <username>`
- `!theharvester <domain>`
- `!infoga <email|domain>`
- `!exif` (reply gambar)

Contoh:

```text
!sherlock johndoe
!holehe target@email.com
!maigret johndoe
!theharvester example.com
!infoga target@email.com
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
