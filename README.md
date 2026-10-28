# WarungPintar

Aplikasi web progresif (PWA) untuk membantu warung dan UMKM mengelola penjualan, persediaan, pengeluaran, dan piutang pelanggan. Autentikasi serta sinkronisasi menggunakan Supabase. Setelah akun dibuka pada perangkat, pencatatan dapat dilanjutkan secara offline dan data lokal disimpan dalam keadaan terenkripsi.

Dikembangkan untuk Kompetisi Mahasiswa Muhammadiyah (KMM) AST-PTMA, cabang Pengembangan Aplikasi Perangkat Lunak.

---

## 1. Menjalankan aplikasi

Aplikasi memerlukan konfigurasi Supabase, proses build pemindai barcode, dan server web statis. Aplikasi tidak dapat dijalankan dengan membuka berkas HTML secara langsung karena browser membatasi modul JavaScript dan service worker pada skema `file://`.

1. **Siapkan basis data.** Jalankan berkas migrasi berikut secara berurutan melalui Supabase Dashboard → SQL Editor. Klik **Run** setelah membuka setiap berkas:
   - `supabase/migrations/202610210001_warungpintar.sql`
   - `supabase/migrations/202610220001_store_data_updated_at_wib.sql`
   - `supabase/migrations/202610230001_store_qris_storage.sql`

   Migrasi kedua menyesuaikan `store_data.updated_at` dengan waktu WIB. Migrasi ketiga membuat bucket QRIS privat dengan kebijakan akses anggota dan pemilik. Aplikasi tidak dapat membuat tabel atau bucket menggunakan publishable key.
2. Pada Supabase Authentication → URL Configuration, tetapkan Site URL serta Redirect URLs untuk alamat lokal (`http://localhost:8080/**`) dan domain HTTPS aplikasi.
3. Deploy Edge Functions untuk pendaftaran pemilik dan undangan asisten. Instal Supabase CLI, masuk ke akun, lalu jalankan perintah berikut dari folder proyek:

```
npx supabase login
npx supabase link --project-ref skvskjrhhekwvkwuxjec
npx supabase secrets set APP_URL="http://localhost:8080"
npx supabase functions deploy register-owner
npx supabase functions deploy invite-assistant
npx supabase functions deploy assistant-access
```

`APP_URL` harus sama dengan origin aplikasi yang diizinkan pada Authentication → URL Configuration. Saat aplikasi di-hosting, gunakan origin HTTPS. Untuk pengembangan lokal, fungsi juga menerima `http://localhost` dan `http://127.0.0.1` pada port apa pun.
4. Aktifkan penyedia autentikasi email dan kata sandi di Supabase Auth. Pendaftaran menggunakan fungsi `register-owner` dan membuat sesi akun baru.
5. Instal dependensi, buat bundle pemindai barcode, lalu jalankan server:

| Kebutuhan | Perintah |
|---|---|
| Membuat bundle pemindai barcode | `npm install` lalu `npm run build` |
| Node.js | `npm start` |
| Python | `python -m http.server 8080` (jalankan build dahulu) |

6. Buka **http://localhost:8080** dan daftarkan akun pemilik menggunakan email, nama toko, serta kata sandi minimal 8 karakter. Fungsi `register-owner` membuat sesi tanpa tautan verifikasi email. Terapkan kembali fungsi ini setelah ada perubahan kode. Jika muncul pesan **Failed to fetch**, pastikan fungsi telah diterapkan pada proyek Supabase yang sesuai dengan konfigurasi di `js/config.js`.
7. Simpan kunci pemulihan saat ditampilkan. Kunci tersebut tidak disimpan di server. Jika dibutuhkan oleh asisten, bagikan melalui saluran komunikasi yang aman.

Pendaftaran akun autentikasi dan pembuatan tabel merupakan proses yang berbeda. Periksa akun melalui **Supabase Dashboard → Authentication → Users**, bukan Table Editor. Jika alamat email telah terdaftar, gunakan akun tersebut atau hapus akun melalui Dashboard sebelum mendaftar kembali. Setelah migrasi dijalankan, pengisian awal akan membuat toko dan keanggotaan pemilik untuk akun autentikasi yang sudah ada.

