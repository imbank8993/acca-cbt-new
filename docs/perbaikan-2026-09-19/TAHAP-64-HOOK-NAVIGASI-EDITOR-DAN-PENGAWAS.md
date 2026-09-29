# Tahap 64 — Hook navigasi, editor, dan Pengawas

Diperbarui 29 September 2026. Tahap ini menuntaskan seluruh temuan `react-hooks/*` tanpa mematikan atau melonggarkan aturan.

## Navigasi dan layout

- Bottom navigation memuat halaman yang disematkan, tombol aksi halaman, dan penutupan sheet melalui lifecycle yang memiliki cleanup timer serta subscription.
- Sidebar memakai callback stabil untuk profil dan peran; event pembaruan profil tidak lagi menangkap fungsi render lama.
- Pembacaan halaman yang disematkan dijadwalkan dan dibersihkan saat identitas pengguna berubah.
- Layout menutup navigasi mobile dan mengatur ulang posisi scroll melalui timer dengan cleanup ketika route berubah.

## Editor matematika dan opsi jawaban

- Pratinjau rumus di `MathEditor` dan dialog persamaan dihitung langsung dari input dengan memo, bukan disalin ke state melalui effect.
- Sinkronisasi nilai awal editor tetap dipertahankan dengan lifecycle yang dapat dibatalkan.
- Fungsi penyisipan pada posisi kursor dibuat stabil sehingga callback paste tidak berubah pada setiap render.
- Elemen MathLive memakai `MathfieldElement`, bukan cast objek bebas.

## Grafik dan halaman Pengawas

- Irisan pie chart dihitung dengan reducer sebelum render; render tidak lagi mengubah variabel sudut di luar callback.
- Dashboard dan monitoring Pengawas menjadwalkan pemuatan awal dengan cleanup, sedangkan auto-refresh tetap berjalan pada interval semula.
- Daftar ujian dan attempt Pengawas memakai `OrganizationExam` serta `ExamAttemptRecord`.

## Hasil

Lint frontend berubah dari **58 error/1 warning** pada akhir Tahap 63 menjadi **41 error/0 warning**. Tahap ini menghapus 18 masalah. Seluruh temuan hook sudah nol; sisa hanya 41 penggunaan `any`. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 41 masalah.

## Verifikasi

- TypeScript frontend tanpa incremental cache: lulus.
- Seluruh komponen dan halaman yang disentuh: lint nol.
- 12 regresi kualitas UI, kesetaraan halaman peran, dan konteks satu sekolah: lulus.
- ESLint frontend penuh: 41 error/0 warning; seluruhnya `@typescript-eslint/no-explicit-any`.

## Tahap berikutnya

Bersihkan 41 penggunaan `any` berdasarkan kelompok: jadwal massal PAS, editor TipTap dan layout ujian mobile, formulir soal, parser Excel, lalu route API serta helper kecil.
