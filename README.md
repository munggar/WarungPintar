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
| Akun pemilik dan asisten | Owner mendaftar langsung tanpa kode administrator. Owner dapat menentukan kode undangan Asisten saat pendaftaran atau membuat kode otomatis nanti; Asisten mendaftar dengan kode satu kali dari Owner. |

Saat pendaftaran Owner, pilihan “Isi kode undangan sekarang” menampilkan kolom kode khusus Asisten. Pilihan “Nanti saja” menyembunyikan kolom tersebut. Kode harus 16–128 karakter (huruf, angka, tanda hubung, garis bawah), berlaku tujuh hari, dan hanya dapat dipakai sekali.
| Pengelolaan produk | Mencatat nama, kategori, harga beli dan jual, stok, batas minimum, serta barcode. |
| Kasir dan pembayaran | Mendukung tunai, transfer, kasbon, serta QRIS statis dengan konfirmasi manual. |
| Pengelolaan stok | Stok berkurang saat penjualan dan bertambah saat pembelian melalui transaksi atomik. |
| Pengeluaran usaha | Mencatat pengeluaran berdasarkan kategori dan memisahkan penarikan pribadi dari biaya usaha. |
| Kasbon dan cicilan | Mengelola piutang pelanggan, pembayaran cicilan, status lunas, dan tanggal jatuh tempo. |
| Smart Kasbon | Menghitung batas internal berbasis aturan dari snapshot browser, input kebijakan pemilik, dan risiko pembayaran; ledger baru divalidasi secara atomik di Supabase, tetapi angka finansial tidak diverifikasi independen. |
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
| F01 | Peran pemilik dan asisten | Akun dikelola melalui Supabase. Pemilik dapat menerbitkan kode undangan Asisten sekali pakai dan membagikan Kunci Pemulihan Data secara terpisah. | Pengaturan |
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
| F13 | Kalkulator zakat usaha | Menghitung estimasi zakat perdagangan, menyimpan perhitungan di vault terenkripsi, dan menyediakan tautan Lazismu. | Menu, Zakat Usaha |
| F14 | Ekspor laporan | XLSX, CSV, dan cetak atau simpan PDF melalui browser. | Laporan |
| F15 | Pemisahan penarikan pribadi | Penarikan pribadi dicatat terpisah dari pengeluaran usaha. | Pengeluaran |
| F16 | Smart Kasbon | Limit rule-based, skor risiko historis, ledger atomik, dan pipeline model advisory per toko yang hanya dapat diaktifkan setelah evaluasi holdout memenuhi syarat. | Kasbon |
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

### Environment staging lokal

Konfigurasi lokal melalui `js/config.local.js` hanya dibaca di `localhost`, sehingga file itu tidak mengaktifkan staging pada domain deployment. Build Render staging memakai runtime config terpisah yang dibuat saat build dan tidak fallback ke konfigurasi production jika tidak valid. Proyek ini memakai HTML dan JavaScript ES Modules; file `.env` tidak otomatis dibaca browser.

1. Salin template ke file lokal yang diabaikan Git:

   ```powershell
   Copy-Item js/config.local.example.js js/config.local.js
   ```

2. Dari Supabase Dashboard proyek **staging**, isi `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` di `js/config.local.js`. Gunakan hanya URL project dan Publishable Key dengan prefix `sb_publishable_`. Jangan masukkan database password, secret key, service_role key, access token, atau nilai secret lainnya ke file frontend.
3. Periksa pemilihan konfigurasi tanpa mengirim permintaan koneksi:

   ```powershell
   npm run config:check
   ```

   Output hanya memuat nama environment, URL, project reference, serta status ketersediaan key; nilai key tidak pernah ditampilkan. Saat staging siap, output harus menyebut `staging`, URL/ref yang sama dengan proyek staging di Dashboard, dan key `available`. Ini memeriksa konfigurasi lokal, bukan konektivitas Supabase.
4. Jalankan aplikasi lokal (`npm start`) dan pastikan badge **STAGING** terlihat. Badge menunjukkan konfigurasi staging dipilih, bukan bahwa koneksi jaringan sudah teruji.