Toko yang baru didaftarkan dimulai tanpa data. Data lokal dari akun lain tidak disalin secara otomatis; tambahkan produk dan catatan setelah masuk. Data contoh hanya dimuat jika Anda memilih **Muat data contoh** pada Pengaturan.

Sesi dan kunci pembuka data disimpan pada perangkat setelah masuk agar aplikasi tidak meminta autentikasi ulang setiap kali dibuka. Gunakan fitur ini hanya pada perangkat pribadi yang terlindungi; pengguna lain yang dapat mengakses profil browser berpotensi membuka data toko. Tombol **Keluar** menghapus sesi dan kunci yang tersimpan pada perangkat. Jika sesi tidak tersedia atau data browser dihapus, masuk kembali menggunakan kata sandi akun dan kunci pemulihan bila diperlukan.

URL Supabase dan publishable key untuk browser disimpan di `js/config.js`. Publishable key memang bersifat publik. Service-role key hanya boleh digunakan pada Edge Function dan tidak boleh disertakan dalam kode frontend.

Atur kebijakan kata sandi minimal 8 karakter di Supabase Authentication agar persyaratan tersebut juga ditegakkan oleh server. Fungsi pendaftaran menggunakan Supabase Admin API dan mengonfirmasi akun secara langsung (`email_confirm: true`), sehingga kepemilikan alamat email tidak diverifikasi saat pendaftaran. Terapkan konfigurasi ini hanya jika risiko pendaftaran menggunakan alamat email pihak lain telah dipertimbangkan. Pengaturan ulang kata sandi tetap menggunakan email pemulihan.

### Mencoba dari ponsel

Alamat `localhost` hanya dapat digunakan pada perangkat yang menjalankan server. Untuk mencoba aplikasi melalui ponsel:

