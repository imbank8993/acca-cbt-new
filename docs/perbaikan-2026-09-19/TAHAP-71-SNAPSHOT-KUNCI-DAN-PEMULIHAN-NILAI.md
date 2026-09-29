# Tahap 71 — Snapshot kunci dan pemulihan nilai auto-submit

Diperbarui 29 September 2026. Tahap ini menutup dua risiko tertinggi yang tersisa dari audit penskoran: perubahan bank soal setelah ujian dan auto-submit yang sudah tertutup tetapi belum mendapat nilai karena layanan Python sempat gagal.

## Snapshot soal dan kunci

Tabel `cbt_exam_question_snapshots` menyimpan satu paket JSON lengkap per soal dan ujian: teks, tipe, bobot, metadata, dimensi, tingkat kesulitan, revisi, opsi, kunci, bobot opsi, stimulus, dan instruksi. Snapshot dibuat atomik saat soal ujian pertama kali dibuka atau attempt baru dibuat. Advisory lock per ujian mencegah dua request membentuk dua versi berbeda.

Pemuatan soal siswa, submit normal, auto-submit, regrade, IRT, dan review hasil sekarang memakai snapshot yang sama. Perubahan berikutnya pada bank tidak mengubah kunci atau bobot ujian yang sudah dibekukan.

Ujian lama diperlakukan khusus. Jika sudah mempunyai attempt tetapi belum memiliki snapshot, aplikasi tetap dapat membacanya memakai bank saat ini, tetapi tidak menyimpan keadaan sekarang seolah-olah itulah versi historis. Regrade dan penghitungan ulang IRT ditolak dengan pesan yang jelas. Kebijakan ini melindungi 67 attempt `Pretest Matematika XI Wajib` yang auditnya membuktikan akan berubah sampai 10,43 poin bila dihitung dengan kunci sekarang.

Snapshot ikut backup versi 3.0, restore, serta penghapusan eksplisit ujian uji coba.

## Antrean pemulihan nilai

Status `auto_submitted` dengan `total_score` kosong sekarang menjadi antrean durable di database. Monitoring tetap memeriksa antrean meskipun tidak ada attempt aktif. Setelah Python kembali sehat, jawaban tersimpan dinilai ulang secara idempoten, total dan `base_score` disimpan, lalu skor relatif kuis dihitung bila diperlukan.

Kegagalan retry tidak membuka kembali ujian dan tidak menghapus jawaban. Metadata attempt mencatat jumlah retry, waktu, serta pesan ringkas. Indeks parsial `cbt_exam_attempts_pending_auto_grading` membuat pencarian antrean tidak memindai seluruh riwayat.

## Migrasi permanen

Migrasi `20260929_01_exam_question_snapshots_and_grading_queue.sql` telah dijalankan dua kali pada database aktif untuk membuktikan idempotensi.

Hasil verifikasi:

- tabel snapshot tersedia;
- indeks antrean tersedia;
- snapshot awal 0, sesuai desain lazy freeze;
- auto-submit tanpa nilai 0;
- attempt aktif yang dibuat sebelum migrasi 0, sehingga tidak diperlukan backfill darurat;
- tidak ada nilai atau soal historis yang diubah.

## Verifikasi kode

- Enam regresi baru snapshot/retry: lulus.
- Regresi mulai ujian, grading, backup, restore, dan penghapusan ujian: lulus.
- Build NestJS: lulus.
- 102 tes Python: lulus.
- Migrasi database aktif: lulus dan idempoten.

## Batas historis

Snapshot tidak dapat menciptakan kembali versi kunci yang sudah terlanjur hilang. Karena itu ujian lama tanpa snapshot tidak dinilai ulang otomatis. Nilai historisnya tetap tersimpan apa adanya.
