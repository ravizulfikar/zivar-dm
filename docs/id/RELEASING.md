# Membuat rilis

[English](../RELEASING.md)

Rilis dibuat oleh [.github/workflows/release.yml](../../.github/workflows/release.yml) saat sebuah tag `v*` di-push.

## Langkah

1. Naikkan versi di **tiga tempat** yang harus sama:
   - `package.json` (`version`)
   - `extension/manifest.json` (`version`)
   - `CHANGELOG.md`: tambahkan bagian `## [x.y.z] - YYYY-MM-DD` di atas bagian sebelumnya.
2. Jalankan `npm test` dan commit.
3. Buat dan kirim tag:

   ```bash
   git tag v0.17.0
   git push origin main v0.17.0
   ```

4. Workflow berjalan:

   | Tahap | Isi |
   | --- | --- |
   | `test` | `npm test` di Windows, dan memeriksa tag = versi `package.json` = versi manifest = ada di CHANGELOG |
   | `build` | Windows x64, macOS arm64 dan x64, Linux x64 dan arm64; helper diunduh dengan `build/fetch-vendor.mjs` |
   | `publish` | Membuat `SHA256SUMS.txt`, `latest.json`, catatan rilis dari CHANGELOG, lalu GitHub Release |

   Tag berformat `v0.18.0-beta.1` dipublikasikan sebagai pre-release.

Menjalankan workflow lewat **Actions → Release → Run workflow** hanya membangun dan menyimpan artefak, tanpa membuat rilis.

## Berkas dalam satu rilis

| Platform | Berkas |
| --- | --- |
| Windows x64 | `ZIVAR-Setup-<v>.exe`, `ZIVAR-<v>-Portable.exe` |
| macOS | `ZIVAR-<v>-mac-arm64.dmg` / `.zip`, `ZIVAR-<v>-mac-x64.dmg` / `.zip` |
| Linux x64 dan arm64 | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |
| Semua | `SHA256SUMS.txt`, `latest.json` |

## Pembaruan dalam aplikasi

`latest.json` memuat satu installer per platform (`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`)
dengan SHA-256-nya. Arahkan `zivar.updateFeed` di `package.json` ke
`https://github.com/ravizulfikar/zivar-dm/releases/latest/download/latest.json` agar aplikasi memeriksanya.

## Penandatanganan (belum diatur)

Build saat ini tidak ditandatangani. Untuk menambahkannya:

- **Windows**: sertifikat code signing lewat `CSC_LINK` dan `CSC_KEY_PASSWORD`.
- **macOS**: Apple Developer ID, hapus `identity: null` di konfigurasi, tambahkan `CSC_LINK`/`CSC_KEY_PASSWORD`
  dan notarisasi (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

Simpan semuanya sebagai GitHub Actions secrets, jangan di repositori.
