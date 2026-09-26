# QA-02 — Integrasi lintas layanan dan regresi P1

Tanggal perbaikan: 26 September 2026  
Prioritas: P2  
Status: implementasi dan tes lokal selesai

## Masalah

Tes awal banyak berpusat pada scoring dan pemeriksaan satu fungsi. Kondisi itu tidak membuktikan bahwa kontrak HTTP, identitas dari guard, transaksi submit, sumber soal, review, dan perlindungan historis tetap konsisten ketika dijalankan berurutan. Skrip reproduksi audit juga sengaja mengharapkan bug sehingga tidak layak menjadi gate kesehatan deployment.

## Penambahan pengujian

### Alur ujian lintas layanan

Tes memakai service produksi dengan satu fixture database transaksional dan menjalankan:

1. peserta memulai ujian legacy melalui `cbt_exam_question_sources`;
2. endpoint service memuat soal dan memastikan kunci tidak masuk DTO siswa;
3. pengguna kedua mencoba menulis jawaban pada attempt tersebut dan menerima 403;
4. pemilik melakukan autosave;
5. submit memanggil kontrak scoring, menyimpan jawaban, nilai, dan status dalam transaksi;
6. review membaca state hasil submit dan menghasilkan nilai 100;
7. soal yang sudah dijawab dihapus melalui `QuestionsService`;
8. penghapusan menjadi soft delete dan review setelah penghapusan tetap identik.

Skenario ini menghubungkan perbaikan SEC-01–04, BUG-03, BUG-11, BUG-12, dan kontrak grading dalam satu perjalanan data.

### Kontrak HTTP NestJS

Tes membuka server NestJS lokal pada port acak dan mengirim request HTTP nyata ke endpoint submit:

- request tanpa identitas guard menghasilkan 401;
- `answers` berbentuk array dan `deviceId` terlalu pendek menghasilkan 400 sebelum service dipanggil;
- request sah menghasilkan 200;
- `userId` dan `organizationId` palsu di body dibuang oleh `ValidationPipe`;
- controller meneruskan identitas yang dipasang guard.

### Cakupan prioritas P1

[p1-test-coverage.json](p1-test-coverage.json) mencatat seluruh 23 temuan P1, skenario yang harus dipertahankan, dan berkas tesnya. Tes meta membandingkan matriks ini dengan `findings.json`; penambahan temuan P1 tanpa bukti regresi atau penghapusan berkas tes akan menggagalkan suite.

BUG-09 memperoleh penjaga eksplisit bahwa kegagalan `localStorage.setItem` ditangkap sebelum autosave server dan tidak dapat menghentikan pemanggilan `saveAnswerAction`.

## Gate CI

Root `package.json` menyediakan:

- `npm run test:audit:node` untuk seluruh tes service, keamanan, integritas, HTTP, dan UI helper;
- `npm run test:audit:questions` untuk round-trip parser/ekspor serta service bank soal;
- `npm run test:audit` untuk keduanya.

Workflow deployment menjalankan `npm run test:audit` sebelum build backend dan deployment. Hasil lokal terakhir:

- 102 tes Node lulus;
- 44 pemeriksaan impor/ekspor lulus;
- 13 pemeriksaan service soal lulus;
- 98 tes scoring Python lulus pada verifikasi sebelumnya;
- TypeScript API/frontend dan baseline lint lulus.

## Batas

- Fixture menjalankan service dan transaksi aplikasi, tetapi tidak meniru isolasi, constraint, trigger, locking, atau cascade PostgreSQL secara penuh.
- Server HTTP tes memakai guard deterministik yang memasang user; kriptografi JWT produksi diuji terpisah dari alur ini.
- FastAPI digantikan stub kontrak agar tes deterministik. Suite Python tetap menjadi bukti algoritma scoring.
- Database PostgreSQL, bucket storage, reverse proxy, dan browser nyata belum dijalankan pada lingkungan staging dalam sesi ini. Hasil lokal tidak boleh dinyatakan sebagai validasi deployment.
- Tahap staging selanjutnya perlu memakai data sintetis dan menjalankan kasus konkurensi submit/terminate, rollback restore, multi-bank, serta kegagalan storage nyata.