Untuk menonaktifkan staging, kosongkan kedua nilai URL/key di `js/config.local.js` atau hapus file itu, lalu muat ulang aplikasi. Checker dan aplikasi akan kembali memakai konfigurasi produksi. File ini sengaja tidak masuk cache service worker.

Build saat ini hanya membundel pemindai barcode; konfigurasi lokal bukan bagian dari bundle. Untuk deployment produksi, deploy berkas yang dilacak Git, bukan seluruh working directory, dan pastikan `js/config.local.js` serta `supabase/.env.local` tidak ada dalam artefak. Selain diabaikan Git, override browser hanya aktif pada hostname lokal.

Konfigurasi CLI staging terpisah di `supabase/.env.local`; file ini bukan sumber konfigurasi browser. Salin `supabase/.env.local.example` jika perlu membuat ulang, lalu isi Project Reference ID dan database password dari proyek staging. Jangan menjalankan `supabase link`, migration, atau deploy sebelum memeriksa ulang Project Reference ID terhadap Dashboard staging. Bila nanti CLI di-link, target harus diambil dari `SUPABASE_PROJECT_ID` staging yang telah diverifikasi—jangan memakai perintah production di bagian berikut.

### Deployment frontend staging di Render

Deployment ini membuat Static Site terpisah dan tidak mengubah service, konfigurasi, atau data production. Buat service secara manual di Render; service staging belum otomatis dibuat atau dideploy oleh repository ini.

1. Buat **New Static Site** dari repository `munggar/WarungPintar`, branch `staging`, dengan nama persis `warungpintar-frontend-staging`. Biarkan Root Directory kosong (root repository), dan nonaktifkan Auto-Deploy sampai konfigurasi staging diperiksa.
2. Atur:
   - Build Command: `npm ci --include=dev && npm run build:staging`
   - Publish Directory: `dist-staging`
3. Tambahkan environment variables berikut pada service staging:
   - `WP_ENVIRONMENT=staging`
   - `SUPABASE_URL=https://unkmykhwddwhbtuioqrg.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` = Publishable Key dari Supabase Dashboard proyek staging. Jangan gunakan Secret Key, `service_role`, access token, atau database password.
   - `STAGING_EXPECTED_PROJECT_REF=unkmykhwddwhbtuioqrg`
4. Simpan konfigurasi, jalankan deploy manual, lalu pastikan URL deployment memakai HTTPS dan halaman menampilkan badge **STAGING**. Periksa juga bahwa build gagal bila service bukan bernama `warungpintar-frontend-staging`, variabel menunjuk ke project lain, atau konfigurasi staging tidak tersedia. Jangan mengarahkan service production yang sudah ada ke `dist-staging`.

Build menghasilkan bundle barcode scanner secara terpisah, marker environment, dan cache service worker staging yang unik. Seluruh pohon modul JavaScript disalin secara rekursif dan import lokal diverifikasi sebelum artefak diterbitkan; konfigurasi lokal, secret, `supabase/`, migration, test, dan `node_modules` tidak disertakan. Import dinamis `config.local.js` hanya merupakan fallback localhost dan tidak ikut dikemas. Build lokal tanpa `RENDER_SERVICE_NAME` dan `RENDER_EXTERNAL_URL` diperbolehkan untuk pemeriksaan; pada Render, kedua variabel itu divalidasi jika tersedia. `SUPABASE_PUBLISHABLE_KEY` tetap dapat dibaca pengguna karena frontend berjalan di browser, sehingga keamanan data harus ditegakkan oleh RLS dan backend—key ini bukan secret.

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
4. `supabase/migrations/202610240001_smart_kasbon.sql`
5. `supabase/migrations/202611130001_registration_and_recovery_security.sql`
6. `supabase/migrations/202611140001_owner_registration_rate_limit.sql`
7. `supabase/migrations/202611150001_email_free_account_codes.sql`
8. `supabase/migrations/202611160001_smart_kasbon_ml_pipeline.sql`
9. `supabase/migrations/202611170001_hybrid_smart_kasbon_status.sql`

