# Tahap 47 — Monitoring ujian bertipe

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- Halaman monitoring Admin, Guru, dan Proktor memakai kontrak yang sama untuk ujian, attempt siswa, analisis butir, opsi jawaban, dan kejadian pelanggaran.
- Kontrak attempt dilengkapi kelas, jumlah serta rincian pelanggaran, status koneksi, skor klasik/IRT, dan nilai akhir. Data tersebut tidak lagi dibaca melalui `any`.
- Analisis butir membedakan jawaban benar, salah, dan belum dinilai; nama siswa yang terkait dengan setiap jawaban tetap disusun dari attempt yang sesuai.
- Pemuatan awal, pergantian ujian terpilih, refresh manual, refresh berkala, dan pembacaan pelanggaran memakai callback stabil serta cleanup timer/interval.
- Pergantian ujian menjadwalkan reset halaman analisis dan pengosongan data, sehingga effect tidak lagi memicu pembaruan state secara sinkron.
- Perlindungan terhadap respons lama pada halaman Proktor tetap dipertahankan melalui nomor generasi permintaan. Respons dari ujian sebelumnya tidak boleh menimpa ujian yang baru dipilih.

## Hasil

Lint frontend berubah dari **634 error/43 warning** pada akhir Tahap 46 menjadi **555 error/31 warning**. Tahap ini menghapus 91 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 586 masalah.

Sisa saat ini:

- 523 penggunaan `any`;
- 31 dependency hook;
- 17 pembaruan state langsung di effect;
- 13 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Tiga halaman monitoring: lint nol.
- ESLint frontend penuh: 555 error/31 warning.
- `git diff --check`: tidak menemukan whitespace error sebelum dokumentasi tahap ini ditulis.

## Tahap berikutnya

Bersihkan tiga editor bank soal per peran dan komponen pengerjaan/penampilan soal. Area ini masih menyumbang banyak `any` dan paling dekat dengan alur impor, pratinjau, serta penyajian soal kepada siswa.
