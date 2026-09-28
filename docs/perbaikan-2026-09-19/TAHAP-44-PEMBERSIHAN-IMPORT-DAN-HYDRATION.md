# Tahap 44 — Pembersihan import dan hydration

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol dengan pembersihan import berbasis TypeScript dan penggantian pola `mounted` yang memperbarui state dari effect.

## Perbaikan

- TypeScript Language Service menghapus import yang terbukti tidak dipakai dan menata import secara konsisten pada frontend.
- `useClientMounted` memakai `useSyncExternalStore`, sehingga modal dan portal dapat membedakan render server/client tanpa `setState` di dalam effect.
- `useMediaQuery` menyediakan status viewport yang dapat dilanggan dan aman saat SSR.
- Image cropper, modal umum, multi-select, maintenance screen, dan matching interaktif memakai kedua hook tersebut.
- Dynamic chart memakai `next/dynamic`; state khusus untuk lazy import dihapus.
- Preview modal langsung memakai prop `isOpen`, tanpa menyalinnya ke state.
- Pemuatan awal notification bell dan halaman notifikasi dijadwalkan melalui lifecycle timer yang dibersihkan.
- Kartu login admin/proktor langsung memakai `initialLogins`, sehingga tidak lagi menggandakan prop ke state.
- Perbaikan otomatis ESLint yang aman diterapkan untuk deklarasi `const` dan ekspresi sederhana.

Percobaan mengganti `any` menjadi `unknown` dilakukan dengan diagnostik TypeScript per berkas. Perubahan yang merusak bentuk kontrak API dibatalkan setelah pemeriksaan penuh menemukan dampaknya pada pemanggil. Kontrak API tersebut harus diganti dengan interface domain, bukan `unknown` generik.

## Hasil

Lint frontend berubah dari hasil akhir Tahap 43 sebesar 1.167 error/555 warning menjadi 1.128 error/318 warning. Tahap ini membersihkan 276 masalah tambahan. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 1.446 masalah.

Aturan lint tetap aktif. Angka belum nol; sisa terbesar adalah 1.022 penggunaan `any`, 255 variabel lokal/parameter tidak terpakai, serta kelompok hooks pada halaman dashboard lama.

## Verifikasi

- TypeScript frontend: lulus setelah seluruh perubahan dan setelah rollback kontrak API yang tidak aman.
- Komponen hydration/modal/chart sasaran: nol masalah `react-hooks/*`.
- ESLint frontend penuh: 1.128 error/318 warning.

## Tahap berikutnya

Definisikan interface respons API untuk soal, siswa, PAS, analytics, dan guru. Setelah kontrak data tersedia, ganti `any` pada halaman konsumen. Bersihkan hooks pada halaman monitoring dan halaman daftar ujian/soal tiga peran, kemudian selesaikan aksesibilitas.