Migrasi kedua menyesuaikan `store_data.updated_at` dengan waktu WIB. Migrasi ketiga membuat bucket QRIS privat dengan kebijakan akses pemilik dan anggota. Migrasi keempat menambahkan ledger Smart Kasbon pseudonim dan fungsi transaksi server. Migrasi kelima hingga ketujuh menyiapkan keamanan registrasi serta recovery/invitation berbasis kode; migrasi kedelapan menyiapkan rate limit pelatihan dan aktivasi model per toko; migrasi kesembilan menambah state hybrid dan guard aktivasi artifact/holdout. Periksa status/urutan migration pada target sebelum menerapkan. Aplikasi tidak dapat membuat tabel atau bucket menggunakan publishable key.

### 2. Atur URL autentikasi

Pada Supabase Dashboard → **Authentication → URL Configuration**, tetapkan **Site URL** dan **Redirect URLs** untuk alamat lokal dan domain HTTPS aplikasi. Untuk pengembangan lokal, gunakan alamat seperti `http://localhost:8080/**`.

### 3. Terapkan Supabase Edge Functions

Bagian ini adalah alur penerapan **production yang sudah ada**, bukan instruksi untuk staging. Perintah `supabase link` di bawah tetap menargetkan project production; jangan jalankan untuk mengonfigurasi staging.

```powershell
npx supabase login
npx supabase link --project-ref skvskjrhhekwvkwuxjec
$resetSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
npx supabase secrets set APP_URL="https://warungpintar-jjd1.onrender.com" RESET_RATE_LIMIT_SECRET="$resetSecret"
Remove-Variable resetSecret
```

Ganti nilai `APP_URL` dengan origin HTTPS aplikasi Anda jika domain Render berbeda. Nilai ini harus sama persis dengan **Site URL** pada Supabase Authentication → URL Configuration dan origin yang membuka aplikasi. Untuk pengembangan lokal, ubah sementara nilainya ke `http://localhost:8080`; fungsi juga menerima `http://localhost` dan `http://127.0.0.1` pada port apa pun.

Terapkan migration `202611130001_registration_and_recovery_security.sql`, `202611140001_owner_registration_rate_limit.sql`, dan `202611150001_email_free_account_codes.sql` setelah migration toko awal dan sebelum deploy fungsi autentikasi. Periksa urutan migration dan project reference; jangan jalankan pada production tanpa persetujuan serta backup.

Setelah migration berhasil diterapkan pada target yang telah diverifikasi, deploy fungsi:

```powershell
npx supabase functions deploy register-owner
npx supabase functions deploy invite-assistant
npx supabase functions deploy assistant-access
npx supabase functions deploy accept-assistant
npx supabase functions deploy account-recovery
npx supabase functions deploy reset-password
npx supabase functions deploy smart-kasbon
```

Fungsi `reset-password` menerima email akun, Account Recovery Code, dan kata sandi baru tanpa sesi login. Kode akun disimpan sebagai hash, terikat ke akun, kedaluwarsa setelah satu tahun, dikunci saat digunakan, dan hanya dapat dipakai sekali. Fungsi `account-recovery` hanya dapat dipanggil dengan sesi login dan menerbitkan kode baru; penerbitan kode membatalkan kode sebelumnya. Jangan menggunakan Kunci Pemulihan Data toko untuk mereset kata sandi akun.

`RESET_RATE_LIMIT_SECRET` wajib diisi dengan secret acak minimal 32 karakter; fungsi menggunakannya sebagai HMAC key, bukan menyimpan email mentah pada tabel pembatasan. Jangan memakai contoh placeholder, membagikan secret, atau memasukkannya ke repository. Migration `202611130001_registration_and_recovery_security.sql`, `202611140001_owner_registration_rate_limit.sql`, dan `202611150001_email_free_account_codes.sql` menyiapkan limiter, kode recovery akun, serta undangan asisten berbasis kode. Percobaan pemulihan dan penerbitan kode dibatasi 10 kali per email per jam. Respons email/kode tidak cocok dibuat generik untuk mencegah account enumeration.

Fungsi `smart-kasbon` memerlukan sesi JWT dan keanggotaan toko yang valid. Konfigurasinya mempertahankan verifikasi JWT gateway. Terapkan migration Smart Kasbon dan pipeline model terlebih dahulu. Setiap penerbitan menyimpan snapshot fitur yang tersedia pada saat keputusan server dibuat; data pembayaran selanjutnya membentuk label hanya setelah tanggal jatuh tempo WIB terlewati. Sampel dengan snapshot/ledger tidak lengkap atau tidak konsisten dikecualikan dan alasannya dihitung.

