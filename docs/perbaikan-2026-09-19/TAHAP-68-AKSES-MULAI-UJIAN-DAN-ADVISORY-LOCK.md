# Tahap 68 — Akses mulai ujian dan advisory lock

Diperbarui 29 September 2026. Tahap ini memperbaiki layar “Akses Ditolak” yang muncul sesudah siswa sah membuka ujian dan sebelum attempt berhasil dibuat.

## Audit kasus aktif

Ujian `Ujicoba` sudah aktif, dipublikasikan, tidak mempunyai batas waktu global, memakai bank berisi 15 soal, dan ditetapkan langsung kepada ANDI HERIL. Peserta tersebut memiliki profil, keanggotaan sekolah aktif, peran Siswa, kelas asal yang sesuai, dan belum mempunyai attempt.

Fungsi kebijakan akses backend yang dijalankan melalui adapter produksi menghasilkan `canAccess: true`. Detail ujian, profil, 15 soal, serta opsi juga berhasil dibaca. Dengan demikian penolakan bukan berasal dari penugasan, sekolah, kelas, status publikasi, waktu, atau bank soal.

## Penyebab

Sebelum membuat attempt, backend mengambil PostgreSQL transaction advisory lock agar dua tab tidak dapat membuat dua attempt aktif. Fungsi `pg_advisory_xact_lock` mengembalikan tipe PostgreSQL `void`. Adapter memakai Prisma `$queryRawUnsafe`, sedangkan Prisma tidak dapat mendeserialisasi kolom `void` dan melempar galat sebelum insert attempt.

Halaman ujian memakai judul “Akses Ditolak” untuk seluruh kegagalan saat pemuatan, termasuk galat teknis setelah kebijakan akses lolos. Karena itu judul tersebut seolah menunjukkan masalah izin, padahal kegagalan sebenarnya terjadi pada query pengunci transaksi.

## Perbaikan

- Ditambahkan helper advisory lock bersama yang mengubah hasil `void` menjadi `text` sebelum dibaca Prisma.
- Seluruh 16 pemakaian advisory lock dipindahkan ke helper tersebut: mulai ujian, arsip/hapus ujian, pembangkitan ujian, PAS, ruangan, konfigurasi ujian, serta penulisan konten soal.
- Parameter kunci tetap dikirim terpisah dan tidak digabung ke SQL.
- Penguncian tetap hidup sampai transaksi selesai; perubahan hanya membuat tipe hasil kompatibel dengan Prisma.
- Regresi memeriksa cast hasil dan memastikan tidak ada pemanggilan advisory lock langsung di luar helper.
- Judul kegagalan pemuatan diubah menjadi “Ujian Belum Dapat Dibuka”, karena keadaan tersebut juga mencakup gangguan server/jaringan dan soal kosong; alasan spesifik tetap ditampilkan.

## Verifikasi

- Kebijakan akses produksi untuk peserta kasus aktif: lulus.
- Detail ujian, profil, dan 15 soal melalui service serta adapter produksi: lulus.
- Advisory lock dengan cast melalui Prisma dan PostgreSQL aktif: lulus.
- Simulasi lock dan insert attempt untuk peserta aktif dalam transaksi rollback: lulus; tidak ada attempt atau ikatan perangkat diagnostik yang disimpan.
- Tiga regresi helper advisory lock dan label kegagalan UI: lulus.
- 62 regresi jalur attempt, arsip/hapus/generate ujian, sinkronisasi ujian, ruangan/sesi PAS, dan konten soal: lulus; bersama tiga regresi tahap ini totalnya 65 pemeriksaan.
- TypeScript backend tanpa incremental cache: lulus.
- Build shared package dan NestJS backend: lulus.

Tahap ini tidak membutuhkan migrasi atau perubahan data ujian. Siswa dapat mencoba membuka kembali ujian setelah proses backend memuat ulang kode.
