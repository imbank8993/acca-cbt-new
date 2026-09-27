# Tahap 28 — Integritas pembuatan dan penyuntingan isi bank soal

Diperbarui 27 September 2026. Tahap ini melindungi soal, opsi, stimulus, petunjuk, dimensi, interpretasi, kisi-kisi, dan impor konten dari duplikasi akibat respons hilang serta konflik edit dua tab.

## Temuan

Penyimpanan soal dan opsi sebenarnya sudah memakai transaksi database. Bila penulisan salah satu opsi gagal, soal dan perubahan opsi lain ikut rollback. Namun, transaksi itu tidak menyelesaikan kondisi ketika seluruh transaksi berhasil lalu respons ke browser hilang: retry membuat soal kedua dengan opsi baru.

Pembuatan kisi-kisi, stimulus, petunjuk, dimensi, dan interpretasi juga memakai insert biasa. Impor stimulus/petunjuk melakukan insert batch atomik, tetapi mengulang batch setelah timeout menggandakan seluruh baris.

Endpoint soal memakai `PUT` untuk dua arti sekaligus: payload dengan `id` berarti edit, sedangkan payload tanpa `id` berarti membuat soal. Karena itu helper `apiCreate()` yang selalu memakai `POST` tidak dapat langsung digunakan.

Terakhir, penyuntingan soal tidak mempunyai pemeriksaan versi. Dua tab dapat membuka revisi yang sama; simpan dari tab kedua menimpa perubahan tab pertama tanpa peringatan.

## Perbaikan retry-safe

Helper browser kini menyediakan `apiIdempotentMutation()` untuk operasi create legacy yang memakai `PUT`. `saveQuestionAction()` memilih jalur berdasarkan payload:

- soal baru tanpa `id` memakai `PUT` idempoten dengan UUID request;
- edit dengan `id` tetap memakai `PUT` biasa dan pemeriksaan revisi.

DTO mewajibkan `clientRequestId` hanya untuk soal baru. Server mengunci kunci request dengan advisory lock di dalam transaksi, lalu membuat soal melalui `insertIdempotentlyWithStatus()`. Jika request adalah replay, server mengembalikan ID soal lama dan tidak menghapus atau membuat ulang opsi. Jika request baru, soal, seluruh opsi, dan pembaruan waktu bank disimpan dalam transaksi yang sama.

Kisi-kisi, stimulus, petunjuk, dimensi, dan interpretasi memakai kunci yang dibatasi bank atau dimensi induknya. Impor stimulus/petunjuk:

1. memakai satu UUID batch;
2. menurunkan UUID stabil untuk setiap baris valid;
3. mengambil advisory lock batch;
4. menulis seluruh baris dalam satu transaksi;
5. pada retry, mengembalikan baris lama tanpa membuat duplikat.

Baris kosong tetap dilewati dan dilaporkan seperti perilaku sebelumnya.

## Perlindungan edit dua tab

Tabel soal sekarang mempunyai kolom `revision` positif dengan nilai awal 1. Semua editor mengirim `expectedRevision` dari soal yang dibuka.

Saat edit, server:

1. mengunci baris soal dengan `FOR UPDATE`;
2. membaca revisi terkini;
3. menolak perubahan jika revisi browser sudah lama;
4. menyimpan soal dan opsi secara atomik;
5. menaikkan revisi satu angka.

Pengguna menerima pesan untuk memuat ulang halaman. Versi lama tidak ditimpa.

## Migrasi dan status rollout

Dua migrasi tahap ini telah diterapkan permanen ke `acca_db`:

- `20260927_03_idempotent_question_content.sql` menambahkan 12 kolom request/hash dan 6 indeks unik pada enam tabel isi bank;
- `20260927_04_question_revision.sql` menambahkan kolom `revision` wajib, default 1, serta check constraint revision positif.

Keduanya terlebih dahulu lulus dry run dan pengujian ulang DDL. Setelah commit permanen, koneksi baru memastikan 12/12 kolom, 6/6 indeks, kolom revision, default, sifat `NOT NULL`, dan constraint tersedia.

## Verifikasi

Tujuh tes `QID-01` sampai `QID-07` membuktikan:

- retry soal mengembalikan ID lama;
- ID opsi tidak berubah saat replay;
- payload berbeda dengan kunci sama ditolak atomik;
- stimulus dan impor aman diulang;
- create/edit memilih jalur HTTP yang benar;
- enam tabel dilindungi migrasi;
- transaksi dan advisory lock tetap digunakan;
- revisi lama dari tab kedua tidak menimpa edit terbaru.

Hasil akhir:

- 179 tes regresi Node dalam 27 berkas: lulus;
- typecheck frontend setelah regenerasi route types: lulus;
- build shared dan backend: lulus;
- dry run 11 migrasi, 28 kolom, dan 27 indeks: lulus;
- migrasi tahap 28: diterapkan permanen dan diverifikasi.

## Batas lanjutan

Pemeriksaan revisi baru diterapkan pada soal, karena perubahan soal dan opsi langsung memengaruhi tampilan serta penilaian siswa. Edit stimulus, petunjuk, dimensi, interpretasi, dan kisi-kisi masih memakai last-write-wins. Risiko tersebut lebih rendah, tetapi dapat diberi revision jika penggunaan multi-tab pada editor pendamping sering terjadi.

Tahap berikutnya perlu mengaudit pembangkitan ujian dari jadwal PAS dan konfigurasi, khususnya respons hilang setelah sebagian ujian terbentuk.

## Berkas utama

- `apps/api/src/questions/questions.service.ts`
- `apps/api/src/questions/bank-content.service.ts`
- `apps/web/lib/api/client.ts`
- `apps/web/lib/api/questions.ts`
- `database/migrations/20260927_03_idempotent_question_content.sql`
- `database/migrations/20260927_04_question_revision.sql`
- `apps/api/test/question-content-idempotency-stage28.test.cjs`