Prediksi memakai Rule-Based sampai ada artifact ML yang lolos evaluasi dan diaktifkan owner. Dataset readiness dihitung per toko dengan split kronologis 80/20 dan pelanggan holdout yang tidak pernah muncul di training. Ambang aman default adalah 100 sampel training, 40 holdout, minimal 25 per kelas training, 10 per kelas evaluasi, dan 10 pelanggan evaluasi independen. Ambang dapat dinaikkan melalui `SMART_KASBON_ML_MIN_TRAINING_ROWS`, `SMART_KASBON_ML_MIN_EVALUATION_ROWS`, `SMART_KASBON_ML_MIN_TRAINING_PER_CLASS`, `SMART_KASBON_ML_MIN_EVALUATION_PER_CLASS`, dan `SMART_KASBON_ML_MIN_EVALUATION_CUSTOMERS`; nilai tidak boleh lebih rendah dari default.

Kandidat Logistic Regression disimpan sebagai `shadow`. Aktivasi owner memerlukan artifact/schema valid, target dan split yang benar, seluruh metrik holdout valid, PR-AUC lebih tinggi dari baseline Rule-Based, Brier score lebih rendah, dan ECE ≤ 0,1. Status sistem membedakan `RULE_BASED_ACTIVE`, `ML_READY_TO_TRAIN`, `ML_TRAINING`, `ML_SHADOW`, `ML_ACTIVE`, dan `RULE_BASED_FALLBACK`. Training hanya dapat dimulai owner, dikunci/idempotent per toko, dan dibatasi satu percobaan per 24 jam. Bila tidak ada model aktif atau inference gagal, aturan risiko transparan tetap memberi indikasi advisory; aturan approval/limit server tidak pernah diganti ML. Probability dan metrik hanya ditampilkan dari artifact dan holdout aktual, tidak dibuat untuk fallback.

### Dataset sintetis Smart Kasbon (STAGING saja)

`scripts/generate-smart-kasbon-demo.mjs` menghasilkan fixture sintetis deterministik (seed `20261114`) untuk menguji pipeline, bukan untuk mengklaim performa pelanggan. Dataset berisi 1.000 kasbon matang untuk training/holdout kronologis dengan customer holdout terpisah, 30 kasbon belum matang, pembayaran cicilan, variasi nominal/tenor, serta marker `SYNTHETIC_SMART_KASBON_DEMO_V1`. Label tidak disimpan sebagai fitur; pipeline menghitung label dari pembayaran aktual terhadap batas jatuh tempo WIB. Generator hanya menulis file output yang belum ada dan tidak menyentuh Supabase.

```powershell
node scripts/generate-smart-kasbon-demo.mjs --output="C:\path\aman\smart-kasbon-demo.json"
```

Fixture hanya boleh dimuat ke toko demo khusus pada project STAGING `unkmykhwddwhbtuioqrg`. Jangan impor ke toko pengguna, jangan commit file dataset/kredensial demo, dan jangan deploy/aktifkan model sintetis di production. Training tetap harus dipanggil melalui Edge Function `smart-kasbon`; hasil kandidat harus memenuhi threshold bawaan tanpa diturunkan. Dataset/akun demo dibersihkan hanya dengan filter marker dan `store_id` demo yang telah diverifikasi—jangan pernah menjalankan pembersihan tanpa kedua batas tersebut.

### 4. Konfigurasi autentikasi

Konfigurasi staging di `supabase/config.toml` menonaktifkan signup publik (`auth.enable_signup = false`) dan email confirmation (`auth.email.enable_confirmations = false`). Terapkan dan periksa konfigurasi hosted staging secara eksplisit:

```bash
npx supabase config diff --remote=unkmykhwddwhbtuioqrg
npx supabase config push --remote=unkmykhwddwhbtuioqrg
```

Owner dapat mendaftar langsung melalui Edge Function `register-owner` tanpa meminta kode dari administrator. Fungsi memvalidasi email, kata sandi, dan nama toko, menerapkan batas 10 percobaan pendaftaran per email per jam, lalu membuat akun lewat Supabase Auth Admin. Signup langsung melalui endpoint Auth publik tetap dinonaktifkan (`auth.enable_signup = false`); hanya Edge Function server yang dapat membuat akun Owner.