- **Disarankan:** publikasikan aplikasi melalui layanan hosting statis yang menyediakan HTTPS, seperti Netlify Drop (https://app.netlify.com/drop), GitHub Pages, Vercel, atau Cloudflare Pages. Buka URL aplikasi di Chrome Android, lalu pilih **Tambahkan ke layar utama** atau **Instal aplikasi**.
- **Untuk pratinjau melalui Wi-Fi lokal:** jalankan server dan buka `http://IP-KOMPUTER:8080` pada ponsel yang terhubung ke jaringan yang sama. Autentikasi browser, enkripsi, serta instalasi PWA memerlukan HTTPS untuk penggunaan penuh di ponsel.

### Menjalankan uji otomatis

```
npm test
```
Perintah `npm test` menjalankan pengujian logika bisnis, struktur XLSX, enkripsi, pemulihan kata sandi dan kunci pemulihan, serta penyimpanan IndexedDB terenkripsi.

---

## 2. Fitur dan pemetaan ke proposal

| Kode | Fitur | Status | Lokasi |
|---|---|---|---|
| F01 | Peran pemilik dan asisten | Akun dikelola melalui Supabase. Pemilik dapat mengundang asisten melalui email dan membagikan kunci pemulihan secara terpisah | Pengaturan |
| F02 | Pengelolaan produk | Nama, kategori, harga beli/jual, stok, batas minimum, dan barcode | Produk |
| F03 | Kasir dan pembayaran | Tunai, transfer, kasbon, serta QRIS statis dengan konfirmasi manual. Barcode dapat dibaca menggunakan pemindai eksternal | Kasir |
| F04 | Pengelolaan stok | Stok berkurang saat penjualan dan bertambah saat pembelian, melalui transaksi atomik | Kasir, Belanja |
| F05 | Pengeluaran per kategori | Ada | Menu, Pengeluaran |
| F06 | Kasbon, cicilan, status lunas | Ada | Kasbon |
| F07 | Laporan usaha | Laba rugi, grafik omzet, daftar seluruh barang terjual, dan ekspor | Menu, Laporan |
| F08 | Dukungan offline | Data lokal disimpan terenkripsi di IndexedDB dan disinkronkan dengan pemeriksaan revisi saat koneksi tersedia | Seluruh aplikasi |
| F09 | Peringatan stok menipis dan lambat laku | Ada | Beranda |
| F10 | Pengingat kasbon melalui WhatsApp | Membuka WhatsApp dengan pesan yang dapat ditinjau dan dikirim pengguna | Kasbon |
| F11 | Struk digital | Unduh atau bagikan struk melalui fitur yang didukung browser | Setelah transaksi |
| F12 | Skor Kesehatan Usaha | Ada, bobot transparan di Beranda | Beranda |
| F13 | Akses layanan zakat perdagangan Lazismu | Tautan resmi | Menu, Zakat usaha |
| F14 | Ekspor laporan | XLSX, CSV, dan cetak atau simpan sebagai PDF melalui browser | Laporan |
| F15 | Pemisahan penarikan pribadi dari pengeluaran usaha | Dicatat secara terpisah | Pengeluaran |
| - | Sinkronisasi data | Tersedia setelah migrasi basis data dan Edge Function diterapkan pada proyek Supabase | Pengaturan |

Sinkronisasi menggunakan pemeriksaan revisi untuk mencegah penimpaan data tanpa pemberitahuan. Mekanisme ini menyinkronkan salinan data terenkripsi, bukan antrean operasi atau penggabungan perubahan per rekaman. Jika data diubah secara bersamaan pada beberapa perangkat, pengguna harus memilih salinan dari server atau perangkat; pilihan tersebut dapat mengganti seluruh data toko pada perangkat. Uji sinkronisasi multi-perangkat dan kondisi jaringan terputus pada lingkungan uji sebelum penerapan.

---

## 3. Panduan penggunaan

1. **Produk:** tambahkan nama, kategori, harga beli, harga jual, stok, serta informasi lain yang diperlukan.
2. **QRIS toko:** pemilik dapat mengunggah gambar PNG atau JPEG berukuran maksimal 1 MB melalui Pengaturan atau Kasir. Gambar utama disimpan pada bucket privat Supabase Storage; salinan lokal terenkripsi mendukung penggunaan offline. Terapkan migrasi QRIS sebelum menggunakan fitur ini.
3. **Kasir:** pilih produk atau cari menggunakan barcode, tentukan metode pembayaran, lalu simpan transaksi. Untuk transfer, periksa pembayaran sebelum menyelesaikan transaksi. Transaksi QRIS berstatus **menunggu konfirmasi** sampai kasir mencocokkan pembayaran di luar aplikasi dan mengonfirmasikannya secara manual. Pembatalan transaksi mengembalikan stok. QRIS statis tidak memverifikasi pembayaran secara otomatis. Untuk kasbon, pilih pelanggan dan tanggal jatuh tempo.
4. **Belanja barang:** catat barang yang diterima. Stok bertambah dan harga beli diperbarui untuk transaksi berikutnya; riwayat penjualan tetap menggunakan harga beli saat transaksi.
5. **Pengeluaran:** catat biaya operasional dan penarikan pribadi. Penarikan pribadi dicatat terpisah dari biaya usaha.
6. **Kasbon:** catat pembayaran cicilan. Tombol pengingat membuka WhatsApp dengan pesan yang dapat ditinjau dan dikirim oleh pengguna.
7. **Laporan:** pilih periode untuk melihat ringkasan laba rugi, grafik omzet, dan daftar semua barang terjual beserta jumlah, omzet, serta laba kotor. Ekspor CSV dan XLSX mencakup transaksi pada periode yang dipilih.
8. **Zakat usaha:** pilih **Buka Zakat Perusahaan Lazismu** untuk mengakses [layanan Zakat Perusahaan Lazismu](https://donasi.lazismu.org/zakatperusahaan). Perhitungan dan pembayaran berlangsung di situs Lazismu. Aplikasi tidak mengirim data atau menerima konfirmasi pembayaran.
9. **Struk transaksi:** unduh PDF/JPG atau bagikan melalui fitur Web Share jika didukung browser. Jika berbagi berkas tidak didukung, lampirkan berkas yang diunduh secara manual.
10. **Pengaturan:** kelola asisten, simpan kunci pemulihan, sinkronkan data, serta unduh atau pulihkan cadangan terenkripsi.

## 4. Perhitungan

- **Laba kotor** = jumlah (harga jual − harga beli saat transaksi) × jumlah barang.
- **Laba bersih** = laba kotor − pengeluaran usaha. **Penarikan pribadi tidak dikurangkan.**
- **Stok menipis** = stok berada pada atau di bawah batas minimum, atau diperkirakan habis sebelum barang pengganti tiba. Perkiraan penjualan menggunakan rata-rata tujuh hari terakhir.
- **Produk lambat terjual** = produk masih memiliki stok, tidak terjual selama 30 hari, dan telah tercatat lebih dari 30 hari.
- **Skor Kesehatan Usaha** (0–100; berdasarkan data 30 hari): margin bersih 40 poin (target 15%), perputaran stok 30 poin (HPP dibanding nilai stok; target 1×), dan rasio piutang 30 poin (0% memperoleh nilai penuh; 30% atau lebih memperoleh 0 poin).
- Zakat dihitung di layanan resmi Lazismu melalui tombol pada menu **Zakat usaha**. Aplikasi tidak menyediakan kalkulator zakat internal.

## 5. Struktur proyek

```
warungpintar/
  index.html                  kerangka dokumen aplikasi
  manifest.webmanifest        metadata instalasi PWA
  sw.js                       service worker dan cache offline
  css/style.css               gaya antarmuka
  js/app.js                   antarmuka, navigasi, dan aksi pengguna
  js/config.js                URL Supabase dan publishable key
  js/crypto.js                enkripsi AES-GCM, PBKDF2, dan kunci pemulihan
  js/cloud-sync.js            autentikasi anggota dan sinkronisasi berbasis revisi
  js/supabase.js              klien REST dan Auth Supabase
  js/xlsx.js                  pembuat berkas Excel .xlsx
  js/receipt.js               pembuat struk Canvas, JPG, dan PDF
  js/barcode-scanner-entry.js berkas awal bundle ZXing
  js/barcode-scanner.js       bundle pemindai barcode (hasil npm run build)
  js/logic.js                 logika bisnis murni
  js/db.js                    penyimpanan IndexedDB terenkripsi
  supabase/migrations/        skema, trigger, dan kebijakan RLS
  supabase/functions/         Edge Functions untuk undangan dan asisten
  js/seed.js                  data contoh
  icons/                      ikon aplikasi
  tests/logic.test.js         pengujian unit
```

Skema Supabase mencakup `stores`, `store_members`, `store_invites`, `store_data` (payload AES-GCM), dan `key_envelopes` (kunci penyimpanan terenkripsi yang dibungkus dengan kata sandi akun untuk setiap anggota). IndexedDB menyimpan salinan data bisnis dalam satu rekaman AES-GCM; tabel lama dibersihkan saat migrasi pertama setelah masuk.

## 6. Batasan dan pertimbangan keamanan

- **Migrasi Supabase wajib diterapkan** sebelum pendaftaran dan akses basis data dapat digunakan. Terapkan Edge Functions untuk pendaftaran dan undangan asisten. URL proyek dan publishable key tidak memberikan izin untuk membuat skema. Jangan pernah menempatkan service-role key pada kode browser.
- Data bisnis di server dan IndexedDB dienkripsi menggunakan AES-GCM. Kunci penyimpanan terenkripsi dibungkus dengan kata sandi menggunakan PBKDF2; server tidak menerima data bisnis dalam bentuk terbuka. Saat aplikasi digunakan, data tersedia di memori browser.
- **Simpan kunci pemulihan secara terpisah.** Kata sandi yang diatur ulang tidak dapat membuka data terenkripsi yang sudah ada tanpa kunci pemulihan. Jika kata sandi dan kunci pemulihan hilang, data terenkripsi tidak dapat dipulihkan.
- Berkas cadangan juga dienkripsi. Jika data browser dihapus tanpa cadangan dan tanpa akses ke akun Supabase, data lokal tidak dapat dipulihkan.
- Asisten memerlukan kunci pemulihan dari pemilik untuk membuka data pada perangkat atau akun baru. Kunci tidak dikirim melalui email undangan. Semua anggota menggunakan penyimpanan data bersama; pembatasan menu bukan isolasi kriptografis per tabel. Data yang telah dibuka pada perangkat offline tidak dapat ditarik kembali.
- Pembatasan menu dan tindakan asisten di antarmuka merupakan kontrol tampilan, bukan batas keamanan terhadap pengguna yang memodifikasi JavaScript. Server memberi anggota akses baca dan pembaruan terhadap objek data toko terenkripsi yang sama agar sinkronisasi berfungsi. Karena itu, laporan, pengeluaran, dan data lain tidak terisolasi dari asisten. Pemisahan akses memerlukan rancangan server dan data khusus untuk setiap peran.
- Setelah masuk pertama kali, data dapat dicatat secara offline dan dienkripsi pada perangkat. Masuk secara offline hanya tersedia pada perangkat yang sebelumnya telah membuka akun. Keluar akan menghapus metadata akses offline.
- Sinkronisasi multi-perangkat menggunakan pemeriksaan revisi, bukan penggabungan per rekaman. Jika terjadi konflik, pengguna memilih salinan data pada perangkat atau server. Buat cadangan sebelum mengganti salinan data.
- QRIS menggunakan gambar statis milik toko. Aplikasi tidak memiliki payment gateway, QRIS dinamis, callback/webhook, atau verifikasi pembayaran otomatis. Kasir harus memeriksa pembayaran secara manual. Transaksi yang menunggu konfirmasi belum dihitung sebagai lunas; transaksi yang dibatalkan tidak masuk laporan dan stoknya dikembalikan.
- Tombol Zakat Usaha membuka situs Lazismu di tab baru. Aplikasi tidak memiliki integrasi API, tidak mengirim data usaha, dan tidak mengetahui status perhitungan atau pembayaran pada layanan eksternal.
- Tautan WhatsApp membuka aplikasi dengan pesan yang telah disiapkan; pengguna tetap perlu meninjau dan mengirim pesan. Lampiran struk tidak dikirim otomatis. Jika fitur berbagi tidak tersedia, unduh berkas dan lampirkan secara manual.
- Aplikasi tidak mengirim notifikasi push. Peringatan ditampilkan saat aplikasi dibuka.
- Pemindai kamera belum terintegrasi dengan antarmuka kasir. Kasir mendukung pencarian barcode melalui kolom produk atau pemindai eksternal yang berfungsi sebagai papan ketik.
- Aplikasi belum diuji pada perangkat maupun pengguna di lingkungan lapangan. Sebelum menyertakan klaim dampak dalam proposal, lakukan uji coba pengguna dan pengukuran System Usability Scale (SUS), lalu laporkan hasil aktual.

## 7. Pemecahan masalah

| Masalah | Penyebab dan solusi |
|---|---|
| Halaman kosong atau aplikasi gagal dimulai | Pastikan aplikasi dijalankan melalui server web, bukan `file://`. Coba keluar dari mode privat browser. |
| Pemindai barcode tidak berfungsi | Jalankan `npm run build`. Sebagai alternatif, cari produk atau gunakan pemindai eksternal melalui kolom Kasir. |
| Pendaftaran gagal karena akun telah terdaftar | Gunakan akun yang sudah ada atau hapus akun melalui Authentication → Users sebelum mendaftar kembali. |
| Akun tidak terlihat di Table Editor | Akun berada di Authentication → Users. Pastikan migrasi basis data telah dijalankan. |
| Tabel `stores` tidak ditemukan | Jalankan migrasi SQL melalui Supabase Dashboard → SQL Editor dan pastikan prosesnya berhasil, lalu coba masuk kembali. |
| Undangan gagal atau terjadi masalah CORS | Deploy kedua Edge Function dan pastikan secret `APP_URL` sama dengan origin aplikasi. |
| Perubahan kode belum terlihat | Perbarui cache service worker dengan menaikkan nilai `VERSI` di `sw.js`, atau hapus data situs melalui DevTools → Application. |
| Data tidak tersedia | Pulihkan dari berkas cadangan melalui Pengaturan → Pulihkan cadangan. |
| Port 8080 sedang digunakan | Jalankan server pada port lain, misalnya `8090`. |

## 8. Membuktikan dampak untuk proposal

Aplikasi menyediakan pengujian otomatis untuk logika inti melalui `npm test`. Evaluasi dampak tetap memerlukan pengumpulan data lapangan, misalnya perbandingan waktu pencatatan manual dan aplikasi, skor System Usability Scale (SUS) dari pemilik usaha, serta hasil sebelum dan sesudah uji coba. Gunakan Beranda dan Laporan untuk menampilkan ringkasan, serta CSV untuk analisis data.

**Lisensi:** MIT. Perangkat lunak dapat digunakan dan dikembangkan sesuai ketentuan lisensi.
