# Audit hasil ujian — 14 Oktober 2026

## Kesimpulan

Nilai sudah tersimpan. Penyebab utama detail hasil tidak tampil adalah endpoint detail menggabungkan izin melihat nilai dengan izin melihat kunci jawaban. Data ujian lama memiliki `show_results = true`, tetapi metadata `show_answer_keys` belum diisi. Pemeriksaan keamanan kunci jawaban menolak seluruh halaman detail dengan HTTP 403, termasuk ringkasan nilai yang sebenarnya sudah boleh dilihat.

## Bukti dari database yang terhubung

Pemeriksaan dijalankan dalam transaksi `READ ONLY`; tidak mengubah nilai, status pengerjaan, maupun izin guru. Tidak mencatat identitas siswa atau kredensial.

- 12 ujian memiliki pengerjaan selesai, total 634 pengerjaan.
- 586 berstatus `submitted`, 48 `auto_submitted`.
- Seluruh 634 memiliki `total_score`; tidak ada yang menunggu penilaian otomatis atau manual.
- Seluruh 12 ujian belum memiliki metadata `show_answer_keys`.
- 11 ujian mengaktifkan `show_results`, mencakup 567 pengerjaan.
- `Try Out TKA 1 Bahasa Indonesia` menonaktifkan `show_results`, mencakup 67 pengerjaan. Nilai ujian ini memang belum diizinkan untuk dilihat siswa.

| Ujian | Pengerjaan selesai | Izin nilai |
| --- | ---: | --- |
| Fundamental Matematika Bentuk Akar | 54 | Aktif |
| Fundamental Matematika Perbandingan Berbalik Nilai | 50 | Aktif |
| Fundamental Persamaan Linear | 66 | Aktif |
| Fundamental Operasi Aljabar | 64 | Aktif |
| Fundamental Matematika 1 | 66 | Aktif |
| Try Out TKA 1 Bahasa Inggris | 65 | Aktif |
| Try Out TKA 1 Matematika | 60 | Aktif |
| TO TKA 1 Matematika (Susulan) | 2 | Aktif |
| Try Out TKA 1 Bahasa Indonesia | 67 | Nonaktif |
| TO TKA 1 Bahasa Indonesia (Susulan) | 1 | Aktif |
| Placement Test Kelas XII | 72 | Aktif |
| Pretest Matematika XI Wajib | 67 | Aktif |

## Jalur yang menyebabkan masalah

1. Pengumpulan menyimpan status selesai dan nilai pada `cbt_exam_attempts`.
2. Daftar `/api/students/results` mengambil status `submitted` dan `auto_submitted`. Nilai disamarkan jika `show_results` tidak aktif.
3. Halaman daftar mengizinkan membuka detail jika nilai dibuka dan penilaian manual selesai.
4. Endpoint `/api/students/attempts/:id` memeriksa pemilik, status selesai, dan `show_results`, kemudian memanggil `assertAnswerKeysReleased`.
5. Guard mensyaratkan `show_answer_keys = true`, jadwal ujian berakhir, serta tidak ada sesi aktif dengan batas waktu yang masih terbuka. Karena metadata kunci belum diisi, guard menolak sebelum ringkasan nilai dikembalikan.

Status selesai milik siswa juga berbeda dari berakhirnya jadwal seluruh ujian. Menyelesaikan pengerjaan lebih awal tidak otomatis membuka kunci jawaban.

## Temuan tambahan

- Kegagalan query riwayat nilai dikembalikan sebagai `[]`. Layar dapat menyebut “Belum Ada Hasil Ujian” padahal pembacaan database gagal. Ini ditemukan pada kode, bukan kegagalan yang terbukti terjadi pada data audit.
- Penilaian manual menonaktifkan seluruh tombol detail meskipun nilai sementara sudah diizinkan guru. Pada data audit, tidak ada pengerjaan yang sedang menunggu manual.
- Ujian dengan nilai disembunyikan belum memiliki penjelasan yang jelas pada kartu hasil.
- Kegagalan membaca attempt diperlakukan sebagai hasil tidak ditemukan. Kegagalan pemeriksaan sesi aktif juga diperlakukan sebagai izin pembahasan tertutup.

## Perbaikan pada kode lokal

- Ringkasan nilai kini dapat dikembalikan ketika `show_results = true`, meskipun kunci jawaban belum dibuka. Respons menyatakan `answerKeysReleased = false`, menyertakan alasan, serta tidak membaca atau mengirim soal, kunci, dan rincian jawaban.
- Pembahasan lengkap tetap mengikuti guard kunci jawaban. Izin melihat nilai tidak mengaktifkan kunci secara otomatis.
- Respons ringkasan hanya mengirim atribut hasil yang dibutuhkan; konfigurasi ujian dan payload pengumpulan tidak dikirim.
- Halaman detail menampilkan nilai klasik/IRT tanpa mensyaratkan adanya rincian soal, menjelaskan pembahasan yang tertutup, dan menyediakan pemeriksaan ulang.
- Nilai sementara dapat dibuka; penilaian tertunda diberi label yang sesuai.
- Kartu ujian yang izinnya belum aktif diberi label “NILAI BELUM DIBUKA GURU”.
- Kegagalan pembacaan data dikembalikan sebagai kesalahan server yang bisa dicoba ulang, bukan daftar kosong atau hasil tidak ditemukan.

## Verifikasi dan batas pemeriksaan

- Pemeriksaan tipe TypeScript frontend dan backend lulus.
- Seluruh 110 pengujian terkait hasil, keamanan kunci/media, pengumpulan, jadwal, serta penilaian dan pemulihan nilai lulus.
- Pengujian mencakup izin nilai/kunci yang terpisah, metadata ujian lama, jadwal yang belum berakhir, sesi pemulihan aktif, izin guru yang nonaktif, pemilik pengerjaan, penilaian manual, dan kegagalan database.
- Service hasil beserta adapter PostgreSQL diuji langsung dalam transaksi baca saja dengan satu sampel pengerjaan dari setiap 12 ujian: seluruh sampel muncul di daftar; 11 dapat membuka ringkasan nilai tanpa kunci; satu tetap ditolak untuk detail karena nilai belum diizinkan guru.
- Penilaian ulang tidak diperlukan berdasarkan audit ini; seluruh nilai sudah ada.
- Perubahan hanya diterapkan pada kode workspace. Audit ini tidak melakukan deployment/restart layanan, mengubah izin guru, atau memverifikasi tampilan dalam sesi browser siswa. Versi aplikasi yang sedang berjalan perlu memakai kode terbaru agar perbaikan berlaku di sana.

## Berkas utama

- `apps/api/src/students/students.service.ts`
- `apps/api/src/common/answer-key-release.ts`
- `apps/web/lib/api/students.ts`
- `apps/web/app/dashboard/siswa/results/page.tsx`
- `apps/web/app/dashboard/siswa/results/[attemptId]/page.tsx`
- `apps/api/test/student-results-release.test.cjs`
- `apps/api/test/answer-key-media-stage86.test.cjs`
