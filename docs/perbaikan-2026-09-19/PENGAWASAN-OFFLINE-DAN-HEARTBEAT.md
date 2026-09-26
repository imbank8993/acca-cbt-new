# Pengawasan offline, heartbeat, dan terminasi terkonfirmasi

Diperbarui 26 September 2026. Dokumen ini mencatat penyelesaian ANS-07 pada tahap 18.

## Masalah yang diperbaiki

Event perpindahan tab, kehilangan fokus, keluar fullscreen, dan shortcut terlarang sebelumnya langsung dikirim ke server. Jika jaringan putus atau request berhenti di tengah jalan, event dapat hilang. Retry tanpa identitas stabil juga berisiko menghitung event yang sama dua kali. Pada pelanggaran ketiga, halaman membersihkan sesi dan reload walaupun server belum mengonfirmasi terminasi. Pengawas juga tidak dapat membedakan siswa yang benar-benar tersambung dari tab yang hanya masih berstatus `in_progress`.

## Alur sesudah perbaikan

1. Browser membuat UUID `clientEventId` untuk setiap event keamanan.
2. Event disimpan lebih dahulu di object store IndexedDB `security-events` dan dicerminkan ke `localStorage` sebagai fallback.
3. Antrean dikirim berurutan ketika jaringan tersedia dan diperiksa lagi setiap 15 detik serta pada event `online`.
4. Event baru dihapus dari perangkat setelah server mengembalikan sukses.
5. Server menyimpan `client_event_id` di metadata. Unique index per attempt membuat pengiriman ulang idempoten; event yang sama tidak menambah `warning_count` dua kali.
6. Browser mengirim heartbeat terautentikasi setiap 15 detik. Server memeriksa pemilik attempt, status aktif, dan perangkat yang terikat sebelum memperbarui `last_seen_at` memakai jam database.
7. Monitoring menandai attempt aktif sebagai `offline` bila heartbeat tidak ada atau lebih lama dari 45 detik. Admin, guru, proktor, dan pengawas melihat label **Koneksi terputus**.
8. Saat batas pelanggaran tercapai, UI masuk layar blokir. Jawaban gagal dikirim ulang, beacon dijalankan sebagai jaring tambahan, lalu terminasi diminta. Sesi hanya dibersihkan dan halaman hanya direload setelah respons sukses dari server. Jika jaringan putus, layar tetap menunggu dan mencoba lagi otomatis.

## Perlindungan keamanan

- Identitas siswa tetap berasal dari token/cookie, bukan payload browser.
- Heartbeat dan event hanya diterima untuk attempt milik pengguna yang sedang login dan masih `in_progress`.
- Heartbeat harus membawa ID perangkat yang sama dengan kunci attempt.
- Jenis event dibatasi oleh allowlist backend. Metadata `actor_id` dan `source` selalu ditetapkan server.
- Unique index `(attempt_id, metadata->>'client_event_id')` mencegah duplikasi akibat timeout, reload, dua flush berdekatan, atau respons sukses yang hilang.
- `warning_count` dihitung kembali dari log database, bukan dinaikkan dari angka yang dikirim browser.
- Terminasi tetap menilai jawaban yang sudah tersimpan. UI tidak menyatakan penutupan selesai sebelum server mengonfirmasinya.

Event browser tetap merupakan sinyal pengawasan, bukan bukti tunggal kecurangan. Siswa menguasai browser dan perangkatnya; kebijakan ruang ujian serta keputusan manusia tetap diperlukan.

## Perubahan database

Migrasi [20260926_02_offline_proctoring.sql](../../database/migrations/20260926_02_offline_proctoring.sql) menambahkan:

- `cbt_exam_attempts.last_seen_at timestamptz`;
- index parsial untuk pencarian heartbeat attempt aktif;
- unique expression index untuk `client_event_id` event keamanan.

Migrasi mengisi `last_seen_at` attempt aktif yang sudah ada. Sebelum membuat unique index, migrasi berhenti bila menemukan `client_event_id` duplikat agar data tidak dihapus otomatis. Migrasi wajib dijalankan sebelum versi API/web ini diterapkan, karena start/resume/heartbeat langsung memakai kolom baru.

## Kondisi gagal dan perilaku sistem

| Kondisi | Perilaku |
|---|---|
| Jaringan putus saat event terjadi | Event bertahan di perangkat dan dikirim setelah online |
| Respons log sukses hilang | UUID yang sama dikirim lagi; server mengembalikan hasil tanpa log ganda |
| IndexedDB tidak tersedia | Mirror `localStorage` menjadi fallback |
| Seluruh penyimpanan browser gagal | UI memberi peringatan bahwa event tidak dapat disimpan |
| Heartbeat berhenti lebih dari 45 detik | Monitoring menampilkan koneksi terputus |
| Terminasi gagal/timeout | UI tetap diblokir dan retry otomatis; sesi belum dibersihkan |
| Terminasi dikonfirmasi | Sesi CBT perangkat dibersihkan dan halaman dimuat ulang |

## Verifikasi

Lima tes tahap 18 memeriksa:

1. retry `clientEventId` hanya menghasilkan satu log dan satu hitungan;
2. heartbeat menolak perangkat berbeda dan menyimpan jam database untuk perangkat sah;
3. kontrak antrean IndexedDB dan fallback;
4. urutan konfirmasi terminasi sebelum pembersihan sesi;
5. indikator offline pada empat peran dan perlindungan migrasi.

TypeScript frontend dan build backend juga lulus. Validasi browser/database nyata tetap harus menjalankan migrasi di PostgreSQL staging, memutus jaringan lebih dari 45 detik, memicu pelanggaran saat offline, memulihkan jaringan, dan memastikan jumlah log/indikator/terminasi sesuai.

## Berkas utama

- `apps/web/lib/exam-durable-storage.ts`
- `apps/web/lib/api/proctoring.ts`
- `apps/web/app/components/questions/ExamPage.tsx`
- `apps/api/src/proctoring/proctoring.controller.ts`
- `apps/api/src/proctoring/proctoring.service.ts`
- `apps/api/src/proctor/exam-monitoring.service.ts`
- `apps/api/src/students/exam-attempts.service.ts`
- `database/migrations/20260926_02_offline_proctoring.sql`
- `apps/api/test/offline-proctoring-stage18.test.cjs`
