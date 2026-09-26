# Tahap 19 — Validasi lifecycle ujian dan paket staging

Diperbarui 26 September 2026. Tahap ini memeriksa balapan antara submit, auto-finish, terminasi, reset, dan penilaian yang berjalan lambat. Tidak ada koneksi ke database sekolah atau deployment yang dilakukan.

## Temuan dan perbaikan

### LIF-01 — P1 — Hasil grading lama dapat masuk setelah reset

Auto-finish dan force terminate menutup attempt lebih dahulu, kemudian menjalankan grading di luar transaksi. Selama grading berjalan, proktor dapat mereset attempt menjadi `in_progress`. Ketika grading lama selesai, update skor sebelumnya hanya memfilter ID sehingga nilai dari penutupan lama dapat ditulis ke attempt yang sudah aktif kembali.

Perbaikan:

- update hasil grading hanya berlaku ketika status masih `auto_submitted`;
- reset membersihkan `total_score`, `score_irt`, `irt_theta`, `needs_manual_grading`, `metadata.base_score`, dan `metadata.dimension_scores`;
- metadata lain yang tidak berkaitan dengan skor tetap dipertahankan;
- status terminasi dan log `FORCE_TERMINATED` disimpan atomik dalam satu transaksi dan memakai jam database;
- log terminasi tersimpan sebelum reset dapat dilakukan sehingga urutan audit tetap benar.

### LIF-02 — P1 — Finalisasi monitoring menunggu grading sebelum menutup status

Finalisasi attempt kedaluwarsa pada halaman monitoring sebelumnya menjalankan grading dahulu. Bila layanan scoring lambat atau gagal, attempt tetap `in_progress`, masih tampak aktif, dan berpotensi menerima proses lain meskipun waktunya sudah habis.

Perbaikan: monitoring melakukan compare-and-set `in_progress` → `auto_submitted` lebih dahulu. Hanya proses yang memenangkan perubahan status yang menjalankan grading. Jika submit siswa sudah menang, monitoring tidak menilai atau menimpa attempt tersebut. Hasil grading juga hanya ditulis selama status masih `auto_submitted`.

### LIF-03 — P1 operasional — Validator migrasi belum mencakup tahap terbaru

`tools/validate-migrations.js` hanya menguji tiga migrasi September awal. Kolom `updated_at`, unique index attempt aktif, `last_seen_at`, index heartbeat, dan unique index event pengawasan belum masuk dry-run migrasi.

Perbaikan: validator sekarang menjalankan seluruh migrasi sampai `20260926_02` dalam transaksi yang selalu di-rollback, lalu memeriksa tiga kolom dan tiga index terbaru. Ia tetap memakai `lock_timeout` lima detik agar gagal cepat bila database sibuk.

## Pemeriksa database read-only

Skrip [audit-exam-lifecycle-db.js](../../tools/audit-exam-lifecycle-db.js) hanya menjalankan `SELECT` dan mengaktifkan `default_transaction_read_only`. Skrip tidak mencetak URL/kredensial atau data identitas siswa.

Pemeriksaan blocker:

- kolom dan index tahap 15–18 belum terpasang;
- lebih dari satu attempt `in_progress` untuk ujian dan siswa yang sama;
- jawaban ganda untuk pasangan attempt/soal;
- `client_event_id` pengawasan ganda;
- jawaban tanpa attempt, soal, atau opsi yang sah.

Pemeriksaan warning:

- attempt aktif tanpa kunci perangkat atau dasar deadline;
- attempt final tanpa `finished_at` atau `total_score`.

Jalankan hanya dengan URL database staging yang sudah dipastikan:

```powershell
$env:DATABASE_URL = 'postgresql://...database-staging...'
npm run audit:exam-db -- --expect-db=nama_database_staging
Remove-Item Env:DATABASE_URL
```

