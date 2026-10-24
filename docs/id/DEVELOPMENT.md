# Pengembangan

[English](../DEVELOPMENT.md)

## Kebutuhan

- Node.js 24 atau lebih baru
- Git
- Untuk membangun installer: platform target itu sendiri (Windows untuk `.exe`, macOS untuk `.dmg`, Linux untuk `.deb`/`.rpm`/`.AppImage`). Lintas-platform ditangani GitHub Actions, lihat [RELEASING.md](RELEASING.md).

## Menjalankan

```bash
npm ci
npm start           # Electron: jendela, tray, notifikasi
npm run start:web   # server + UI saja, http://127.0.0.1:18765
```

Data lokal pengembangan (`.data/`, `downloads/`) tidak masuk git. Setel `ZIVAR_DESKTOP_DATA_DIR` dan
`ZIVAR_DESKTOP_DOWNLOAD_DIR` untuk memakai folder lain.

## Pengujian

```bash
npm test                          # unit test: node --test tests/*.test.mjs
node scripts/<nama>-smoke.mjs     # smoke test dengan browser/Electron sungguhan
```

Smoke test membuka Chromium, Electron, atau Firefox sungguhan dan menyimpan keluaran di `artifacts/`.
Sebagian dirancang untuk Windows. Persiapan sekali saja:

```bash
node node_modules/electron/install.js                           # binary Electron
cd .tools/browser-test && node node_modules/playwright-core/cli.js install chromium
```

Catatan: pada Chromium terbaru, Playwright mengambil alih penanganan download lewat DevTools sehingga
`chrome.downloads.onDeterminingFilename` tidak terpanggil dan ekstensi tidak sempat mencegat download.
`scripts/extension-smoke.mjs` lebih dulu memanggil `Browser.setDownloadBehavior` dengan `behavior: 'default'` lewat
sesi CDP; lakukan hal yang sama pada tes baru yang menguji pencegatan download.
Beberapa smoke test (`desktop-smoke`, `video-overlay-smoke`) bergantung pada waktu dan kadang perlu diulang.

## Helper yang dibundel

Installer membawa yt-dlp, runtime Node untuk yt-dlp, dan FFmpeg di folder `resources`.

- **Windows:** `node scripts/ensure-vendor-binaries.mjs` (dipanggil otomatis oleh `npm run build:win`) mengunduh versi yang dipatok dan memeriksa hash-nya.
- **macOS dan Linux:** `build/fetch-vendor.mjs` mengambil rilis terbaru yt-dlp, runtime Node yang sama dengan Node Anda, dan FFmpeg dari `ffmpeg-static`:

```bash
npm install --no-save ffmpeg-static
node build/fetch-vendor.mjs        # tambahkan --force untuk mengunduh ulang
```

Skrip memverifikasi SHA-256 yt-dlp dan Node. Variabel `ZIVAR_FFMPEG_PATH` (path absolut) menimpa lokasi FFmpeg.

## Membangun installer

```bash
npm run build:win
npm run build:mac     # di macOS
npm run build:linux   # di Linux
```

Hasil ada di `dist/`. Konfigurasi: [build/electron-builder.yml](../../build/electron-builder.yml).

## Ikon dan logo

Sumber logo: [docs/assets/logo.svg](../assets/logo.svg). Dari sana dibuat `desktop/assets/app.{png,ico,icns}`,
`app-1024.png`, dan `extension/icon-*.png`. Untuk membuat ulang semuanya setelah mengubah SVG:

```bash
pip install pillow
python scripts/create-app-icon.py "<path ke msedge.exe atau chrome>"
```

## Ekstensi browser

`extension/` dapat dimuat langsung lewat **Load unpacked**. Daftar tipe file dan situs bawaan ada di dua
tempat, `extension/background.js` dan `app/manager.mjs`; `tests/browser-rules.test.mjs` memastikan keduanya sama,
jadi ubah keduanya sekaligus.

## Bahasa

Antarmuka berbahasa Inggris secara bawaan dengan terjemahan Indonesia. Teks berada di empat tempat yang harus selalu seiring: `app/public/i18n.js` (aplikasi), `extension/i18n.js` (ekstensi), `desktop/strings.mjs` (tray, notifikasi, dialog), dan `app/messages.mjs` (pesan mesin yang tampil ke pengguna). `tests/i18n.test.mjs` gagal jika ada kunci yang hilang di salah satu bahasa, kunci yang dipakai tidak ada, atau pesan mesin tanpa terjemahan Inggris.

## Gaya kode

Ikuti gaya berkas di sekitarnya: ES module (`.mjs`), tanpa dependensi runtime tambahan, teks antarmuka lewat
kamus di atas (jangan ditulis langsung), komentar singkat yang menjelaskan alasan.
