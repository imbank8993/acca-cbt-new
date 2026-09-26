# BUG-11 — Integritas soal dan jawaban historis

Tanggal perbaikan: 26 September 2026  
Prioritas: P1  
Status: implementasi dan tes lokal selesai

## Masalah

Jalur hapus soal memutuskan apakah sebuah soal pernah dipakai dengan membaca `cbt_exam_attempt_questions`. Alur ujian aktif tidak pernah menulis snapshot ke tabel tersebut; jawaban siswa disimpan di `cbt_answers`. Akibatnya, soal yang mempunyai jawaban nyata dapat dianggap belum pernah dipakai lalu dihapus secara fisik bersama opsinya.

Masalahnya lebih luas dari satu query. Menyunting teks/kunci, mengubah metadata atau urutan, menambah hasil impor, dan menghapus bank setelah peserta mulai mengerjakan juga mengubah sumber yang dipakai review dan grading. Soal yang tidak dijawab tidak mempunyai baris `cbt_answers`, padahal keberadaannya tetap menentukan nomor soal dan skor maksimum.

## Perilaku setelah perbaikan

1. Penghapusan membaca `cbt_answers.question_id` sebagai referensi aktual. Snapshot legacy tetap diperiksa agar arsip lama tidak kehilangan perlindungan.
2. Soal yang sudah direferensikan tidak dihapus secara fisik. Metadata lama digabung dengan `_deleted: true` dan `_deleted_at`; opsi dan jawaban tetap tersimpan.
3. Adanya attempt pada ujian yang memakai bank dianggap bukti bahwa seluruh komposisi bank sudah historis. Ini juga melindungi soal yang dilewati atau belum dijawab.
4. Bank historis menolak penambahan soal, sunting soal, patch metadata, perubahan urutan, dan impor massal. Pesan kesalahan mengarahkan operator membuat bank baru untuk versi berikutnya.
5. Bank yang direferensikan ujian tidak dapat dihapus. Pemeriksaan mencakup relasi langsung `cbt_exams.question_bank_id` dan relasi sumber `cbt_exam_question_sources.bank_id`.
6. Soal yang belum pernah masuk ke pengerjaan tetap dapat dihapus secara fisik; opsi dihapus lebih dulu di dalam transaksi yang sama.

## Skenario regresi yang diuji

- Jawaban nyata di `cbt_answers` menyebabkan soft delete walaupun tabel snapshot kosong.
- Soft delete mempertahankan baris jawaban, opsi, dan metadata soal yang sudah ada.
- Soal tanpa jawaban tetap dilindungi jika banknya sudah mempunyai attempt.
- Soal historis menolak sunting konten, patch metadata, dan reorder.
- Penambahan soal tunggal serta impor massal ditolak setelah attempt dimulai.
- Bank yang terhubung ke ujian tidak dapat dihapus.
- Soal yang belum dipakai tetap dapat dihapus secara fisik.
- Pemeriksaan kepemilikan bank tetap berjalan sebelum setiap perubahan.

Pengujian berada di `tools/test-question-services.cjs`; 13 pemeriksaan service lulus. TypeScript API juga lulus tanpa error.

## Keputusan desain

Repositori belum mempunyai snapshot soal per attempt yang aktif dipakai oleh seluruh jalur render dan grading. Karena itu, kebijakan aman saat ini adalah membekukan komposisi bank setelah attempt pertama dan mempertahankan data yang sudah dipakai. Perubahan pedagogis berikutnya dilakukan pada salinan bank, sehingga ujian lama tetap menunjuk versi lama.

Soft delete hanya menyembunyikan soal dari layar penyusunan dan hitungan soal aktif. Jalur historis tetap dapat membaca baris yang sama beserta opsinya. Pendekatan ini tidak bergantung pada asumsi cascade FK tertentu.

## Batas verifikasi dan rollout

- Tes lokal memakai database in-memory; constraint dan cascade PostgreSQL produksi tetap perlu diverifikasi di staging.
- Uji staging wajib mencakup jawaban terisi dan kosong, review siswa, monitoring staf, regrade, serta bank yang direferensikan melalui `cbt_exam_question_sources`.
- Terdapat celah waktu kecil antara pemeriksaan pemakaian dan attempt baru pada request yang berjalan benar-benar bersamaan. Snapshot/version bank di database merupakan peningkatan jangka panjang untuk menutup konkurensi tersebut sepenuhnya.
- Keseragaman jalur siswa untuk ujian legacy/multi-source telah diselesaikan pada tahap 10 (BUG-12). Validasi database staging untuk gabungan BUG-11/12 tetap diperlukan.