Skrip tidak membaca `apps/api/.env` secara otomatis dan menolak berjalan bila nama database aktual berbeda dari `--expect-db`. Kode keluar `0` berarti tidak ada blocker, `2` berarti ditemukan blocker data/schema, dan `1` berarti audit tidak dapat dijalankan.

## Dry-run migrasi staging

Perintah berikut menjalankan DDL di dalam transaksi dan selalu melakukan rollback:

```powershell
$env:DATABASE_URL = 'postgresql://...database-staging...'
node tools/validate-migrations.js
Remove-Item Env:DATABASE_URL
```

Walaupun di-rollback, `ALTER TABLE` tetap mengambil lock singkat. Jalankan ketika tidak ada ujian aktif. Jangan memakai database produksi untuk percobaan pertama.

Jika audit read-only dan dry-run lulus, migrasi permanen tahap terbaru dapat diterapkan dengan alat yang meminta konfirmasi eksplisit:

```powershell
node tools/apply-migrations.js --files=20260925_01_add_updated_at_question_banks.sql,20260926_01_unique_active_exam_attempt.sql,20260926_02_offline_proctoring.sql --confirm
```

## Checklist browser staging

Gunakan satu akun siswa dan satu akun proktor pada data staging sekali pakai.

### A. Offline dan heartbeat

1. Mulai ujian dan jawab minimal tiga soal dengan tipe berbeda.
2. Buka monitoring pada browser proktor.
3. Putus jaringan browser siswa selama lebih dari 45 detik.
4. Pastikan siswa tetap dapat memilih jawaban dan melihat banner offline.
5. Pastikan monitoring menampilkan **Koneksi terputus**.
6. Sambungkan jaringan kembali.
7. Pastikan indikator kembali online dan jawaban tersinkronisasi tanpa duplikasi.

### B. Pelanggaran ketika offline

1. Putus jaringan siswa.
2. Picu satu pelanggaran yang diizinkan skenario uji.
3. Muat ulang hanya setelah jaringan kembali; jangan menghapus data situs.
4. Pastikan event muncul satu kali pada server walaupun retry terjadi.
5. Pada batas pelanggaran, pastikan layar menunggu konfirmasi dan tidak kembali ke dashboard sebelum server mengonfirmasi terminasi.

### C. Race submit dan penutupan

1. Atur ujian singkat dan kirim jawaban mendekati deadline.
2. Pada percobaan terpisah, klik submit saat proktor melakukan terminasi.
3. Pastikan hanya satu status final, satu himpunan jawaban, dan skor konsisten.
4. Reset attempt ketika scoring staging sengaja diperlambat.
5. Pastikan hasil grading lama tidak muncul pada attempt yang sudah aktif kembali.

### D. Dua tab dan dua perangkat

1. Mulai ujian bersamaan dari dua tab perangkat yang sama; keduanya harus merujuk satu attempt.
2. Coba perangkat berbeda; perangkat kedua harus ditolak tanpa membuat attempt baru.
3. Setelah reset resmi proktor, pastikan perangkat baru dapat mengambil alih dan perangkat lama tidak dapat menulis lagi.

### E. Rekonsiliasi akhir

Setelah setiap skenario, cocokkan jumlah jawaban dan status pada UI siswa, monitoring, `cbt_answers`, `cbt_exam_attempts`, review hasil, dan ekspor. Catat ID attempt, waktu skenario, hasil yang diharapkan, hasil aktual, serta bukti tangkapan layar/log tanpa menyertakan kredensial.

## Verifikasi lokal

Empat tes regresi tahap 19 membuktikan:

1. hasil auto-finish yang tertunda tidak menimpa attempt setelah reset;
2. terminasi dan audit mendahului reset serta grading lama tidak bocor;
3. finalisasi monitoring menutup status sebelum menunggu scoring;
4. validator mencakup migrasi dan index tahap 15–18.

Fixture lokal tidak menggantikan isolasi transaksi PostgreSQL atau perilaku browser. Karena itu audit read-only, dry-run migrasi, dan checklist browser staging tetap menjadi gate sebelum rollout.
