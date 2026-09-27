# Tahap 41 — Pemulihan reload ujian saat offline

Diperbarui 28 September 2026. Tahap ini melanjutkan penyimpanan lokal Tahap 39 agar halaman ujian dapat dibuka kembali setelah reload atau browser tertutup ketika server masih tidak terjangkau.

## Temuan

Tahap 39 sudah menjaga jawaban selama halaman tetap terbuka, tetapi proses membuka halaman selalu meminta ulang identitas, rincian ujian, paket soal, dan status attempt. Saat jaringan putus, snapshot jawaban tersedia tetapi halaman tidak memiliki cukup data untuk menampilkan soal dan menghitung sisa waktu. Reload atau crash browser karena itu menghentikan pengerjaan.

Menggunakan cache secara langsung juga berbahaya. Paket milik siswa lain pada perangkat bersama dapat terbuka, jam lokal baru dapat memberi tambahan waktu, dan jawaban dapat terkirim ke attempt berbeda bila server telah mengubah status pengerjaan.

## Perbaikan

IndexedDB `acca-cbt-exam` dinaikkan ke versi 4 dan memperoleh store `recovery-sessions`. Setelah server berhasil memverifikasi seluruh pembukaan ujian, browser menyimpan DTO soal siswa, identitas siswa, profil tampilan, ujian, attempt, ID perangkat, deadline absolut, dan nomor soal terakhir. Kunci jawaban tidak ikut karena endpoint soal siswa menggunakan allowlist dan memang tidak mengirim `is_correct`, bobot, atau metadata kunci.

Saat request gagal karena jaringan atau server sementara tidak tersedia, halaman boleh memakai paket tersebut hanya jika:

- ID ujian sama;
- ID siswa sama bila sesi browser masih dapat dikenali;
- ID perangkat durable sama;
- objek siswa, ujian, dan attempt konsisten dengan ID paket;
- deadline absolut belum lewat.

Deadline disimpan sebagai waktu absolut. Reload menghitung sisa waktu dari `deadlineAt - Date.now()`, sehingga reload, tab di-background, atau timer browser yang terlambat tidak memberi tambahan waktu. Cache kedaluwarsa tidak membuka soal; snapshot jawaban tetap disimpan dan siswa diminta menyambungkan jaringan.

## Sinkronisasi aman setelah jaringan pulih

Halaman yang dipulihkan masuk mode terkunci jaringan. Autosave, sinkronisasi massal, heartbeat, event pengawasan, terminasi, dan submit tidak dikirim sebelum endpoint start memvalidasi ulang attempt.

Server harus mengembalikan attempt dengan ID yang sama. Jika status sudah selesai, waktu habis, akses dicabut, perangkat berubah, atau ID attempt berbeda, paket soal dibuang dan jawaban tidak dikirim. Snapshot jawaban dipertahankan agar proktor masih dapat memakai alur pemulihan yang sudah tersedia. Jika validasi berhasil, deadline diganti dengan sisa waktu terbaru dari server, seluruh snapshot disinkronkan, event pengawasan dikirim, dan submit tertunda dilanjutkan.

Fallback hanya berlaku untuk galat bertanda `retryable`, seperti putus jaringan, timeout, HTTP 408/429, atau HTTP 5xx. HTTP 401/403/404 dan penolakan bisnis dari endpoint start tidak pernah dialihkan ke cache. Pemeriksaan ulang berjalan saat event `online` dan setiap 15 detik untuk kasus Wi-Fi tampak aktif tetapi API sempat tidak tersedia.

## Pembersihan dan privasi perangkat bersama

Paket soal dihapus setelah submit dikonfirmasi server, setelah server menolak kelanjutan attempt secara eksplisit, dan ketika pengguna menekan Logout. Snapshot jawaban tidak dihapus pada penolakan atau auto-submit yang hanya memakai jawaban server karena masih diperlukan untuk pemulihan proktor.

Pemulihan data memerlukan IndexedDB. Jika browser hanya menyediakan fallback `localStorage`, jawaban masih tersimpan seperti Tahap 39 tetapi reload offline tidak dijamin. Mode privat, pembersihan data situs, pergantian profil browser, dan perpindahan perangkat tetap memutus cache karena ID perangkat atau data IndexedDB berubah.

Tahap 42 kemudian menambahkan service worker khusus shell ujian. Dokumen halaman dan aset same-origin yang diperlukan kini mempunyai fallback offline tanpa ikut menyimpan API atau halaman dashboard lain.

## Verifikasi

Tujuh tes `RECLOAD-01` sampai `RECLOAD-07` memeriksa ikatan ujian/siswa/perangkat, penolakan paket yang tidak konsisten, deadline absolut, fallback khusus galat retryable, validasi ulang attempt sebelum sinkronisasi, isi paket recovery, serta pembersihan setelah submit/logout.

Tes Tahap 39 dan Tahap 17 dijalankan ulang untuk memastikan urutan local-first dan fallback penyimpanan tetap bekerja. TypeScript frontend lulus. Regresi lengkap setelah tahap ini menghasilkan 270 tes Node pada 40 berkas tanpa kegagalan.

## Berkas utama

- `apps/web/app/components/questions/ExamPage.tsx`
- `apps/web/lib/exam-durable-storage.ts`
- `apps/web/lib/api/students.ts`
- `apps/web/app/components/Header.tsx`
- `apps/api/test/offline-reload-recovery-stage41.test.cjs`
