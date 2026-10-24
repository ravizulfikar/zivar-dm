# Changelog

[English](CHANGELOG.md)

Semua perubahan penting pada ZIVAR Download Manager dicatat di file ini.

## [0.18.1] - 2026-10-25

### Diperbaiki

- Chrome tidak lagi menampilkan "Cannot create item with duplicate id zivar-download" dari ekstensi. Menu klik kanan sebelumnya dibangun ulang dari beberapa tempat sekaligus (saat dipasang, saat dimulai, dan saat bahasa berganti); kini pembangunan ulang berjalan berurutan.

## [0.18.0] - 2026-10-25

### Ditambahkan

- Bahasa Inggris sebagai bawaan, dengan sakelar EN/ID di sidebar. Berlaku untuk aplikasi, ekstensi browser, serta notifikasi dan dialog desktop. Pilihan disimpan di pengaturan dan diikuti ekstensi.
- Dialog Tentang: logo, versi, sistem, mesin (Electron/Chromium/Node), versi extractor YouTube, pengembang, situs https://zivar.my.id, dan lisensi.
- Pembaruan di dalam aplikasi: periksa, unduh, verifikasi SHA-256, lalu pasang dengan satu klik. Opsi "Unduh pembaruan secara otomatis" aktif secara bawaan, dan titik penanda muncul di samping versi saat pembaruan tersedia atau siap.
- Pembaruan mengenali cara ZIVAR dipasang: installer Windows, versi portable, DMG macOS, AppImage, serta paket `.deb` dan `.rpm`.
- `latest.json` kini memuat varian portable, `.deb`, dan `.rpm`.
- Pesan dari mesin (galat unduhan, YouTube, FFmpeg) diterjemahkan ke bahasa Inggris saat bahasa antarmuka Inggris, dengan tes yang mencegah ada pesan baru yang terlewat.

### Diubah

- Antarmuka dirancang ulang: sidebar dengan navigasi dan kategori, kartu unduhan dengan progress bar, ringkasan kecepatan/aktif/menunggu/selesai, dan menu urutkan. Warna diambil dari logo (teal ke indigo) dengan tema gelap dan terang (mengikuti sistem saat pertama dibuka). Menggantikan menu bar, toolbar, dan tabel bergaya klasik.
- "Tentang ZIVAR" menjadi "Tentang".
- Alamat feed pembaruan menunjuk ke rilis GitHub.
- Teks "Windows" pada pengaturan mulai otomatis diganti "sistem".

### Diperbaiki

- Logika ekstensi tidak lagi bergantung pada teks galat berbahasa Indonesia dari server.
- Pembaruan yang dihapus dari daftar unduhan ditawarkan kembali alih-alih menampilkan status basi.

## [0.17.0] - 2026-10-24

### Ditambahkan

- Dukungan macOS (Apple Silicon dan Intel) dan Linux (x64 dan arm64): `.dmg`, `.AppImage`, `.deb` untuk Ubuntu/Debian/Linux Mint, `.rpm` untuk Fedora/openSUSE, dan `.tar.gz`.
- Logo dan ikon baru ZIVAR (huruf Z dengan bar progres) untuk aplikasi, installer, system tray, dan extension browser.
- Lisensi MIT, `THIRD_PARTY_NOTICES.md`, dan dokumentasi lengkap di `README.md` serta `docs/`.
- Alur rilis GitHub Actions: build otomatis untuk lima target, `SHA256SUMS.txt`, dan `latest.json` untuk pemeriksaan pembaruan.
- Feed pembaruan boleh memuat installer per platform (`platforms`), sehingga satu `latest.json` melayani Windows, macOS, dan Linux.
- Test yang memastikan daftar tipe file dan situs bawaan extension sama dengan aplikasi.

### Diubah

- Mulai otomatis saat login kini berfungsi di macOS dan Linux (entri autostart XDG), bukan hanya Windows.
- Aksi setelah semua unduhan selesai (matikan komputer, tidur) memakai perintah sistem masing-masing platform.
- Tombol buka folder unduhan memakai Finder di macOS dan `xdg-open` di Linux.
- Nama extractor dan runtime yt-dlp mengikuti platform (`.exe` hanya di Windows).

### Diperbaiki

