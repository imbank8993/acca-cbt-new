# Tahap 55 — Transfer soal dan kelas staf

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan transfer soal

- `portableQuestion` memiliki kontrak untuk soal, opsi, stimulus, petunjuk, kisi-kisi, dan dimensi.
- ID bank sumber tetap dilepas, sedangkan isi kaya, kunci jawaban, bobot, dan metadata yang aman dipertahankan.
- Urutan opsi memakai nilai `order` yang tervalidasi dan fallback stabil.
- Kunci soal ordering hanya diproses sebagai array; referensi ID, huruf, indeks nol, dan indeks satu dinormalisasi ke urutan portabel.
- Ekspor dan impor massal memakai kontrak transfer yang sama.

## Perbaikan kelas staf

- Kelas, organisasi, siswa, target edit, dan target hapus memakai kontrak API Proktor yang sama.
- Kontrak kelas mencakup program, kode gabung, jumlah siswa, dan izin edit/hapus yang memang dipakai UI.
- Admin dan Proktor kembali memiliki implementasi yang setara, dengan cache terpisah untuk masing-masing peran.
- Halaman Guru memakai kontrak kelas yang sama untuk kelas tambahan.
- Refresh awal dan refresh saat fokus memakai callback stabil, timer, serta cleanup listener.
- Data impor spreadsheet kelas dibaca sebagai `Record<string, unknown>` sebelum dikonversi.
- Pengelompokan per tahun ajaran tidak lagi memakai array tanpa tipe.
- Penyalinan kode gabung menolak kode kosong dan menangani promise Clipboard API secara eksplisit.

## Hasil

Lint frontend berubah dari **321 error/24 warning** pada akhir Tahap 54 menjadi **267 error/21 warning**. Tahap ini menghapus 57 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 288 masalah.

Sisa saat ini:

- 243 penggunaan `any`;
- 21 dependency hook;
- 14 pembaruan state langsung di effect;
- 8 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Transfer soal serta halaman kelas Admin, Proktor, dan Guru: lint nol.
- ESLint frontend penuh: 267 error/21 warning.

## Tahap berikutnya

Bersihkan kontrak PAS karena halaman detail jadwal dan modal ruangan merupakan kelompok temuan terbesar berikutnya. Setelah itu lanjutkan halaman analitik ujian dan penilaian Guru.
