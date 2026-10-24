# Panduan instal

[English](../INSTALL.md)

Unduh file yang sesuai dari halaman [Releases](https://github.com/ravizulfikar/zivar-dm/releases/latest). Setiap rilis menyertakan
`SHA256SUMS.txt`; cocokkan sebelum membuka file.

```bash
# Linux / macOS
sha256sum -c SHA256SUMS.txt --ignore-missing      # Linux
shasum -a 256 -c SHA256SUMS.txt --ignore-missing  # macOS
```

```powershell
# Windows
Get-FileHash .\ZIVAR-Setup-0.17.0.exe -Algorithm SHA256
```

## Windows 10/11

- **Installer** (`ZIVAR-Setup-<versi>.exe`): pilih folder instalasi, shortcut dibuat otomatis. Data pengguna tetap tersimpan saat uninstall.
- **Portable** (`ZIVAR-<versi>-Portable.exe`): jalankan langsung, tidak perlu instalasi.

Jika SmartScreen menampilkan peringatan, klik **More info → Run anyway**. Build belum ditandatangani.

## macOS 12 atau lebih baru

1. Buka `ZIVAR-<versi>-mac-arm64.dmg` (Apple Silicon) atau `-mac-x64.dmg` (Intel).
2. Seret **ZIVAR Download Manager** ke **Applications**.
3. Saat pertama kali dibuka macOS dapat menolak karena aplikasi belum dinotarisasi. Klik kanan aplikasi → **Open** → **Open**, atau:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/ZIVAR Download Manager.app"
   ```

Arsip `.zip` berisi aplikasi yang sama tanpa DMG.

## Ubuntu, Debian, Linux Mint, Pop!_OS

```bash
sudo apt install ./ZIVAR-<versi>-linux-amd64.deb     # x64
sudo apt install ./ZIVAR-<versi>-linux-arm64.deb     # arm64 (Raspberry Pi OS 64-bit, dsb.)
```

Aplikasi muncul di menu **Internet/Network** dan dipasang di `/opt/ZIVAR Download Manager`.
Hapus dengan `sudo apt remove zivar-download-manager`.

## Fedora, RHEL, openSUSE

```bash
sudo dnf install ./ZIVAR-<versi>-linux-x86_64.rpm      # Fedora, RHEL
sudo zypper install ./ZIVAR-<versi>-linux-x86_64.rpm   # openSUSE
```

## Distro lain (Arch, Manjaro, Alpine glibc, dll.)

**AppImage**

```bash
chmod +x ZIVAR-<versi>-linux-x86_64.AppImage
./ZIVAR-<versi>-linux-x86_64.AppImage
```

**Arsip tar.gz**

```bash
tar -xzf ZIVAR-<versi>-linux-x64.tar.gz
# jalankan berkas "zivar-download-manager" di dalam folder hasil ekstrak
```

## Memasang ekstensi browser

Lihat bagian **Memasang ekstensi browser** di [README](../../README.id.md). Folder ekstensi ada di:

| Sistem | Lokasi |
| --- | --- |
| Windows | `%APPDATA%\ZIVAR Download Manager\browser-extension` |
| macOS | `~/Library/Application Support/ZIVAR Download Manager/browser-extension` |
| Linux | `~/.config/ZIVAR Download Manager/browser-extension` |

Menu tray **Folder ekstensi browser** membuka folder itu langsung.

## Lokasi data

Antrean, pengaturan, token pairing, dan log (`desktop.log`) tersimpan di folder data aplikasi
(induk dari folder ekstensi di atas). File unduhan secara bawaan masuk ke `Downloads/ZIVAR`.

## Memperbarui

Buka **Tentang** (tombol versi di bagian bawah sidebar), klik **Periksa pembaruan**, lalu **Unduh dan pasang**. Setelah unduhan terverifikasi, **Pasang dan mulai ulang** menerapkannya:

| Dipasang sebagai | Yang terjadi |
| --- | --- |
| Installer Windows | Installer baru terbuka dan ZIVAR menutup; selesaikan wizard lalu ZIVAR terbuka lagi. |
| Portable Windows | Versi portable baru terbuka dan yang lama menutup. |
| macOS | Disk image terbuka; seret aplikasi ke Applications. |
| AppImage | Berkas AppImage diganti dan ZIVAR dimulai ulang. |
| `.deb` / `.rpm` | Paket terbuka di aplikasi pemasang perangkat lunak Anda. |

## Pemecahan masalah

**Linux: AppImage tidak mau jalan di Ubuntu 24.04 (error sandbox).**
Ubuntu 24.04 membatasi user namespace. Jalankan dengan `./ZIVAR-...AppImage --no-sandbox`,
atau pasang paket `.deb` yang mengatur sandbox helper dengan benar.

**Linux: AppImage meminta FUSE.**
Pasang `libfuse2` (`sudo apt install libfuse2t64` di Ubuntu 24.04) atau jalankan dengan
`--appimage-extract-and-run`.

**Linux: ikon tray tidak muncul di GNOME.**
GNOME tidak menampilkan ikon tray bawaan. Pasang ekstensi *AppIndicator and KStatusNotifierItem Support*.
Menutup jendela tetap menyembunyikan aplikasi ke latar belakang; buka lagi lewat menu aplikasi.

**Port 18765 sedang dipakai.**
Tutup aplikasi lain yang memakai port itu. Ekstensi browser selalu menghubungi `127.0.0.1:18765`,
jadi port ini tidak dapat diganti selama Anda memakai ekstensi.

**Unduhan YouTube gagal.**
Buka **Pengaturan** dan jalankan pembaruan extractor, atau biarkan pembaruan mingguan otomatis aktif.
