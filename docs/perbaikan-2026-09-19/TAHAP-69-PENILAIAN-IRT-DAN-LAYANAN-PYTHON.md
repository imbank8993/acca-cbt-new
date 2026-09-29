# Tahap 69 — Penilaian, IRT, dan layanan Python

Diperbarui 29 September 2026. Tahap ini mengaudit jalur nilai dari jawaban siswa sampai nilai tersimpan, termasuk submit normal, auto-submit, koreksi esai, nilai relatif kuis, IRT, keamanan layanan Python, dan kondisi layanan mati.

## Kesimpulan audit

Mesin penilaian Python bekerja untuk jalur nilai utama. Endpoint kesehatan merespons, permintaan tanpa kunci ditolak 401, dan permintaan sah menghitung nilai berbobot dengan benar. Nilai klasikal dan IRT tetap merupakan dua hasil yang berbeda:

- nilai klasikal adalah poin yang diperoleh dibagi total bobot soal;
- nilai IRT memperkirakan kemampuan dari pola benar/salah, tingkat kesulitan, daya beda, dan parameter tebakan sesuai model 1PL/2PL/3PL;
- field `detailed_scores.classical` hanya menjadi pembanding di hasil IRT, sedangkan `score_irt` tetap berasal dari model IRT yang dipilih.

Submit memanggil Python sebelum transaksi ditutup. Bila Python gagal, attempt tidak ditandai selesai sehingga siswa dapat mencoba submit kembali. Auto-submit menilai jawaban yang sudah tersimpan. Jawaban esai dibuat sebagai baris menunggu koreksi, nilai manual divalidasi terhadap bobot maksimum, lalu total attempt dihitung ulang. IRT menolak perhitungan selama masih ada esai yang belum dinilai.

## Temuan dan perbaikan

### SCORE-IRT-01 — Soal yang dilewati hilang dari matriks IRT

Query lama hanya mengirim baris `cbt_answers`. Jika siswa melewati sebuah soal dan tidak pernah mempunyai baris jawaban, soal itu tidak masuk penyebut nilai pembanding dan tidak masuk respons IRT. Backend sekarang memuat seluruh soal sumber ujian dan membentuk matriks peserta × soal. Soal tanpa jawaban dikirim sebagai respons kosong dengan skor nol.

### SCORE-IRT-02 — Pembanding klasikal mengabaikan bobot soal

Implementasi Python lama memakai jumlah respons benar dibagi jumlah butir. Pada soal berbobot 10 dan 2, satu jawaban benar pada soal berbobot 10 sebelumnya dibaca 50, padahal nilai klasikalnya 83,33. Perhitungan pembanding klasikal sekarang memakai skor jawaban tersimpan dan jumlah `score_default`. Ini tidak mengubah rumus theta atau skor IRT.

### OPS-SCORE-01 — API terlihat sehat saat Python mati

Health API lama hanya memeriksa PostgreSQL dan adapter query. Akibatnya monitoring dapat menyatakan sistem sehat meski submit nilai akan gagal. `/health` sekarang juga memeriksa FastAPI dan mengembalikan `ok: false` bila layanan skoring tidak tersedia.

### OPS-SCORE-02 — Mode reload Python tidak stabil di Windows

`dev:scoring` selalu memakai reload multiproses. Pada lingkungan Windows yang menolak named pipe, proses reloader mengikat port 8000 tetapi worker gagal hidup. Mode stabil tanpa reload sekarang menjadi default. Hot reload tetap dapat dipakai dengan `SCORING_RELOAD=1`.

## Audit database aktif

- 346 attempt selesai: 331 `submitted` dan 15 `auto_submitted`.
- 0 nilai total kosong.
- 0 nilai total di luar rentang 0–100.
- 0 attempt masih menunggu koreksi manual.
- 11.323 jawaban objektif diperiksa; tidak ada skor di luar bobot maksimum.
- 598 rincian jawaban lama pada 16 attempt masih memiliki `score/is_correct` kosong, walaupun nilai total attempt tersedia.
- Pembandingan ulang tanpa menulis database mencakup 346 attempt pada 10 ujian. Sebanyak 279 attempt pada 9 ujian cocok dengan mesin saat ini.
- Seluruh 67 attempt pada `Pretest Matematika XI Wajib` berbeda bila dihitung memakai bank dan kunci saat ini; selisih terbesar 10,425457 poin. Nilai tersebut tidak diubah karena regrade historis terhadap kunci yang mungkin sudah berubah memerlukan keputusan akademik dan snapshot kunci lama.

Audit dapat diulang dengan `npm run audit:scoring`. Skrip hanya membaca database dan memanggil Python; tidak menulis nilai.

## Verifikasi

- 101 tes Python: lulus.
- Empat regresi penilaian backend, termasuk esai manual dan kelengkapan soal IRT: lulus.
- Dua regresi health layanan skoring: lulus.
- Build NestJS: lulus.
- Uji HTTP: health 200, tanpa API key 401, nilai 10/20 menjadi 50, dan contoh berbobot menampilkan klasikal 83,33 sementara skor IRT tetap 50.
- Layanan Python berhasil dijalankan stabil pada `127.0.0.1:8000` tanpa mode reload.

Tidak ada migrasi database pada tahap ini.
