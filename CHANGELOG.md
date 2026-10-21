# Changelog

Semua perubahan penting pada ZIVAR Download Manager dicatat di file ini.

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