Saat membuat akun, Edge Function membuat reservasi internal Owner sekali pakai yang terikat pada email dan disimpan dalam tabel undangan sebagai hash token. Hanya ID reservasi tersebut yang diteruskan melalui metadata pengguna ke Auth Admin; trigger database memvalidasi reservasi di database sebelum membuat toko dan membership `owner`. Token mentah tidak dikirim ke browser atau disimpan di database. Flag `role` dan metadata role yang dikirim browser diabaikan; pengguna tidak dapat menaikkan perannya sendiri melalui payload registrasi.

Pada formulir pendaftaran tersedia pilihan **Isi kode undangan sekarang** atau **Nanti saja**. Jika memilih sekarang, kolom kode muncul agar Owner dapat menentukan kode sendiri (16–128 karakter, huruf, angka, tanda hubung, atau garis bawah); setelah toko berhasil dibuat, kode di-hash dan didaftarkan sebagai undangan sekali pakai. Jika memilih nanti, kolom tidak ditampilkan dan Owner dapat membuat undangan otomatis melalui **Pengaturan → Undang asisten**.

Email confirmation hosted tetap dimatikan agar sesi password dapat langsung dibuat. Karena aplikasi tidak mengirim email verifikasi, alamat email berfungsi sebagai identifier login dan bukan bukti kepemilikan mailbox. Pengguna harus memastikan email yang dimasukkan benar dan menyimpan Account Recovery Code serta Kunci Pemulihan Data secara terpisah. Untuk mencegah penyalahgunaan signup publik pada skala lebih besar, tambahkan verifikasi anti-bot atau persetujuan identitas sebelum membuka layanan secara luas.

Pemilik toko dapat menerbitkan kode undangan asisten dari menu Pengaturan. Kode terikat ke toko, berlaku tujuh hari, disimpan sebagai hash, dapat dicabut, dan hanya dapat digunakan sekali. Calon asisten memilih email login saat menggunakan kode. Jangan membagikan Account Recovery Code dengan Kunci Pemulihan Data: kode pertama mengubah kata sandi akun, sedangkan kode kedua membuka data toko terenkripsi.

Atur kebijakan kata sandi minimal 8 karakter pada Supabase Authentication agar persyaratan tersebut juga diterapkan oleh server. Jangan mengaktifkan signup publik atau email confirmation pada hosted staging; owner tetap harus memakai kode undangan.

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

Buka `http://localhost:8080` dan daftarkan akun pemilik menggunakan email, nama toko, kata sandi minimal 8 karakter, dan kode undangan yang telah diterbitkan admin. Fungsi `register-owner` membuat akun melalui Auth Admin dan mengembalikan sesi password langsung; user tidak perlu mengaktivasi email. Terapkan ulang fungsi tersebut setelah ada perubahan kode.

Jika muncul pesan `Failed to fetch`, pastikan fungsi telah diterapkan pada proyek Supabase yang sesuai dengan konfigurasi di `js/config.js`.

Simpan kunci pemulihan saat ditampilkan. Kunci tersebut tidak disimpan di server. Jika dibutuhkan oleh asisten, bagikan melalui saluran komunikasi yang aman.

