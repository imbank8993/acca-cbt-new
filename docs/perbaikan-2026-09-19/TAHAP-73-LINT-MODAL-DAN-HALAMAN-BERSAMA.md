# Tahap 73 — Lint modal dan halaman bersama kembali nol

Diperbarui 29 September 2026. Refactor halaman ujian dan bank soal sempat menambah 4 error serta 47 warning setelah baseline lint nol pada Tahap 65. Seluruh temuan tersebut sudah dibersihkan.

## Lifecycle state modal

Modal pembuatan ujian, penugasan ujian, dan pembuatan bank sebelumnya mengubah banyak state secara sinkron dari badan `useEffect`. React menandainya sebagai risiko render berantai. Inisialisasi sekarang dijadwalkan ke giliran event berikutnya dan selalu dibatalkan saat dependency berubah atau komponen ditutup. Penugasan ujian juga memakai objek ujian lengkap sebagai dependency sehingga perubahan status publik maupun metadata tidak memakai state lama.

Sinkronisasi daftar siswa kelas tetap mempertahankan hasil pemuatan lokal, tetapi tidak lagi menulis state langsung selama effect sedang dievaluasi.

## Kode dan gambar yang tidak terpakai

Tiga halaman ujian per peran tidak lagi membawa action, tipe, ikon, helper waktu, dan konfigurasi nilai yang sudah dipindahkan ke modal bersama. Tiga halaman bank soal juga dibersihkan dari action upload/label lama.

Gambar sampul bank pada tampilan desktop, mobile, dan modal sekarang memakai `next/image` dengan ukuran eksplisit. URL sampul tetap boleh berasal dari storage aplikasi melalui mode `unoptimized`, sehingga perubahan ini tidak mengubah sumber gambar yang sudah tersimpan.

## Verifikasi

- ESLint frontend penuh: 0 error dan 0 warning.
- TypeScript frontend: lulus tanpa error.
- Build produksi Next.js: lulus, 92 halaman diproses.
- Empat regresi kualitas UI: lulus.
- Empat regresi kesetaraan halaman peran: lulus.
- `git diff --check`: tidak menemukan kesalahan whitespace.

Build pertama di sandbox gagal mengambil tiga Google Fonts karena jaringan dibatasi. Build diulang dengan akses jaringan dan berhasil; kegagalan pertama bukan kesalahan sumber aplikasi.
