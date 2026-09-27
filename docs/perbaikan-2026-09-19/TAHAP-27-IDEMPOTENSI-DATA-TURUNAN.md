# Tahap 27 — Idempotensi data turunan dan race jadwal

Diperbarui 27 September 2026. Tahap ini memperluas perlindungan retry-safe dari entitas induk ke data pengaturan yang dibuat dari halaman administrasi.

## Temuan

Delapan jenis data masih dibuat melalui `apiSend()` biasa:

- tahun ajaran;
- folder bank soal;
- label bank soal;
- sesi PAS/PAT;
- ruang PAS/PAT;
- jadwal kelas PAS/PAT;
- bank soal di dalam konfigurasi ujian;
- jadwal kelas di dalam konfigurasi ujian.

Beberapa service lebih dulu menjalankan query “sudah ada” sebelum insert. Pola itu memberi pesan yang baik untuk satu request, tetapi tidak menutup race: dua request paralel dapat sama-sama tidak menemukan data lalu keduanya melakukan insert. Tabel `exam_config_banks` dan `exam_config_exams` bahkan belum mempunyai indeks unik untuk aturan bisnis yang diperiksa service.

## Perbaikan

Seluruh aksi pembuatan di atas kini memakai `apiCreate()`. DTO mewajibkan UUID `clientRequestId`, sedangkan server memakai `insertIdempotently()` yang sama dengan tahap 26.

Helper server diperluas agar kunci dapat dibatasi oleh parent:

- sesi, ruang, dan jadwal PAS dibatasi `pas_period_id`;
- bank dan jadwal konfigurasi dibatasi `exam_config_id`;
- data tingkat sekolah tetap dibatasi `organization_id`.

UUID yang kebetulan sama pada dua parent berbeda tidak saling menghalangi. Pada parent yang sama, retry identik mengembalikan ID lama dan payload berbeda ditolak.

Pemeriksaan “sudah ada” sebelum insert pada jadwal diganti dengan indeks database yang atomik. Pesan pengguna tetap dipertahankan dengan menerjemahkan kode PostgreSQL `23505` menjadi konflik yang mudah dipahami.

## Perlindungan database

Migrasi `20260927_02_idempotent_child_creates.sql` menambahkan kolom request dan hash serta delapan indeks request unik.

Tiga indeks identitas bisnis juga ditambahkan:

- satu bank hanya sekali pada sebuah konfigurasi;
- satu kelas hanya sekali untuk sebuah bank konfigurasi;
- satu kelas hanya sekali untuk sebuah bank dalam periode PAS/PAT.

Sebelum membuat indeks bisnis, migrasi mencari duplikat lama. Jika ditemukan, migrasi berhenti dengan pesan spesifik dan tidak menghapus baris mana pun. Operator harus meninjau relasi serta ujian hasil generate sebelum menentukan baris yang sah.

## Status rollout

Migrasi tahap 26 lalu tahap 27 telah diterapkan permanen ke `acca_db` pada 27 September 2026 dalam satu transaksi. Kedua migrasi berhasil di-commit. Pemeriksaan melalui koneksi baru menemukan 28/28 kolom idempotensi dan 17/17 indeks khusus tahap 26–27; tidak ada bagian yang hilang.

Sebelum commit permanen, dry run membuktikan sembilan migrasi dapat dijalankan dan diulang dalam satu transaksi. Validator memeriksa 21 kolom dan 21 indeks lalu melakukan rollback. Penerapan permanen dilakukan setelah validasi tersebut lulus.

## Verifikasi

Lima tes `IDM-07` sampai `IDM-11` membuktikan:

- retry pada tabel anak mengembalikan ID lama;
- UUID yang sama tetap dapat dipakai pada parent berbeda;
- delapan tabel memiliki indeks request unik;
- tiga aturan identitas bisnis dilindungi indeks atomik;
- migrasi gagal tertutup tanpa penghapusan otomatis;
- seluruh aksi browser dan DTO memakai kontrak retry-safe.

Hasil lengkap setelah tahap 27:

- 172 tes regresi Node dalam 26 berkas: lulus;
- typecheck frontend: lulus;
- build shared dan backend: lulus;
- dry run sembilan migrasi, 21 kolom, dan 21 indeks: lulus;
- `git diff --check`: bersih selain peringatan normal konversi LF/CRLF.

## Batas cakupan berikutnya

Pembuatan isi bank soal—soal baru, stimulus, petunjuk, dimensi, interpretasi, dan kisi-kisi—masih memakai kontrak save/create lama. Jalur tersebut perlu dianalisis bersama aturan edit karena sebagian endpoint memakai satu operasi untuk membuat dan memperbarui data.

## Berkas utama

- `apps/api/src/common/idempotent-create.ts`
- `apps/api/src/pas/pas-schedules.service.ts`
- `apps/api/src/pas/pas-rooms.service.ts`
- `apps/api/src/exam-configs/exam-configs.service.ts`
- `database/migrations/20260927_02_idempotent_child_creates.sql`
- `apps/api/test/idempotent-child-create-stage27.test.cjs`
