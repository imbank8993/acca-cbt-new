# Tahap 43 — Pembersihan lint hooks pada alur bank soal

Diperbarui 28 September 2026. Tahap ini memulai pengurangan utang lint berdasarkan risiko, dimulai dari hooks dan state pada komponen yang dipakai untuk mengelola serta mengerjakan soal.

## Temuan

Tujuh komponen memiliki gabungan masalah hooks dan kode lama yang dapat memengaruhi perilaku aplikasi:

- callback pengunggah tugas ditulis ke `ref` saat render dan validasi file tidak menjadi dependensi proses unggah;
- navigasi keyboard ujian menangkap fungsi navigasi dari render lama;
- pemuatan dimensi, interpretasi, petunjuk, dan kisi-kisi memanggil fungsi yang dideklarasikan setelah effect serta tidak membatalkan hasil ketika bank soal berubah;
- modal impor massal mereset banyak state dari effect dan memanggil pemuat bank dengan dependensi yang tidak lengkap;
- halaman detail bank soal menerima beberapa request refresh tanpa perlindungan terhadap respons lama;
- bentuk data pendamping bank soal masih berupa `any`, sehingga perubahan kontrak API tidak diperiksa TypeScript.

Risiko utamanya adalah hasil request bank lama masuk setelah pengguna berpindah bank, handler memakai prop lama, atau perubahan konfigurasi ukuran/tipe unggahan belum dipakai oleh proses yang sedang aktif.

## Perbaikan

`AssignmentUploader` sekarang menyinkronkan callback induk setelah render, membuat pemeriksa file stabil dengan dependensi lengkap, serta menangani kegagalan unggah sebagai `unknown`. Ikon gambar juga diberi alias agar pemeriksa aksesibilitas tidak salah menganggap ikon React sebagai elemen HTML tanpa teks alternatif.

`ExamViewer` membuat navigasi sebagai callback stabil. Listener keyboard selalu menggunakan jumlah soal dan callback navigasi terbaru.

Pemuatan awal pada pengelola dimensi, petunjuk, dan kisi-kisi sekarang memiliki penanda lifecycle. Respons yang selesai setelah komponen dilepas atau `bankId` berubah diabaikan, sehingga tidak dapat menimpa data halaman baru. Pemuatan ulang setelah simpan/hapus memakai callback dengan `bankId` terbaru.

Modal impor massal memuat daftar bank langsung dari effect asinkron yang dapat dibatalkan. Pergantian ke tab bank menjadi satu-satunya pemicu, sehingga request ganda dari tombol dan effect dihilangkan. Reset tetap dilakukan oleh seluruh jalur penutupan modal.

`QuestionBankDetailPage` sekarang memberi nomor generasi pada setiap pemuatan. Hanya request terbaru yang boleh memperbarui pertanyaan, bank, stimulus, petunjuk, dimensi, dan kisi-kisi. Cleanup saat `bankId` berubah juga membatalkan generasi lama. Import, variabel state, dan handler dari editor lama yang sudah tidak dipakai telah dihapus.

Kontrak API sekarang mendefinisikan tipe `KisiKisiItem`, `BankTextItem`, `DimensionItem`, dan `DimensionInterpretationItem`. Empat koleksi pendamping bank tidak lagi menggunakan generic `any`.

## Hasil lint

Enam komponen sasaran tidak lagi menghasilkan masalah `react-hooks/*`. Pada halaman detail bank soal, tiga dari empat masalah hooks selesai. Satu masalah tersisa pada sinkronisasi parameter URL ke modal dan dipertahankan agar perombakan alurnya dilakukan secara eksplisit pada tahap berikutnya.

Pemindaian frontend penuh berubah dari:

- 1.195 error menjadi 1.167 error;
- 609 warning menjadi 555 warning;
- total 1.804 masalah menjadi 1.722 masalah.

Sebanyak 82 masalah dibersihkan pada tahap ini. Rinciannya mencakup penurunan `no-explicit-any` dari 1.053 menjadi 1.034, `no-unused-vars` dari 534 menjadi 489, `exhaustive-deps` dari 62 menjadi 54, `immutability` dari 31 menjadi 25, `set-state-in-effect` dari 41 menjadi 40, dan `preserve-manual-memoization` dari 9 menjadi 8. Angka yang tersisa adalah utang lama dan akan dibersihkan bertahap; aturan lint tidak dilonggarkan dan tidak ditutupi dengan pengecualian massal.

## Verifikasi

- ESLint terarah pada enam komponen: nol masalah `react-hooks/*`.
- Halaman detail bank soal: nol warning; masalah hooks turun dari empat menjadi satu.
- TypeScript frontend: lulus.
- Pemindaian ESLint frontend penuh: selesai dan menghasilkan 1.167 error/555 warning.
- Build produksi frontend: lulus; 92 halaman diproses.
- `git diff --check`: lulus.

## Berkas utama

- `apps/web/app/components/questions/AssignmentUploader.tsx`
- `apps/web/app/components/questions/ExamViewer.tsx`
- `apps/web/app/components/questions/BulkImportModal.tsx`
- `apps/web/app/components/questions/DimensionManager.tsx`
- `apps/web/app/components/questions/InstructionManager.tsx`
- `apps/web/app/components/questions/KisiKisiTab.tsx`
- `apps/web/app/components/questions/QuestionBankDetailPage.tsx`
- `apps/web/lib/api/questions.ts`

## Tahap berikutnya

Lanjutkan masalah hooks berisiko pada `QuestionBankDetailPage`, halaman monitoring, dan halaman kelas/ujian tiga peran. Setelah lifecycle request bersih, lanjutkan penggantian `any` pada kontrak ujian dan jawaban, lalu aksesibilitas.
