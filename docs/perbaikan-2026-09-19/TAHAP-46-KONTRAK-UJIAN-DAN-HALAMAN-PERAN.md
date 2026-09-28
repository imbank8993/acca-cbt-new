# Tahap 46 — Kontrak ujian dan halaman peran

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- API proktor sekarang mempunyai kontrak eksplisit untuk organisasi, tahun ajaran, mata pelajaran, kelas, siswa, ujian, attempt, jawaban, log keamanan, login terbaru, dan pengumpulan tugas.
- Metadata ujian yang dipakai antarmuka—termasuk mode aman, akses publik, lampiran tugas, dokumen, video, dan tipe berkas—tidak lagi dibaca melalui `any`.
- Halaman tugas Admin, Guru, dan Proktor memakai kontrak ujian serta pengumpulan tugas yang sama. Pemuatan awal dijadwalkan dengan cleanup sehingga tidak memperbarui state secara sinkron dari effect.
- Kartu login terbaru Admin dan Proktor memakai tipe login yang sama dan memeriksa keberadaan waktu login secara aman.
- Daftar bank soal Admin, Guru, dan Proktor memakai kontrak bank, folder, label, organisasi, dan mata pelajaran. Pemuatan data dibuat sebagai callback stabil; refresh saat jendela kembali aktif tetap dipertahankan dengan cleanup listener.
- Filter, pengurutan, pengelompokan folder, dan pagination bank soal dihitung dari data bertipe tanpa memo manual yang tidak dapat dijamin React Compiler.
- Daftar ujian Admin, Guru, dan Proktor memakai kontrak ujian, kelas, siswa, bank soal, konfigurasi ujian, mapel, dan tahun ajaran yang nyata. Seluruh penggunaan `any` dan pelanggaran lifecycle pada ketiga halaman tersebut dihapus.
- Kontrak bank soal dilengkapi jumlah soal, sedangkan kontrak siswa dilengkapi email. Nilai tanggal opsional dan tipe ujian dinormalisasi sebelum dipakai oleh antarmuka.

## Hasil

Lint frontend berubah dari **871 error/52 warning** pada akhir Tahap 45 menjadi **634 error/43 warning**. Tahap ini menghapus 246 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 677 masalah.

Sisa saat ini:

- 593 penggunaan `any`;
- 43 dependency hook;
- 20 pembaruan state langsung di effect;
- 19 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- API proktor serta halaman tugas, login terbaru, daftar bank soal, dan daftar ujian yang disentuh: lint nol.
- ESLint frontend penuh: 634 error/43 warning.
- `git diff --check`: tidak menemukan whitespace error sebelum dokumentasi tahap ini ditulis.

## Tahap berikutnya

Gunakan kontrak proktor yang sama pada tiga halaman monitoring. Setelah itu bersihkan editor bank soal per peran dan komponen pengerjaan ujian, karena area tersebut masih menjadi penyumbang `any` terbesar dan langsung berkaitan dengan pengawasan serta perekaman jawaban.
