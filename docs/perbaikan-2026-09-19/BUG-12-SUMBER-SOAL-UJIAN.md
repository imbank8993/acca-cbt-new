# BUG-12 — Sumber soal ujian legacy dan multi-bank

Tanggal perbaikan: 26 September 2026  
Prioritas: P2  
Status: implementasi dan tes lokal selesai

## Masalah

Ujian baru biasanya menunjuk satu bank melalui `cbt_exams.question_bank_id`. Data legacy dan konfigurasi multi-bank dapat menunjuk bank melalui `cbt_exam_question_sources`. Sebelum perbaikan, layar siswa hanya menerima bank langsung, sementara submit dan regrade mempunyai fallback yang mengambil satu baris sumber pertama. Review, monitoring, analitik, ekspor, dan penilaian manual kembali memakai variasi berbeda.

Akibatnya sebuah ujian dapat dianggap valid dan dinilai backend tetapi tidak dapat dibuka siswa. Untuk ujian multi-bank, soal dari bank kedua dan seterusnya hilang dari sebagian jalur. Nilai maksimum, nomor soal, statistik, dan review dapat dihitung dari himpunan soal yang berbeda.

## Perilaku setelah perbaikan

1. `resolveExamBankIds` menggabungkan bank langsung dan semua sumber legacy.
2. Bank langsung berada di urutan pertama. Sumber tambahan dideduplikasi dan diurutkan berdasarkan ID bank karena tabel legacy tidak menyediakan kolom urutan eksplisit.
3. `loadExamQuestions` mengambil seluruh soal dengan satu query dan mengurutkannya berdasarkan urutan sumber, `metadata.order_index`, `created_at`, lalu ID soal.
4. Urutan sumber dipasang sebagai properti internal non-enumerable. Properti tersebut dapat dipakai pengurut bersama, tetapi tidak terserialisasi ke klien, ekspor, atau FastAPI.
5. Resolver bersama dipakai oleh tampilan siswa, submit, grading jawaban tersimpan, regrade, review hasil, monitoring, penilaian esai, analitik, dan ekspor ujian.
6. `ExamPage` selalu meminta soal berdasarkan ID ujian. Browser tidak lagi menentukan validitas sumber dari `question_bank_id` yang dapat kosong pada data legacy.
7. Kesalahan membaca tabel sumber menghasilkan kegagalan yang terlihat dan tidak diam-diam mengubah ujian menjadi tanpa soal.

## Skenario regresi

- Ujian tanpa `question_bank_id` dengan dua `cbt_exam_question_sources` menampilkan kedua soal.
- Grading menerima ID soal dalam himpunan dan urutan yang sama dengan layar siswa.
- Sumber bank duplikat hanya dihitung sekali.
- Ujian yang mempunyai bank langsung dan sumber tambahan memakai seluruh bank; bank langsung tetap pertama.
- Frontend tetap memanggil endpoint soal ketika bank langsung kosong.

Tes berada di `apps/api/test/question-sources-stage10.test.cjs`. Tiga tes BUG-12 lulus dan menaikkan gabungan tes Node menjadi 95. TypeScript API dan frontend lulus.

## Batas dan rollout

- Tabel sumber legacy tidak mempunyai urutan bisnis yang diketahui dari source code. Urutan UUID dipakai sebagai aturan deterministik. Jika database produksi memiliki kolom urutan resmi, resolver harus memakai kolom tersebut setelah schema dikonfirmasi.
- Tes menggunakan database in-memory. Staging PostgreSQL perlu memverifikasi nama kolom, constraint, volume query, dan data sumber nyata.
- Uji staging harus membandingkan daftar ID soal pada endpoint siswa, payload grading, review, monitoring, analitik, dan ekspor untuk ujian satu bank, legacy tanpa bank langsung, serta multi-bank.
- Snapshot/versioning bank yang sepenuhnya atomik tetap peningkatan jangka panjang sebagaimana dicatat pada BUG-11.
