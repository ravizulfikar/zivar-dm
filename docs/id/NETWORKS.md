# Memakai beberapa jaringan

[English](../NETWORKS.md)

ZIVAR dapat membagi satu unduhan ke semua jaringan yang terhubung ke komputer Anda, misalnya Wi-Fi ditambah tethering USB
dari ponsel, sehingga kecepatannya bertambah. Idenya berasal dari aplikasi sumber terbuka [Plexo](https://github.com/anmolkapil/plexo).

## Kapan membantu

Hanya membantu bila setiap jaringan punya **jalur sendiri ke internet**.

| Susunan | Lebih cepat? |
| --- | --- |
| Wi-Fi rumah + ponsel yang di-tethering lewat USB atau hotspot | Ya: dua koneksi terpisah |
| Dua ISP pada dua adapter | Ya |
| Wi-Fi dan Ethernet dari **router yang sama** | Tidak: keduanya berbagi satu koneksi |
| Adapter VPN di samping adapter biasa | Biasanya tidak |

## Mengaktifkan

- **Pengaturan → Jaringan → Gabungkan jaringan saya agar unduhan lebih cepat**, lalu centang jaringan yang dipakai. Adapter
  virtual (Hyper-V, WSL, Docker, terowongan VPN, dan sejenisnya) ditampilkan tetapi tidak dicentang.
- Atau per unduhan: saat dua jaringan atau lebih terhubung, jendela unduhan di ekstensi browser menampilkan
  **Pakai semua jaringan saya**, yang berlaku hanya untuk unduhan itu.

Secara bawaan nonaktif.

## Cara kerjanya

1. Setiap koneksi unduhan diikat ke alamat IP satu adapter jaringan, sehingga sistem operasi mengirimnya lewat adapter itu.
2. Sebelum unduhan dimulai, setiap jaringan **diuji ke server yang sebenarnya**. Jaringan yang tidak dapat menjangkaunya
   dilewati untuk unduhan ini, sehingga adapter yang bermasalah tidak menahan unduhan.
3. File dipotong menjadi potongan kecil (mulai 2 MB). Setiap koneksi dari setiap jaringan mengambil potongan kosong berikutnya,
   jadi jaringan cepat otomatis mengambil lebih banyak dan yang lambat tidak menahan sisanya.
4. Jika sebuah jaringan putus di tengah jalan (ponsel dicabut), potongannya diberikan ke jaringan lain dan unduhan
   berlanjut. Jika jaringan terakhir gagal, unduhan berhenti dengan galat biasa dan dapat dilanjutkan.
5. Selama berjalan, kolom **Keterangan** menampilkan kecepatan tiap jaringan, misalnya `Wi-Fi 2 3,4 MB/s · Ethernet 1,1 MB/s`.

## Batasan

- Butuh server yang mendukung resume (byte range) dan file minimal 4 MB. Jika tidak, jalur biasa dipakai.
- Tidak dipakai saat proxy diatur, dan tidak dipakai untuk unduhan YouTube dan stream video.
- **Windows dan macOS** memilih adapter keluar dari alamat sumber, yang diikat oleh ZIVAR. **Linux** mungkin butuh routing
  tambahan (aturan per adapter) sebelum jaringan kedua dapat membawa lalu lintas; pengujian pada langkah 2 melewati jaringan
  seperti itu alih-alih gagal.
- Jika jaringan kedua tidak menambah kecepatan, periksa kecepatan per jaringan: bila keduanya keluar lewat jalur fisik
  yang sama, totalnya tetap.
- Potongan ditulis ke disk bersama file yang sudah jadi, bukan satu per satu, karena di sebagian sistem satu kali flush
  disk memakan ratusan milidetik dan akan menahan semua jaringan sekaligus.
