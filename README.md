# WarungPintar

**WarungPintar** adalah aplikasi web progresif (*Progressive Web App/PWA*) untuk membantu warung dan UMKM mencatat penjualan, mengelola persediaan, memantau pengeluaran, serta mengelola piutang pelanggan. Aplikasi menggunakan Supabase untuk autentikasi dan sinkronisasi data. Setelah akun dibuka pada perangkat, pencatatan dapat dilanjutkan secara offline, dengan data lokal yang disimpan dalam bentuk terenkripsi.

Proyek ini dikembangkan untuk **Kompetisi Mahasiswa Muhammadiyah (KMM) AST-PTMA**, cabang **Pengembangan Aplikasi Perangkat Lunak**.

## Daftar Isi

- [Gambaran Solusi](#gambaran-solusi)
- [Fitur Utama](#fitur-utama)
- [Teknologi](#teknologi)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [Panduan Penggunaan](#panduan-penggunaan)
- [Perhitungan Bisnis](#perhitungan-bisnis)
- [Struktur Proyek](#struktur-proyek)
- [Keamanan dan Batasan](#keamanan-dan-batasan)
- [Pemecahan Masalah](#pemecahan-masalah)
- [Pengujian dan Evaluasi Dampak](#pengujian-dan-evaluasi-dampak)
- [Lisensi](#lisensi)

## Gambaran Solusi

WarungPintar berfokus pada pencatatan operasional warung dalam satu aplikasi, termasuk transaksi penjualan, perubahan stok, pengeluaran, piutang, dan laporan usaha. Aplikasi juga menyediakan dukungan pencatatan offline, ekspor laporan, struk digital, pengingat piutang melalui WhatsApp, serta akses ke layanan zakat Lazismu.

Beberapa hal yang menjadi fokus pengembangan:

- **Pencatatan operasional:** menghubungkan transaksi penjualan dan pembelian dengan perubahan stok.
- **Pemantauan usaha:** menyajikan laporan usaha, peringatan stok, produk lambat terjual, dan Skor Kesehatan Usaha.
- **Dukungan offline:** menyimpan salinan data lokal yang terenkripsi setelah akun dibuka pada perangkat.
- **Transparansi batasan:** pembayaran QRIS perlu dikonfirmasi secara manual, sedangkan perhitungan zakat dilakukan pada situs Lazismu.

> **Catatan:** aplikasi belum diuji pada pengguna atau perangkat di lingkungan lapangan. Klaim dampak terhadap pengguna perlu didukung hasil uji coba dan pengukuran aktual.

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| Akun pemilik dan asisten | Autentikasi menggunakan Supabase. Pemilik dapat mengundang asisten melalui email. |
| Pengelolaan produk | Mencatat nama, kategori, harga beli dan jual, stok, batas minimum, serta barcode. |
| Kasir dan pembayaran | Mendukung tunai, transfer, kasbon, serta QRIS statis dengan konfirmasi manual. |
| Pengelolaan stok | Stok berkurang saat penjualan dan bertambah saat pembelian melalui transaksi atomik. |
| Pengeluaran usaha | Mencatat pengeluaran berdasarkan kategori dan memisahkan penarikan pribadi dari biaya usaha. |
| Kasbon dan cicilan | Mengelola piutang pelanggan, pembayaran cicilan, status lunas, dan tanggal jatuh tempo. |
| Laporan usaha | Menampilkan ringkasan laba rugi, grafik omzet, dan daftar barang terjual. |
| Dukungan offline | Menyimpan data lokal terenkripsi di IndexedDB dan menyinkronkannya dengan pemeriksaan revisi saat koneksi tersedia. |
| Peringatan stok dan produk lambat laku | Menampilkan peringatan di halaman Beranda berdasarkan aturan yang dijelaskan pada bagian [Perhitungan Bisnis](#perhitungan-bisnis). |
| Pengingat melalui WhatsApp | Membuka WhatsApp dengan pesan yang dapat ditinjau dan dikirim sendiri oleh pengguna. |
| Struk digital | Menyediakan unduhan atau berbagi struk PDF/JPG melalui fitur yang didukung browser. |
| Skor Kesehatan Usaha | Menyajikan skor 0–100 dengan bobot perhitungan yang dijelaskan di Beranda. |
| Akses layanan zakat Lazismu | Membuka layanan Zakat Perusahaan Lazismu dari menu Zakat Usaha. |
| Ekspor laporan | Mendukung ekspor XLSX dan CSV serta cetak atau penyimpanan PDF melalui browser. |

### Pemetaan fitur terhadap proposal

| Kode | Fitur | Implementasi | Lokasi di aplikasi |
|---|---|---|---|
| F01 | Peran pemilik dan asisten | Akun dikelola melalui Supabase. Pemilik dapat mengundang asisten melalui email dan membagikan kunci pemulihan secara terpisah. | Pengaturan |
| F02 | Pengelolaan produk | Nama, kategori, harga beli/jual, stok, batas minimum, dan barcode. | Produk |
| F03 | Kasir dan pembayaran | Tunai, transfer, kasbon, QRIS statis dengan konfirmasi manual, serta pencarian barcode atau pemindai eksternal. | Kasir |
| F04 | Pengelolaan stok | Stok berkurang saat penjualan dan bertambah saat pembelian melalui transaksi atomik. | Kasir, Belanja |
| F05 | Pengeluaran per kategori | Pencatatan pengeluaran. | Menu, Pengeluaran |
| F06 | Kasbon, cicilan, dan status lunas | Pencatatan piutang serta pembayaran cicilan. | Kasbon |
| F07 | Laporan usaha | Laba rugi, grafik omzet, daftar barang terjual, dan ekspor. | Menu, Laporan |
| F08 | Dukungan offline | Data lokal terenkripsi di IndexedDB dan sinkronisasi berbasis pemeriksaan revisi. | Seluruh aplikasi |
| F09 | Peringatan stok menipis dan lambat laku | Peringatan ditampilkan di Beranda. | Beranda |
| F10 | Pengingat kasbon melalui WhatsApp | Membuka WhatsApp dengan pesan yang dapat ditinjau dan dikirim pengguna. | Kasbon |
| F11 | Struk digital | Unduh atau bagikan struk melalui fitur browser yang didukung. | Setelah transaksi |
| F12 | Skor Kesehatan Usaha | Skor dengan bobot perhitungan yang ditampilkan di Beranda. | Beranda |
| F13 | Akses layanan zakat Lazismu | Tautan ke layanan Zakat Perusahaan Lazismu. | Menu, Zakat Usaha |
| F14 | Ekspor laporan | XLSX, CSV, dan cetak atau simpan PDF melalui browser. | Laporan |
| F15 | Pemisahan penarikan pribadi | Penarikan pribadi dicatat terpisah dari pengeluaran usaha. | Pengeluaran |
| — | Sinkronisasi data | Tersedia setelah migrasi basis data dan Edge Functions diterapkan pada proyek Supabase. | Pengaturan |

**Batasan sinkronisasi:** mekanisme saat ini menggunakan pemeriksaan revisi untuk menghindari penimpaan data tanpa pemberitahuan. Mekanisme ini menyinkronkan salinan data terenkripsi, bukan antrean operasi atau penggabungan perubahan per rekaman. Jika data diubah bersamaan pada beberapa perangkat, pengguna harus memilih salinan dari server atau perangkat. Pilihan tersebut dapat mengganti seluruh data toko pada perangkat, sehingga pengujian multi-perangkat dan kondisi jaringan terputus diperlukan sebelum penerapan.

## Teknologi

- **Frontend:** HTML, CSS, dan JavaScript.
- **PWA dan penyimpanan lokal:** manifest web, service worker, dan IndexedDB.
- **Autentikasi, basis data, serta sinkronisasi:** Supabase.
- **Fungsi backend:** Supabase Edge Functions.
- **Enkripsi:** AES-GCM dan PBKDF2.
- **Ekspor dan struk:** pembuat XLSX, CSV, PDF, dan JPG.
- **Pengujian otomatis:** `npm test`.

## Menjalankan Aplikasi

Aplikasi memerlukan konfigurasi Supabase, proses build untuk bundle pemindai barcode, dan server web. Jangan membuka berkas HTML langsung melalui `file://`, karena browser membatasi modul JavaScript dan service worker pada skema tersebut.

### Prasyarat

- Node.js dan npm.
- Proyek Supabase yang dapat diakses.
- Supabase CLI untuk menerapkan Edge Functions.
- Browser modern.

### 1. Siapkan basis data

Buka Supabase Dashboard → **SQL Editor**, lalu jalankan migrasi berikut secara berurutan. Buka setiap berkas dan pilih **Run**.

1. `supabase/migrations/202610210001_warungpintar.sql`
2. `supabase/migrations/202610220001_store_data_updated_at_wib.sql`
3. `supabase/migrations/202610230001_store_qris_storage.sql`

Migrasi kedua menyesuaikan `store_data.updated_at` dengan waktu WIB. Migrasi ketiga membuat bucket QRIS privat dengan kebijakan akses pemilik dan anggota. Aplikasi tidak dapat membuat tabel atau bucket menggunakan publishable key.

### 2. Atur URL autentikasi

Pada Supabase Dashboard → **Authentication → URL Configuration**, tetapkan **Site URL** dan **Redirect URLs** untuk alamat lokal dan domain HTTPS aplikasi. Untuk pengembangan lokal, gunakan alamat seperti `http://localhost:8080/**`.

### 3. Terapkan Supabase Edge Functions

Dari folder proyek, masuk ke Supabase CLI dan hubungkan proyek. Periksa kembali project reference sebelum menjalankan perintah.

```bash
npx supabase login
npx supabase link --project-ref skvskjrhhekwvkwuxjec
npx supabase secrets set APP_URL="http://localhost:8080"
npx supabase functions deploy register-owner
npx supabase functions deploy invite-assistant
npx supabase functions deploy assistant-access
npx supabase functions deploy reset-password
```

`APP_URL` harus sama dengan origin aplikasi yang diizinkan pada Authentication → URL Configuration. Saat aplikasi di-hosting, gunakan origin HTTPS. Untuk pengembangan lokal, fungsi juga menerima `http://localhost` dan `http://127.0.0.1` pada port apa pun.

### 4. Aktifkan autentikasi

Aktifkan penyedia autentikasi email dan kata sandi pada Supabase Auth. Pendaftaran menggunakan fungsi `register-owner` untuk membuat sesi akun baru.

Atur kebijakan kata sandi minimal 8 karakter pada Supabase Authentication agar persyaratan tersebut juga diterapkan oleh server. Fungsi pendaftaran menggunakan Supabase Admin API dan mengonfirmasi akun secara langsung (`email_confirm: true`), sehingga kepemilikan alamat email tidak diverifikasi saat pendaftaran. Pertimbangkan risiko pendaftaran menggunakan alamat email pihak lain sebelum menerapkan konfigurasi ini. Pengaturan ulang kata sandi tetap menggunakan email pemulihan.

### 5. Instal dependensi dan jalankan server

Jalankan perintah berikut dari folder proyek:

```bash
npm install
npm run build
```

Setelah build selesai, jalankan salah satu server berikut:

| Pilihan | Perintah |
|---|---|
| Node.js | `npm start` |
| Python | `python -m http.server 8080` |

### 6. Buka aplikasi

Buka `http://localhost:8080` dan daftarkan akun pemilik menggunakan email, nama toko, serta kata sandi minimal 8 karakter. Fungsi `register-owner` membuat sesi tanpa tautan verifikasi email. Terapkan ulang fungsi tersebut setelah ada perubahan kode.

Jika muncul pesan `Failed to fetch`, pastikan fungsi telah diterapkan pada proyek Supabase yang sesuai dengan konfigurasi di `js/config.js`.

Simpan kunci pemulihan saat ditampilkan. Kunci tersebut tidak disimpan di server. Jika dibutuhkan oleh asisten, bagikan melalui saluran komunikasi yang aman.

Pemulihan kata sandi dilakukan pada formulir **Lupa kata sandi** tanpa tautan email: masukkan email akun, kunci pemulihan, dan kata sandi baru. Edge Function `reset-password` harus dideploy agar fitur dapat memverifikasi kunci pemulihan dan memperbarui kata sandi melalui Supabase Admin API.

**Catatan akun dan data awal:** pendaftaran akun autentikasi dan pembuatan tabel merupakan proses yang berbeda. Periksa akun melalui Supabase Dashboard → **Authentication → Users**, bukan Table Editor. Jika alamat email sudah terdaftar, gunakan akun yang ada atau hapus akun melalui Dashboard sebelum mendaftar kembali. Setelah migrasi dijalankan, pengisian awal akan membuat toko dan keanggotaan pemilik untuk akun autentikasi yang sudah ada.

Toko baru dimulai tanpa produk dan transaksi. Data lokal dari akun lain tidak disalin secara otomatis. Semua produk harus ditambahkan melalui halaman **Tambah Produk**.

### Mencoba dari ponsel

Alamat `localhost` hanya dapat digunakan pada perangkat yang menjalankan server. Untuk mencoba aplikasi dari ponsel:

- **Disarankan:** publikasikan aplikasi melalui hosting statis yang menyediakan HTTPS, misalnya [Netlify Drop](https://app.netlify.com/drop), GitHub Pages, Vercel, atau Cloudflare Pages. Buka URL aplikasi di Chrome Android, lalu pilih **Tambahkan ke layar utama** atau **Instal aplikasi**.
- **Pratinjau melalui Wi-Fi lokal:** jalankan server dan buka `http://IP-KOMPUTER:8080` di ponsel yang terhubung ke jaringan yang sama. Penggunaan penuh fitur autentikasi browser, enkripsi, dan instalasi PWA pada ponsel memerlukan HTTPS atau konteks aman yang didukung browser.

### Menjalankan pengujian otomatis

```bash
npm test
```

Pengujian tersebut mencakup logika bisnis, struktur XLSX, enkripsi, pemulihan kata sandi dan kunci pemulihan, serta penyimpanan IndexedDB terenkripsi. Jalankan pengujian pada lingkungan pengembangan dan periksa hasil aktualnya sebelum menyatakan pengujian berhasil.

## Panduan Penggunaan

1. **Produk:** tambahkan nama, kategori, harga beli, harga jual, stok, serta informasi lain yang diperlukan.
2. **QRIS toko:** pemilik dapat mengunggah gambar PNG atau JPEG maksimal 1 MB melalui Pengaturan atau Kasir. Gambar utama disimpan pada bucket privat Supabase Storage; salinan lokal terenkripsi mendukung penggunaan offline. Terapkan migrasi QRIS sebelum memakai fitur ini.
3. **Kasir:** pilih produk atau cari menggunakan barcode, tentukan metode pembayaran, lalu simpan transaksi. Untuk transfer, periksa pembayaran sebelum menyelesaikan transaksi. Transaksi QRIS berstatus **menunggu konfirmasi** sampai kasir mencocokkan pembayaran di luar aplikasi dan mengonfirmasikannya secara manual. QRIS statis tidak memverifikasi pembayaran secara otomatis. Pembatalan transaksi mengembalikan stok. Untuk kasbon, pilih pelanggan dan tanggal jatuh tempo.
4. **Belanja barang:** catat barang yang diterima. Stok bertambah dan harga beli diperbarui untuk transaksi berikutnya; riwayat penjualan tetap menggunakan harga beli saat transaksi.
5. **Pengeluaran:** catat biaya operasional dan penarikan pribadi. Penarikan pribadi dicatat terpisah dari biaya usaha.
6. **Kasbon:** catat pembayaran cicilan. Tombol pengingat membuka WhatsApp dengan pesan yang dapat ditinjau dan dikirim oleh pengguna.
7. **Laporan:** pilih periode untuk melihat ringkasan laba rugi, grafik omzet, dan daftar barang terjual beserta jumlah, omzet, serta laba kotor. Ekspor CSV dan XLSX mencakup transaksi pada periode yang dipilih.
8. **Zakat Usaha:** pilih **Buka Zakat Perusahaan Lazismu** untuk membuka [layanan Zakat Perusahaan Lazismu](https://donasi.lazismu.org/zakatperusahaan). Perhitungan dan pembayaran berlangsung di situs Lazismu. Aplikasi tidak mengirim data atau menerima konfirmasi pembayaran.
9. **Struk transaksi:** unduh PDF/JPG atau bagikan melalui fitur Web Share jika didukung browser. Jika berbagi berkas tidak didukung, unduh berkas lalu lampirkan secara manual.
10. **Menu dan Pengaturan:** pemilik dapat menghapus riwayat penjualan, pembelian, pengeluaran, penarikan pribadi, dan kasbon beserta pembayarannya melalui Menu. Data produk, pelanggan, pengaturan toko, serta jumlah stok tidak berubah. Pengaturan juga menyediakan pengelolaan asisten, kunci pemulihan, sinkronisasi, dan cadangan terenkripsi.

## Perhitungan Bisnis

- **Laba kotor** = jumlah `(harga jual − harga beli saat transaksi) × jumlah barang`.
- **Laba bersih** = laba kotor − pengeluaran usaha. **Penarikan pribadi tidak dikurangkan.**
- **Stok menipis** = stok berada pada atau di bawah batas minimum, atau diperkirakan habis sebelum barang pengganti tiba. Perkiraan penjualan menggunakan rata-rata tujuh hari terakhir.
- **Produk lambat terjual** = produk masih memiliki stok, tidak terjual selama 30 hari, dan telah tercatat lebih dari 30 hari.
- **Skor Kesehatan Usaha** memiliki rentang 0–100 dan menggunakan data 30 hari: margin bersih bernilai 40 poin dengan target 15%; perputaran stok bernilai 30 poin dengan target 1× berdasarkan HPP dibanding nilai stok; dan rasio piutang bernilai 30 poin, dengan rasio 0% memperoleh nilai penuh dan rasio 30% atau lebih memperoleh 0 poin.
- **Zakat:** perhitungan dilakukan pada layanan Lazismu yang dibuka dari menu Zakat Usaha. Aplikasi tidak menyediakan kalkulator zakat internal.

## Struktur Proyek

```text
warungpintar/
├── index.html                      # Kerangka dokumen aplikasi
├── manifest.webmanifest             # Metadata instalasi PWA
├── sw.js                            # Service worker dan cache offline
├── css/
│   └── style.css                    # Gaya antarmuka
├── js/
│   ├── app.js                       # Antarmuka, navigasi, dan aksi pengguna
│   ├── config.js                    # URL Supabase dan publishable key
│   ├── crypto.js                    # AES-GCM, PBKDF2, dan kunci pemulihan
│   ├── cloud-sync.js                # Autentikasi anggota dan sinkronisasi berbasis revisi
│   ├── supabase.js                  # Klien REST dan Auth Supabase
│   ├── xlsx.js                      # Pembuat berkas Excel .xlsx
│   ├── receipt.js                   # Pembuat struk Canvas, JPG, dan PDF
│   ├── barcode-scanner-entry.js     # Berkas awal bundle ZXing
│   ├── barcode-scanner.js           # Bundle pemindai barcode hasil npm run build
│   ├── logic.js                     # Logika bisnis murni
│   └── db.js                        # Penyimpanan IndexedDB terenkripsi
├── supabase/
│   ├── migrations/                  # Skema, trigger, dan kebijakan RLS
│   └── functions/                   # Edge Functions untuk pendaftaran dan asisten
├── icons/                           # Ikon aplikasi
└── tests/
    └── logic.test.js                # Pengujian unit
```

Skema Supabase mencakup `stores`, `store_members`, `store_invites`, `store_data` (payload AES-GCM), dan `key_envelopes` (kunci penyimpanan terenkripsi yang dibungkus dengan kata sandi akun untuk setiap anggota). IndexedDB menyimpan salinan data bisnis dalam satu rekaman AES-GCM. Tabel lama dibersihkan saat migrasi pertama setelah masuk.

## Keamanan dan Batasan

- **Migrasi Supabase wajib diterapkan** sebelum pendaftaran dan akses basis data dapat digunakan. Terapkan Edge Functions untuk pendaftaran dan undangan asisten. URL proyek dan publishable key tidak memberikan izin untuk membuat skema. Jangan pernah menempatkan service-role key pada kode browser atau commit ke repository.
- URL Supabase dan publishable key untuk browser disimpan di `js/config.js`. Publishable key memang bersifat publik. Service-role key hanya boleh digunakan pada Edge Function.
- Data bisnis di server dan IndexedDB dienkripsi menggunakan AES-GCM. Kunci penyimpanan terenkripsi dibungkus dengan kata sandi menggunakan PBKDF2. Server tidak menerima data bisnis dalam bentuk terbuka, tetapi data tersedia di memori browser saat aplikasi digunakan.
- **Simpan kunci pemulihan secara terpisah.** Kata sandi yang diatur ulang tidak dapat membuka data terenkripsi yang sudah ada tanpa kunci pemulihan. Jika kata sandi dan kunci pemulihan hilang, data terenkripsi tidak dapat dipulihkan.
- Berkas cadangan juga dienkripsi. Jika data browser dihapus tanpa cadangan dan tanpa akses ke akun Supabase, data lokal tidak dapat dipulihkan.
- Asisten memerlukan kunci pemulihan dari pemilik untuk membuka data pada perangkat atau akun baru. Kunci tidak dikirim melalui email undangan. Semua anggota menggunakan penyimpanan data bersama; pembatasan menu bukan isolasi kriptografis per tabel. Data yang telah dibuka pada perangkat offline tidak dapat ditarik kembali.
- Pembatasan menu dan tindakan asisten di antarmuka merupakan kontrol tampilan, bukan batas keamanan terhadap pengguna yang memodifikasi JavaScript. Server memberi anggota akses baca dan pembaruan terhadap objek data toko terenkripsi yang sama agar sinkronisasi berfungsi. Karena itu, laporan, pengeluaran, dan data lain tidak terisolasi dari asisten. Pemisahan akses memerlukan rancangan server dan data khusus untuk setiap peran.
- Setelah masuk pertama kali, data dapat dicatat secara offline dan dienkripsi pada perangkat. Masuk secara offline hanya tersedia pada perangkat yang sebelumnya telah membuka akun. Keluar menghapus metadata akses offline.
- Sinkronisasi multi-perangkat menggunakan pemeriksaan revisi, bukan penggabungan per rekaman. Jika terjadi konflik, pengguna memilih salinan data pada perangkat atau server. Buat cadangan sebelum mengganti salinan data.
- QRIS menggunakan gambar statis milik toko. Aplikasi tidak memiliki payment gateway, QRIS dinamis, callback/webhook, atau verifikasi pembayaran otomatis. Kasir harus memeriksa pembayaran secara manual. Transaksi yang menunggu konfirmasi belum dihitung sebagai lunas; transaksi yang dibatalkan tidak masuk laporan dan stoknya dikembalikan.
- Tombol Zakat Usaha membuka situs Lazismu di tab baru. Aplikasi tidak memiliki integrasi API, tidak mengirim data usaha, dan tidak mengetahui status perhitungan atau pembayaran pada layanan eksternal.
- Tautan WhatsApp membuka aplikasi dengan pesan yang telah disiapkan; pengguna tetap perlu meninjau dan mengirim pesan. Lampiran struk tidak dikirim otomatis. Jika fitur berbagi tidak tersedia, unduh berkas dan lampirkan secara manual.
- Aplikasi tidak mengirim notifikasi push. Peringatan ditampilkan saat aplikasi dibuka.
- Pemindai kamera belum terintegrasi dengan antarmuka kasir. Kasir mendukung pencarian barcode melalui kolom produk atau pemindai eksternal yang berfungsi sebagai papan ketik.
- Fungsi pendaftaran mengonfirmasi alamat email secara langsung. Pertimbangkan risiko pendaftaran menggunakan alamat email pihak lain sebelum menerapkannya pada layanan publik.
- Sesi dan kunci pembuka data disimpan pada perangkat setelah masuk agar aplikasi tidak meminta autentikasi ulang setiap kali dibuka. Gunakan hanya pada perangkat pribadi yang terlindungi. Pengguna lain yang dapat mengakses profil browser berpotensi membuka data toko. Tombol **Keluar** menghapus sesi dan kunci yang tersimpan pada perangkat.

## Pemecahan Masalah

| Masalah | Penyebab atau solusi |
|---|---|
| Halaman kosong atau aplikasi gagal dimulai | Pastikan aplikasi dijalankan melalui server web, bukan `file://`. Coba keluar dari mode privat browser. |
| Pemindai barcode tidak berfungsi | Jalankan `npm run build`. Sebagai alternatif, cari produk atau gunakan pemindai eksternal melalui kolom Kasir. |
| Pendaftaran gagal karena akun sudah terdaftar | Gunakan akun yang sudah ada atau hapus akun melalui Authentication → Users sebelum mendaftar kembali. |
| Akun tidak terlihat di Table Editor | Akun berada di Authentication → Users. Pastikan migrasi basis data telah dijalankan. |
| Tabel `stores` tidak ditemukan | Jalankan migrasi SQL melalui Supabase Dashboard → SQL Editor, pastikan proses berhasil, lalu coba masuk kembali. |
| Undangan gagal atau terjadi masalah CORS | Deploy Edge Functions yang diperlukan dan pastikan secret `APP_URL` sama dengan origin aplikasi. |
| Perubahan kode belum terlihat | Perbarui cache service worker dengan menaikkan nilai `VERSI` di `sw.js`, atau hapus data situs melalui DevTools → Application. |
| Data tidak tersedia | Pulihkan dari berkas cadangan melalui Pengaturan → Pulihkan cadangan. |
| Port 8080 sedang digunakan | Jalankan server pada port lain, misalnya `8090`, lalu sesuaikan URL yang digunakan. |

## Pengujian dan Evaluasi Dampak

Aplikasi menyediakan pengujian otomatis untuk logika inti melalui `npm test`. Pengujian otomatis tidak menggantikan pengujian integrasi pada Supabase, uji kondisi offline, atau uji coba langsung dengan pemilik usaha.

Untuk mengevaluasi manfaat aplikasi dalam proposal, lakukan uji coba dan laporkan hasil aktual, misalnya:

- Perbandingan waktu pencatatan transaksi secara manual dan menggunakan aplikasi.
- Skor *System Usability Scale* (SUS) dari pemilik usaha yang mengikuti uji coba.
- Perbandingan hasil sebelum dan sesudah penggunaan aplikasi berdasarkan indikator yang ditetapkan.
- Hasil pengujian sinkronisasi pada beberapa perangkat dan ketika jaringan terputus.

Beranda dan Laporan dapat digunakan untuk menampilkan ringkasan usaha, sedangkan ekspor CSV dapat digunakan untuk analisis data. Jangan mencantumkan angka dampak atau hasil pengujian sebelum data benar-benar dikumpulkan dan dianalisis.

## Lisensi

Proyek ini menggunakan lisensi **MIT**. Perangkat lunak dapat digunakan dan dikembangkan sesuai ketentuan lisensi tersebut.
