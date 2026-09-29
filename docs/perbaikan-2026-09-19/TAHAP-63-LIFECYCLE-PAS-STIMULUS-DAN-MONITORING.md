# Tahap 63 — Lifecycle PAS, stimulus, dan monitoring

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Daftar periode PAS

- Halaman Admin dan Proktor memakai tipe pengguna sesi, organisasi, periode, dan mata pelajaran yang sama dengan kontrak API.
- Fungsi pemuatan dibuat stabil dan menjadi dependency effect yang eksplisit.
- Pemuatan awal dijadwalkan dengan timer yang dibersihkan saat unmount. Refresh saat jendela kembali fokus tetap aktif tanpa menangkap fungsi render lama.
- Cache peran dan tujuan halaman kelola PAS tetap terpisah antara Admin dan Proktor.

## Pengelola stimulus

- Daftar stimulus memakai `BankTextItem`, sedangkan pratinjau impor memakai `ImportRow`.
- Editor hanya menerima stimulus yang memiliki kontrak ID, judul, dan konten.
- Pemuatan berdasarkan bank memakai callback stabil, timer awal dengan cleanup, dan `await` pada refresh sesudah impor, simpan, serta hapus.

## Detail monitoring tiga peran

- API Proktor sekarang mempunyai kontrak khusus untuk attempt lengkap, jawaban beserta soal, dan log keamanan.
- Admin, Guru, dan Proktor memakai kontrak yang sama, dengan cache yang tetap dipisahkan per peran dan per ID attempt.
- Nilai kosong ditangani sebagai nol saat menentukan warna skor; log keamanan memiliki waktu, tipe kejadian, dan durasi bertipe eksplisit.
- Effect pemuatan menyatakan setter cache sebagai dependency sehingga perpindahan attempt tidak memakai state lama.

## Analitik Guru

- Effect analitik menyatakan setter daftar ujian dan loading sebagai dependency.
- Pembatasan data tetap dilakukan server berdasarkan sesi Guru.

## Hasil

Lint frontend berubah dari **84 error/8 warning** pada akhir Tahap 62 menjadi **58 error/1 warning**. Tahap ini menghapus 33 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 59 masalah.

Sisa saat ini:

- 47 penggunaan `any`;
- 10 pembaruan state langsung di effect;
- 1 dependency hook;
- 1 pelanggaran immutability hook.

## Verifikasi

- TypeScript frontend tanpa incremental cache: lulus.
- Seluruh halaman dan kontrak yang disentuh: lint nol.
- 31 regresi PAS, lifecycle monitoring, dan tren analitik: lulus.
- ESLint frontend penuh: 58 error/1 warning.

## Tahap berikutnya

Selesaikan 12 masalah hook terakhir pada navigasi, layout, editor matematika, halaman Pengawas, kartu opsi jawaban, dan grafik. Setelah lifecycle bersih, lanjutkan 47 penggunaan `any` yang tersisa.