- Validasi pola situs pengecualian memperlakukan titik sebagai titik literal; sebelumnya karakter seperti `_` ikut lolos sebagai pemisah label.
- File yang berpotensi dieksekusi di macOS dan Linux (`.sh`, `.AppImage`, `.deb`, `.dmg`, dan lainnya) hanya ditampilkan di folder, tidak dibuka otomatis.

## [0.16.4] - 2026-10-22

### Diperbaiki

- Klik file yang ditangkap langsung membuat info ZIVAR tanpa membuat download browser.
- Download redirect seperti GitHub Releases dibatalkan saat penentuan nama file masih ditahan, bukan hanya dijeda sebelum dialog Save As.
- Nama file dari Content-Disposition dipertahankan, termasuk untuk URL aset yang berupa ID.
- Menutup info ZIVAR membatalkan pilihan; download browser hanya dimulai jika pengguna memilih Lanjutkan di Chrome.
- Capture yang dimatikan, tipe file, dan pengecualian situs tetap dihormati; download diteruskan ke halaman jika aplikasi lokal tidak tersedia.
- Dialog info menampilkan versi extension untuk memudahkan pengecekan update.

### Validasi

- Smoke test Chromium mencakup klik tanpa item download browser, redirect attachment tanpa ekstensi URL, pembatalan item browser, dan hasil file byte-exact di ZIVAR.

## [0.16.3] - 2026-10-22

### Diperbaiki

- Download yang dipicu tombol atau script halaman kini ikut ditangkap ketika menghasilkan klik tautan file secara sintetis.
- Interception dimulai sejak `pointerdown`/`mousedown` untuk mencegah handler halaman membuka dialog browser lebih dulu.
- Event pointer, mouse, dan click yang sama dideduplikasi agar satu klik hanya membuat satu `Download Info`.

## [0.16.2] - 2026-10-22

### Diperbaiki

- Klik tautan file yang masuk daftar capture kini dicegat sebelum Chrome/Firefox membuat download halaman.
- Download yang dibuat oleh extension memakai `saveAs: false`, sehingga dialog `Save As` browser tidak muncul bersamaan dengan `Download Info` ZIVAR.
- Download yang dibuat oleh navigasi langsung, script, atau form tetap memakai fallback `onCreated`/`onDeterminingFilename`.

## [0.16.1] - 2026-10-22

### Diperbaiki

- Build Windows kini memastikan `yt-dlp.exe`, Node runtime, dan `ffmpeg.exe` tersedia serta tervalidasi sebelum installer dibuat.
- Error extractor yang executable-nya hilang kini menampilkan pesan pemulihan yang jelas.

## [0.16.0] - 2026-10-22

### Ditambahkan

- Filter otomatis download browser berdasarkan ekstensi file dengan daftar bawaan bergaya IDM.
- Wildcard `R0*` dan `R1*` untuk arsip multipart.
- Daftar situs yang tidak boleh memulai capture otomatis, termasuk wildcard subdomain.
- Pengaturan Integrasi browser untuk mengubah kedua daftar tanpa mengedit extension.

### Diubah

- Daftar situs pengecualian selalu diprioritaskan di atas daftar ekstensi.
- Mengosongkan daftar ekstensi mematikan capture download browser otomatis.

## [0.15.0] - 2026-10-22

### Ditambahkan

- Dialog informasi untuk download browser biasa, termasuk EXE, MSI, ZIP, PDF, dan dokumen lain.
- Informasi nama file, ukuran, MIME, dan alamat sumber sebelum download dipindahkan ke ZIVAR.
- Tombol `Mulai download` untuk memasukkan file ke antrean ZIVAR.
- Tombol `Lanjutkan di Chrome` untuk meneruskan file dengan download browser.
- Pemulihan download yang sedang menunggu setelah service worker extension dimulai ulang.

### Diubah

- Capture download aktif secara default saat extension pertama kali dipasang.
- Pengguna tetap dapat mematikan capture dari popup extension.
- Download Chrome dibatalkan setelah job berhasil dibuat di antrean ZIVAR, sehingga file tidak disimpan dua kali.

### Diperbaiki

- Kredensial browser sementara disimpan di session storage extension, bukan di storage permanen.
- ID download dari halaman informasi divalidasi sebelum diproses.
- Smoke test extension dan mock manifest mengikuti alur dialog download baru.

