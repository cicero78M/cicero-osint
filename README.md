# CICERO Sherlock WhatsApp Bot (Baileys)

Project ini menjalankan perintah Sherlock, Holehe, dan Maigret melalui WhatsApp menggunakan Baileys.

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

## 3) Install Sherlock

```bash
./scripts/setup_sherlock.sh
```

Lalu ubah `.env` agar command Sherlock, Holehe, dan Maigret memakai virtualenv:

```env
SHERLOCK_CMD=./.venv/bin/sherlock
HOLEHE_CMD=./.venv/bin/holehe
MAIGRET_CMD=./.venv/bin/maigret
```

Nilai di atas harus sama dengan output `Final command (.env)` dari `./scripts/setup_sherlock.sh` agar tidak terjadi instruksi campur untuk operator.


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

Contoh:

```text
!sherlock johndoe
!holehe target@email.com
!maigret johndoe
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
