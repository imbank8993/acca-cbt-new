# Tahap 26 — Pembuatan data aman diulang setelah gangguan jaringan

Diperbarui 27 September 2026. Tahap ini menutup risiko data ganda ketika server sudah menyimpan data, tetapi respons sukses tidak pernah sampai ke browser.

## Temuan

Pembuatan ujian, kelas, periode PAS/PAT, konfigurasi ujian, dan bank soal sebelumnya memakai `POST` biasa tanpa batas waktu dan tanpa kunci idempotensi. Pada kondisi berikut, pengguna tidak dapat mengetahui hasil akhirnya:

1. browser mengirim permintaan;
2. server menyimpan data;
3. koneksi atau reverse proxy putus sebelum respons diterima;
4. pengguna menekan Simpan lagi;
5. server membuat baris kedua.

Menonaktifkan tombol selama permintaan berjalan hanya mencegah klik cepat pada satu tampilan. Cara itu tidak melindungi timeout, reload, dua request paralel, ataupun respons 5xx dari proxy setelah backend sempat bekerja.

Adapter database juga membuang kode asli PostgreSQL yang dibungkus Prisma. Akibatnya service tidak dapat membedakan pelanggaran indeks unik `23505` dari galat database lain, padahal perbedaan itu diperlukan untuk menyelesaikan race secara aman.

## Perbaikan browser

Helper baru `apiCreate()` melakukan hal berikut:

- memasang timeout 20 detik pada operasi pembuatan yang sudah dilindungi;
- menghitung sidik payload secara deterministik tanpa bergantung urutan properti objek;
- membuat UUID v4 untuk satu kombinasi endpoint dan payload;
- menyimpan UUID di `sessionStorage` sebelum request dikirim;
- mempertahankan UUID bila koneksi putus, timeout, HTTP 408/429, atau respons 5xx membuat hasil akhir ambigu;
- memakai UUID yang sama ketika pengguna mencoba kembali dengan payload yang sama;
- memakai UUID baru bila isi formulir berubah;
- menghapus UUID setelah sukses atau kegagalan HTTP yang sudah pasti.

Enam kelompok aksi utama telah dipindahkan ke helper ini: pembuatan ujian, kelas Proktor, kelas tambahan Guru, impor massal kelas, periode PAS/PAT, konfigurasi ujian, dan bank soal. Mutasi lain tetap memakai `apiSend()` sampai memperoleh perlindungan database yang sesuai.

Impor kelas memakai satu UUID batch dan menurunkan UUID stabil untuk setiap nomor baris. Bila koneksi putus setelah sebagian baris tersimpan, retry melewati baris lama dan melanjutkan sisanya. Batas tunggunya 60 detik karena satu berkas dapat memuat banyak kelas.

## Perbaikan server dan database

DTO pembuatan mewajibkan `clientRequestId` berformat UUID v4. Nilai ini tidak dipakai untuk identitas atau otorisasi; sekolah dan pengguna tetap berasal dari JWT yang telah diverifikasi.

Setiap tabel yang dilindungi mempunyai `client_request_id` dan `client_request_hash`. Indeks unik parsial membatasi satu pasangan `(organization_id, client_request_id)` menjadi satu baris. Kolom nullable mempertahankan data lama, sedangkan request baru wajib membawa kunci melalui DTO.

Helper server `insertIdempotently()`:

1. mencari hasil request lama;
2. mengembalikan ID yang sama bila hash payload cocok;
3. menolak HTTP 409 bila kunci yang sama dipakai untuk payload berbeda;
4. mencoba insert bila kunci belum ada;
5. bila dua request berpacu dan salah satunya terkena `23505`, membaca serta mengembalikan baris pemenang.

Hash dihitung server dengan SHA-256 atas JSON kanonis. Dengan demikian browser tidak dapat memalsukan hash untuk membuat dua isi berbeda terlihat sama.

Tabel yang dilindungi:

- `cbt_exams`;
- `cbt_classes`;
- `cbt_additional_classes`;
- `cbt_pas_periods`;
- `exam_configs`;
- `cbt_question_banks`.

## Status rollout

Migrasi `20260927_01_idempotent_creates.sql` telah diterapkan permanen ke `acca_db` pada 27 September 2026, bersama migrasi tahap 27 dalam satu transaksi. Verifikasi dari koneksi database baru memastikan seluruh kolom dan indeks tahap ini tersimpan. Migrasi aman dijalankan ulang dan tidak mengubah baris lama.

Validator menjalankan semua migrasi dalam satu transaksi, memeriksa 13 kolom dan 10 indeks, menjalankannya ulang untuk menguji idempotensi DDL, lalu melakukan rollback. Dry run pada database pengembangan lulus tanpa menyimpan perubahan.

## Batas cakupan

Perlindungan tahap ini mencakup entitas induk yang paling mudah dibuat ulang lewat formulir. Pembuatan folder/label bank, tahun ajaran, sesi/ruang/jadwal PAS, dan baris konfigurasi turunan kemudian dilindungi pada [tahap 27](TAHAP-27-IDEMPOTENSI-DATA-TURUNAN.md).

`sessionStorage` mempertahankan kunci selama reload pada tab yang sama. Menutup tab setelah hasil ambigu menghilangkan kunci browser; indeks database tetap mencegah duplikasi hanya jika retry membawa kunci lama, sehingga UI sebaiknya meminta pengguna memeriksa daftar sebelum mengulang dari tab baru.

## Verifikasi

Enam tes `IDM-01` sampai `IDM-06` membuktikan:

- retry gangguan jaringan memakai UUID yang sama;
- perubahan payload memperoleh UUID baru;
- retry identik mengembalikan ID baris lama;
- penggunaan satu kunci untuk isi berbeda ditolak;
- keenam tabel memiliki indeks unik;
- seluruh aksi pembuatan utama, termasuk impor kelas, memakai `apiCreate()`.

Hasil lengkap:

- 167 tes regresi Node dalam 25 berkas: lulus;
- typecheck frontend: lulus;
- build shared dan backend: lulus;
- dry run delapan migrasi dan pengulangan DDL: lulus;
- validasi awal tidak mengubah database karena selalu rollback; migrasi kemudian diterapkan permanen atas permintaan operator.

## Berkas utama

- `apps/web/lib/api/client.ts`
- `apps/api/src/common/idempotent-create.ts`
- `apps/api/src/prisma/prisma-db-adapter.ts`
- `database/migrations/20260927_01_idempotent_creates.sql`
- `apps/api/test/idempotent-create-stage26.test.cjs`
