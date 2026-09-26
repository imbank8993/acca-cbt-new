# Perbaikan integritas impor soal

Diperbarui 26 September 2026. Dokumen ini mencatat temuan tambahan `IMP-01` yang ditemukan setelah laporan bahwa nomor soal hasil impor tidak mengikuti template dan stimulus tampak tertukar.

## Gejala

- Soal yang berurutan 1, 2, 3 pada template dapat tampil dalam urutan berbeda setelah impor.
- Karena nomor pada layar berubah, stimulus atau petunjuk yang sebenarnya melekat pada soal tertentu terlihat berada pada nomor lain.
- Nomor Word dengan bentuk `01`, `1.`, atau `Soal 1` tidak selalu cocok dengan referensi `1` pada tabel stimulus.
- File Excel yang memiliki kolom `No` tetapi tidak memiliki kolom `Soal/Pertanyaan` dapat membuat angka dianggap sebagai teks soal.

## Penyebab

Backend menghapus `metadata.order_index` dari setiap soal impor. Soal-soal dalam satu transaksi dapat memiliki `created_at` yang sama, sedangkan pemutus urutan berikutnya adalah UUID acak. Urutan hasil akhirnya tidak lagi sama dengan array hasil parser.

Parser Word memakai string nomor mentah sebagai kunci stimulus, petunjuk, dan kisi-kisi. Bentuk `01` dan `1.` tidak sama dengan `1`, walaupun merujuk soal yang sama. Daftar nomor juga hanya dipisahkan dengan koma sehingga bentuk `1-3`, `1;2`, dan `1 dan 2` tidak konsisten.

Parser Excel memasukkan `no` sebagai fallback calon kolom soal. Ini membuat template yang cacat tampak berhasil diproses dengan angka sebagai pertanyaan.

## Perbaikan

1. Dalam transaksi impor, backend membaca urutan soal aktif yang sudah ada dan menormalkannya menjadi `order_index` berurutan.
2. Setiap soal baru mendapat `order_index` berdasarkan posisi array parser, setelah seluruh soal lama. Nilai urutan dari klien tetap tidak dipercaya.
3. Nomor Word dinormalisasi: `01`, `1.`, dan `Soal 1` menjadi kunci `1`.
4. Referensi stimulus/petunjuk/kisi-kisi mendukung koma, titik koma, kata `dan`, serta rentang seperti `1-3`.
5. Hasil parser Word dan Excel diurutkan berdasarkan nomor sumber bila tersedia. Nomor sumber disimpan sebagai metadata audit `import_source_number`.
6. Kolom Excel `No` dipisahkan tegas dari kolom teks soal. File tanpa `Soal/Pertanyaan` sekarang ditolak.
7. Stimulus, petunjuk, opsi, metadata, dan soal tetap disimpan dalam satu transaksi; kegagalan satu bagian me-roll back seluruh impor terpilih.

## Pengujian regresi

- Word dengan baris soal `2.` lalu `01` kembali sebagai soal 1 lalu soal 2, masing-masing dengan stimulus yang benar.
- Excel dengan nomor 2 lalu 1 kembali dalam urutan 1 lalu 2 dan mempertahankan stimulus inline masing-masing.
- Bulk import tiga soal menghasilkan `order_index` berurutan setelah dua soal lama dan setiap `stimulus_id` menunjuk isi stimulus yang benar.
- Excel yang hanya mempunyai kolom `No` ditolak dan tidak menghasilkan pertanyaan palsu.
- Suite round-trip mencakup seluruh 14 tipe soal, opsi kosong di tengah, opsi sampai L, kunci benar/salah per subbaris, matching, kategori, ordering, bobot, dan template bawaan.
- Pengujian service mencakup rollback, opsi duplikat yang sah, konversi kunci ordering ke ID opsi baru, serta urutan/stimulus impor.

Hasil lokal: **44 pemeriksaan round-trip parser/export lulus**, **9 pemeriksaan service soal/impor lulus**, serta TypeScript API dan frontend lulus.

## Lokasi perubahan

- `apps/web/lib/doc-parser.ts`
- `apps/web/lib/excel-parser.ts`
- `apps/api/src/imports/imports.service.ts`
- `tools/audit-question-roundtrip.cjs`
- `tools/test-question-services.cjs`

## Batas verifikasi

Pengujian menggunakan dokumen/template lokal dan database in-memory transaksional. Upload melalui browser serta round-trip pada PostgreSQL staging dengan data sekolah belum dijalankan. Sebelum produksi, impor satu salinan template nyata yang bermasalah dan bandingkan nomor, teks soal, stimulus, petunjuk, kisi-kisi, opsi, dan kunci pada layar bank serta preview ujian.