Pemulihan kata sandi menggunakan Account Recovery Code yang dibuat dan disimpan sebelumnya dari menu Pengaturan. Kode akun 256-bit ini disimpan sebagai hash, berlaku satu tahun, dan hanya dapat digunakan sekali. Edge Function `reset-password` mengubah kata sandi dengan kode tersebut tanpa mengirim email, lalu aplikasi mencoba masuk menggunakan kata sandi baru. Kunci Pemulihan Data toko tetap terpisah dan hanya membuka vault terenkripsi.

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
4. **Belanja barang:** ketik nama barang dan pilih saran untuk menambah stok produk yang sudah ada. Jika barang belum tersedia, pilih **Tambah barang baru**, lengkapi kategori, harga jual, dan satuan; produk langsung dibuat dengan stok awal sesuai jumlah belanja. Harga beli dan total belanja disimpan di riwayat pembelian stok, bukan pengeluaran operasional, agar harga pokok barang tidak dihitung dua kali pada laba. Semua kolom nominal harga memakai pemisah ribuan titik.
5. **Pengeluaran:** catat biaya operasional dan penarikan pribadi. Penarikan pribadi dicatat terpisah dari biaya usaha.
6. **Kasbon:** saat pertama kali membuka halaman, pemilik menyinkronkan riwayat piutang pseudonim ke server dan mengatur kondisi kas/modal kerja serta batas kebijakan. Nilai kas aktual harus dikonfirmasi pemilik karena tidak dilacak otomatis oleh aplikasi. Kasbon baru dan pembayaran divalidasi server dan memerlukan koneksi internet. Dashboard menampilkan kondisi usaha dan risiko pelanggan. Tombol pengingat membuka WhatsApp dengan pesan yang dapat ditinjau dan dikirim oleh pengguna.
7. **Laporan:** pilih periode untuk melihat ringkasan laba rugi, grafik omzet, dan daftar barang terjual beserta jumlah, omzet, serta laba kotor. Ekspor CSV dan XLSX mencakup transaksi pada periode yang dipilih.
8. **Zakat Usaha:** masukkan aset dan kewajiban perdagangan, harga emas beserta sumber/tanggal, serta konfirmasi haul untuk melihat estimasi zakat. Perhitungan tersimpan di vault terenkripsi browser; tinjau hasilnya dan konsultasikan kewajiban dengan lembaga zakat. Tautan **Buka Zakat Perusahaan Lazismu** membuka [layanan Lazismu](https://donasi.lazismu.org/zakatperusahaan); aplikasi tidak mengirim data atau menerima konfirmasi pembayaran.
9. **Struk transaksi:** unduh PDF/JPG atau bagikan melalui fitur Web Share jika didukung browser. Jika berbagi berkas tidak didukung, unduh berkas lalu lampirkan secara manual.
10. **Menu dan Pengaturan:** pemilik dapat menghapus riwayat penjualan, pembelian, pengeluaran, penarikan pribadi, dan kasbon beserta pembayarannya melalui Menu. Data produk, pelanggan, pengaturan toko, serta jumlah stok tidak berubah. Pengaturan juga menyediakan pengelolaan asisten, kunci pemulihan, sinkronisasi, dan cadangan terenkripsi.

## Perhitungan Bisnis

- **Laba kotor** = jumlah `(harga jual − harga beli saat transaksi) × jumlah barang`.
- **Laba bersih** = laba kotor − pengeluaran usaha. **Penarikan pribadi tidak dikurangkan.**
- **Stok menipis** = stok berada pada atau di bawah batas minimum, atau diperkirakan habis sebelum barang pengganti tiba. Perkiraan penjualan menggunakan rata-rata tujuh hari terakhir.
- **Produk lambat terjual** = produk masih memiliki stok, tidak terjual selama 30 hari, dan telah tercatat lebih dari 30 hari.
- **Skor Kesehatan Usaha** memiliki rentang 0–100 dan menggunakan data 30 hari: margin bersih bernilai 40 poin dengan target 15%; perputaran stok bernilai 30 poin dengan target 1× berdasarkan HPP dibanding nilai stok; dan rasio piutang bernilai 30 poin, dengan rasio 0% memperoleh nilai penuh dan rasio 30% atau lebih memperoleh 0 poin.
- **Smart Kasbon:** batas total absolut dihitung dari nilai terkecil antara batas kebijakan, kas tersedia setelah cadangan, dan modal kerja setelah kewajiban, lalu dikalikan faktor kesehatan. Saldo piutang aktif yang sudah ada diperhitungkan sekali saat backend memeriksa `piutang_aktif + kasbon_baru <= batas_total`; sisa limit adalah batas total dikurangi piutang aktif. Faktor kesehatan adalah 0 untuk kritis, 0,1 cold start, 0,2 menurun, 0,35 stagnan, 0,6 stabil, 0,8 sehat, dan 1 untuk sangat sehat. Skor risiko pelanggan (0–100) dihitung sebagai `100 − 50 × proporsi pelunasan terlambat − 30 × proporsi saldo jatuh tempo − 20 × rata-rata keterlambatan/30 hari` (komponen terakhir dibatasi maksimal 20 poin). Risiko tinggi menolak kasbon baru, risiko sedang membatasi limit pelanggan menjadi separuh, dan risiko rendah tidak memberi pengali tambahan. Transaksi memakai penguncian per toko di database agar dua permintaan bersamaan tidak melewati batas. Angka kas, modal kerja, dan snapshot finansial berasal dari pemilik/browser; backend tidak dapat memverifikasi kesesuaiannya dengan vault terenkripsi. Karena itu limit ini hanya aturan internal berdasarkan input tepercaya, bukan jaminan kesehatan usaha atau audit kemampuan membayar. Ringkasan yang dipakai harus berumur kurang dari tujuh hari.
- **Smart Kasbon hybrid:** Rule-Based merupakan metode prediksi aktif jika dataset belum siap, kandidat belum lolos/diaktifkan, atau inference ML gagal. UI menampilkan metode yang benar-benar berjalan. Model Logistic Regression per toko hanya digunakan sesudah dilatih dari label matang, split kronologis/customer-independent, evaluasi holdout yang mengungguli baseline Rule-Based, artifact tervalidasi, dan aktivasi eksplisit owner. Label on-time berarti lunas penuh paling lambat akhir tanggal jatuh tempo WIB; kasbon belum jatuh tempo bukan late. Jumlah dan kelas dataset readiness, alasan eksklusi, versi/tanggal model, jumlah train/evaluasi, serta metrik holdout aktual ditampilkan kepada owner. Seluruh prediksi advisory dan tidak mengubah aturan approval/limit server. Ambang default dan konfigurasi minimum tercantum di bagian deployment; fixture unit test bukan bukti performa bisnis.
- **Zakat:** kalkulator memperkirakan zakat perdagangan berdasarkan input pemilik; nilai emas manual dan konfirmasi haul harus diverifikasi. Hasilnya bukan bukti pembayaran atau fatwa.

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
│   └── functions/                   # Edge Functions untuk akun, asisten, dan Smart Kasbon
├── icons/                           # Ikon aplikasi
└── tests/
    ├── logic.test.js                # Pengujian logika bisnis
    └── smart-kasbon.test.js         # Pengujian snapshot keuangan
```

Skema Supabase mencakup `stores`, `store_members`, `store_invites`, `store_data` (payload AES-GCM), `key_envelopes` (kunci penyimpanan terenkripsi yang dibungkus dengan kata sandi akun untuk setiap anggota), serta ledger khusus Smart Kasbon. IndexedDB menyimpan salinan data bisnis dalam satu rekaman AES-GCM. Tabel lama dibersihkan saat migrasi pertama setelah masuk.

## Keamanan dan Batasan

- **Migrasi Supabase wajib diterapkan** sebelum pendaftaran dan akses basis data dapat digunakan. Terapkan Edge Functions untuk pendaftaran dan undangan asisten. URL proyek dan publishable key tidak memberikan izin untuk membuat skema. Jangan pernah menempatkan service-role key pada kode browser atau commit ke repository.
- URL Supabase dan publishable key untuk browser disimpan di `js/config.js`. Publishable key memang bersifat publik. Service-role key hanya boleh digunakan pada Edge Function.
- Data bisnis di server dan IndexedDB dienkripsi menggunakan AES-GCM. Kunci penyimpanan terenkripsi dibungkus dengan kata sandi menggunakan PBKDF2. Server tidak menerima data bisnis dalam bentuk terbuka, tetapi data tersedia di memori browser saat aplikasi digunakan.
- **Pengecualian metadata Smart Kasbon:** agar Supabase dapat menegakkan limit dan mengunci transaksi bersamaan, backend menyimpan nominal kasbon/pembayaran, tanggal, ringkasan keuangan agregat, dan ID pelanggan pseudonim. Nama serta nomor WhatsApp tetap berada di vault terenkripsi. Metadata ini tidak dienkripsi end-to-end seperti vault dan dapat dibaca operator proyek Supabase; pastikan pemilik menyetujui sebelum menerapkan migrasi.
- ID pelanggan, kasbon, dan pembayaran yang dikirim dari client diturunkan secara deterministik dengan SHA-256 dan namespace toko, tanpa secret salt. Ini adalah pseudonimisasi, bukan anonimisasi; metadata terkait tetap dapat dikaitkan dan ID asal yang diketahui dapat diuji. `actor_id` tetap ID pengguna autentikasi. Migrasi ke keyed hashing memerlukan pengelolaan kunci bersama perangkat dan migrasi identitas ledger.
- Snapshot finansial berasal dari vault pada browser dan backend hanya memvalidasi bentuk serta rentang nilainya. Backend tidak dapat membuktikan nilainya sama dengan transaksi terenkripsi; kas, modal kerja, kewajiban, dan cadangan juga merupakan input pemilik. Perlakukan hasil limit sebagai aturan internal berbasis input yang dipercaya, bukan pemeriksaan kas independen.
- Waktu pembayaran baru ditetapkan oleh waktu database server; tanggal pembayaran tidak dapat dipilih pada form. Riwayat yang di-bootstrap tetap memakai timestamp lama dari vault dan belum diverifikasi secara independen.
- Smart Kasbon tidak menerima kasbon baru atau pembayaran saat offline. Penghapusan riwayat transaksi lokal menandai ledger server sebagai batal saat koneksi tersedia; jika offline, aplikasi menyimpan permintaan pembersihan dan mencobanya saat pemilik membuka Kasbon kembali. Reset seluruh toko juga mereset kebijakan Smart Kasbon.
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
- Pendaftaran Owner tidak lagi memerlukan kode administrator. Pembuatan akun tetap melalui Edge Function server, dibatasi 10 percobaan per email per jam, dan trigger database hanya memberi peran Owner setelah memvalidasi reservasi internal sekali pakai yang dibuat server dan terikat ke email. Karena email tidak diverifikasi, alamat email bukan bukti kepemilikan mailbox. Asisten tetap wajib menggunakan kode sekali pakai dari Owner; kode berlaku tujuh hari dan terikat ke toko penerbit.
- Sesi dan kunci pembuka data disimpan pada perangkat setelah masuk agar aplikasi tidak meminta autentikasi ulang setiap kali dibuka. Gunakan hanya pada perangkat pribadi yang terlindungi. Pengguna lain yang dapat mengakses profil browser berpotensi membuka data toko. Tombol **Keluar** menghapus sesi dan kunci yang tersimpan pada perangkat.

## Pemecahan Masalah

| Masalah | Penyebab atau solusi |
|---|---|
| Halaman kosong atau aplikasi gagal dimulai | Pastikan aplikasi dijalankan melalui server web, bukan `file://`. Coba keluar dari mode privat browser. |
| Pemindai barcode tidak berfungsi | Jalankan `npm run build`. Sebagai alternatif, cari produk atau gunakan pemindai eksternal melalui kolom Kasir. |
| Pendaftaran Owner gagal | Owner tidak memerlukan kode administrator. Periksa email, kata sandi, nama toko, dan batas percobaan; masuk jika email tersebut sudah memiliki akun. Untuk Asisten, minta Owner membuat kode baru jika kode salah, kedaluwarsa, atau sudah dipakai. |
| Pendaftaran tidak membuat sesi | Periksa `auth.enable_signup = false` dan `auth.email.enable_confirmations = false` pada konfigurasi hosted, lalu deploy versi Edge Function `register-owner` yang terbaru. Periksa juga status sesi password setelah pembuatan akun. |
| Akun tidak terlihat di Table Editor | Akun berada di Authentication → Users. Pastikan migrasi basis data telah dijalankan. |
| Tabel `stores` tidak ditemukan | Jalankan migrasi SQL melalui Supabase Dashboard → SQL Editor, pastikan proses berhasil, lalu coba masuk kembali. |
| Undangan gagal atau terjadi masalah CORS | Deploy Edge Functions yang diperlukan dan pastikan secret `APP_URL` sama dengan origin aplikasi. |
| Smart Kasbon tidak dapat dimuat | Terapkan migrasi `202610240001_smart_kasbon.sql`, deploy Edge Function `smart-kasbon`, pastikan akun masuk dan koneksi tersedia. |
| Pemulihan akun tidak diproses | Terapkan migration keamanan akun, atur `RESET_RATE_LIMIT_SECRET`, deploy `account-recovery` dan `reset-password`, lalu gunakan Account Recovery Code yang masih berlaku. |
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
