# Matriks cakupan halaman — 19 September 2026

Seluruh 51 file page.tsx diinventarisasi. Kolom temuan menunjukkan hubungan halaman dengan akar masalah bersama; bukan klaim bahwa setiap skenario sudah direproduksi melalui UI halaman itu. Semua halaman juga terkena perhatian lint, layout/auth bersama, dan pengujian keyboard/error. Tidak ada browser terautentikasi yang diuji dalam audit ini.

Metode: pembacaan struktur/pemanggil, pencarian pola salinan antarrole, serta penelusuran mendalam pada komponen dan layanan yang relevan. Halaman pendek seperti pembungkus ujian tetap ditelusuri ke ExamPage. Detail bukti per temuan berada di [laporan utama](../AUDIT_LENGKAP_2026-09-19.md); label R hanya berlaku pada skenario yang ditulis di sana.

| Halaman | Baris | Temuan terkait / perhatian | Uji halaman berikutnya di staging |
|---|---:|---|---|
| [/dashboard/admin/assignments/[examId]](../../apps/web/app/dashboard/admin/assignments/[examId]/page.tsx) | 471 | SEC-01, SEC-08, BUG-01, BUG-06 | Penugasan peserta, berkas tugas, izin nilai dan hasil. |
| [/dashboard/admin/backup](../../apps/web/app/dashboard/admin/backup/page.tsx) | 245 | SEC-12–13, BUG-02, BUG-04–05 | Round-trip ZIP bergambar, izin awal, limit, kegagalan tengah restore, cakupan entitas. |
| [/dashboard/admin/classes](../../apps/web/app/dashboard/admin/classes/page.tsx) | 652 | UX-02, QA-02 | Keanggotaan/organisasi, CRUD bila role staf, empty/error dan paging. |
| [/dashboard/admin/exams](../../apps/web/app/dashboard/admin/exams/page.tsx) | 2255 | SEC-01, SEC-14, BUG-12–13, QA-03 | Publish public/private, target, waktu, release hasil, bank valid. |
| [/dashboard/admin/exams/pas/[id]](../../apps/web/app/dashboard/admin/exams/pas/[id]/page.tsx) | 570 | UX-09, BUG-05, BUG-13 | Generate parsial, skipped, target hasil pembuatan dan backup jadwal. |
| [/dashboard/admin/monitoring/[attemptId]](../../apps/web/app/dashboard/admin/monitoring/[attemptId]/page.tsx) | 484 | SEC-09–10, BUG-11, BUG-15, UX-05 | Statistik esai/objektif, bukti historis, reset/terminate, izin staf. |
| [/dashboard/admin/monitoring](../../apps/web/app/dashboard/admin/monitoring/page.tsx) | 1100 | SEC-09–10, UX-08 | Balapan pemilihan ujian, refresh, log asli, reset/terminate idempoten. |
| [/dashboard/admin](../../apps/web/app/dashboard/admin/page.tsx) | 561 | UX-03, QA-01–03 | Autentikasi dan role, agregasi, navigasi, loading/error/empty. |
| [/dashboard/admin/pas](../../apps/web/app/dashboard/admin/pas/page.tsx) | 376 | BUG-05, QA-02 | Konfigurasi/jadwal tersimpan, izin, validasi waktu, pemulihan backup. |
| [/dashboard/admin/questions/[bankId]/edit](../../apps/web/app/dashboard/admin/questions/[bankId]/edit/page.tsx) | 548 | SEC-07, BUG-01, BUG-07, BUG-14–15 | Soal/opsi asing, bobot nol, semua tipe, upload, pelestarian grading manual. |
| [/dashboard/admin/questions/[bankId]](../../apps/web/app/dashboard/admin/questions/[bankId]/page.tsx) | 1088 | SEC-07, SEC-11, BUG-01, BUG-07, BUG-11, BUG-14–15, QA-03 | Impor/edit/delete, soal sudah dipakai, lampiran, preview, izin bank. |
| [/dashboard/admin/questions](../../apps/web/app/dashboard/admin/questions/page.tsx) | 1312 | SEC-07, SEC-11, QA-03 | Cakupan bank pemilik, kategori, pencarian, empty/error, aksi massal. |
| [/dashboard/guru/analytics/exam/[id]](../../apps/web/app/dashboard/guru/analytics/exam/[id]/page.tsx) | 753 | UX-11, BUG-06, BUG-15–16 | Ekspor semua tipe, skor manual/otomatis konsisten, batas akses ujian. |
| [/dashboard/guru/analytics](../../apps/web/app/dashboard/guru/analytics/page.tsx) | 241 | QA-01–02 | Cakupan guru/organisasi, filter, empty/error, konsistensi ringkasan dan detail. |
| [/dashboard/guru/assignments/[examId]](../../apps/web/app/dashboard/guru/assignments/[examId]/page.tsx) | 471 | SEC-01, SEC-08, BUG-01, BUG-06 | Penugasan peserta, berkas tugas, izin nilai dan hasil. |
| [/dashboard/guru/classes](../../apps/web/app/dashboard/guru/classes/page.tsx) | 542 | UX-02, QA-02 | Keanggotaan/organisasi, CRUD bila role staf, empty/error dan paging. |
| [/dashboard/guru/exams](../../apps/web/app/dashboard/guru/exams/page.tsx) | 2240 | SEC-01, SEC-14, BUG-12–13, QA-03 | Publish public/private, target, waktu, release hasil, bank valid. |
| [/dashboard/guru/grading/[attemptId]](../../apps/web/app/dashboard/guru/grading/[attemptId]/page.tsx) | 302 | SEC-08, BUG-06, BUG-15, UX-06 | Penilaian parsial/lengkap, range, ID asing, regrade menjaga nilai manual. |
| [/dashboard/guru/grading/assignment/[attemptId]](../../apps/web/app/dashboard/guru/grading/assignment/[attemptId]/page.tsx) | 357 | SEC-08, BUG-01, BUG-06, BUG-15 | Kepemilikan answer, nilai parsial, PDF/lampiran, rentang skor. |
| [/dashboard/guru/grading](../../apps/web/app/dashboard/guru/grading/page.tsx) | 395 | BUG-06, UX-02, QA-02 | Daftar pending benar, pergantian ujian, error, detail dengan izin. |
| [/dashboard/guru/monitoring/[attemptId]](../../apps/web/app/dashboard/guru/monitoring/[attemptId]/page.tsx) | 484 | SEC-09–10, BUG-11, BUG-15, UX-05 | Statistik esai/objektif, bukti historis, reset/terminate, izin staf. |
| [/dashboard/guru/monitoring](../../apps/web/app/dashboard/guru/monitoring/page.tsx) | 1112 | SEC-09–10, UX-08 | Balapan pemilihan ujian, refresh, log asli, reset/terminate idempoten. |
| [/dashboard/guru](../../apps/web/app/dashboard/guru/page.tsx) | 516 | UX-03, QA-01–03 | Autentikasi dan role, agregasi, navigasi, loading/error/empty. |
| [/dashboard/guru/questions/[bankId]/edit](../../apps/web/app/dashboard/guru/questions/[bankId]/edit/page.tsx) | 557 | SEC-07, BUG-01, BUG-07, BUG-14–15 | Soal/opsi asing, bobot nol, semua tipe, upload, pelestarian grading manual. |
| [/dashboard/guru/questions/[bankId]](../../apps/web/app/dashboard/guru/questions/[bankId]/page.tsx) | 1088 | SEC-07, SEC-11, BUG-01, BUG-07, BUG-11, BUG-14–15, QA-03 | Impor/edit/delete, soal sudah dipakai, lampiran, preview, izin bank. |
| [/dashboard/guru/questions](../../apps/web/app/dashboard/guru/questions/page.tsx) | 1312 | SEC-07, SEC-11, QA-03 | Cakupan bank pemilik, kategori, pencarian, empty/error, aksi massal. |
| [/dashboard/notifications](../../apps/web/app/dashboard/notifications/page.tsx) | 426 | UX-02, UX-10 | Lebih dari 50 item, filter server, unread count, aksi massal dan error. |
| [/dashboard/notifications/settings](../../apps/web/app/dashboard/notifications/settings/page.tsx) | 377 | SEC-05, UX-07 | Preferensi hanya milik pengguna sendiri, toggle keyboard/screen reader, simpan gagal. |
| [/dashboard/pengawas/monitoring](../../apps/web/app/dashboard/pengawas/monitoring/page.tsx) | 9 | UX-01 | Data live, izin role Pengawas, kondisi tanpa ujian, koneksi putus. |
| [/dashboard/pengawas](../../apps/web/app/dashboard/pengawas/page.tsx) | 76 | UX-01 | Data live, izin role Pengawas, kondisi tanpa ujian, koneksi putus. |
| [/dashboard/proktor/assignments/[examId]](../../apps/web/app/dashboard/proktor/assignments/[examId]/page.tsx) | 471 | SEC-01, SEC-08, BUG-01, BUG-06 | Penugasan peserta, berkas tugas, izin nilai dan hasil. |
| [/dashboard/proktor/backup](../../apps/web/app/dashboard/proktor/backup/page.tsx) | 245 | SEC-12–13, BUG-02, BUG-04–05 | Round-trip ZIP bergambar, izin awal, limit, kegagalan tengah restore, cakupan entitas. |
| [/dashboard/proktor/classes](../../apps/web/app/dashboard/proktor/classes/page.tsx) | 652 | UX-02, QA-02 | Keanggotaan/organisasi, CRUD bila role staf, empty/error dan paging. |
| [/dashboard/proktor/exams](../../apps/web/app/dashboard/proktor/exams/page.tsx) | 2255 | SEC-01, SEC-14, BUG-12–13, QA-03 | Publish public/private, target, waktu, release hasil, bank valid. |
| [/dashboard/proktor/exams/pas/[id]](../../apps/web/app/dashboard/proktor/exams/pas/[id]/page.tsx) | 570 | UX-09, BUG-05, BUG-13 | Generate parsial, skipped, target hasil pembuatan dan backup jadwal. |
| [/dashboard/proktor/monitoring/[attemptId]](../../apps/web/app/dashboard/proktor/monitoring/[attemptId]/page.tsx) | 482 | SEC-09–10, BUG-11, BUG-15, UX-05 | Statistik esai/objektif, bukti historis, reset/terminate, izin staf. |
| [/dashboard/proktor/monitoring](../../apps/web/app/dashboard/proktor/monitoring/page.tsx) | 1119 | SEC-09–10, UX-08 | Balapan pemilihan ujian, refresh, log asli, reset/terminate idempoten. |
| [/dashboard/proktor](../../apps/web/app/dashboard/proktor/page.tsx) | 560 | UX-03, QA-01–03 | Autentikasi dan role, agregasi, navigasi, loading/error/empty. |
| [/dashboard/proktor/pas](../../apps/web/app/dashboard/proktor/pas/page.tsx) | 376 | BUG-05, QA-02 | Konfigurasi/jadwal tersimpan, izin, validasi waktu, pemulihan backup. |
| [/dashboard/proktor/questions/[bankId]/edit](../../apps/web/app/dashboard/proktor/questions/[bankId]/edit/page.tsx) | 548 | SEC-07, BUG-01, BUG-07, BUG-14–15 | Soal/opsi asing, bobot nol, semua tipe, upload, pelestarian grading manual. |
| [/dashboard/proktor/questions/[bankId]](../../apps/web/app/dashboard/proktor/questions/[bankId]/page.tsx) | 1088 | SEC-07, SEC-11, BUG-01, BUG-07, BUG-11, BUG-14–15, QA-03 | Impor/edit/delete, soal sudah dipakai, lampiran, preview, izin bank. |
| [/dashboard/proktor/questions](../../apps/web/app/dashboard/proktor/questions/page.tsx) | 1312 | SEC-07, SEC-11, QA-03 | Cakupan bank pemilik, kategori, pencarian, empty/error, aksi massal. |
| [/dashboard/siswa/analytics](../../apps/web/app/dashboard/siswa/analytics/page.tsx) | 682 | SEC-14, UX-12 | Rilis nilai, tren pendek, histori selesai, data minimum. |
| [/dashboard/siswa/classes](../../apps/web/app/dashboard/siswa/classes/page.tsx) | 261 | UX-02, QA-02 | Keanggotaan/organisasi, CRUD bila role staf, empty/error dan paging. |
| [/dashboard/siswa/exam/[id]](../../apps/web/app/dashboard/siswa/exam/[id]/page.tsx) | 9 | SEC-01–04, SEC-09–10, BUG-01, BUG-03, BUG-08–10, BUG-12, BUG-14, BUG-16 | Kelayakan, kunci, waktu, offline/reload, autosave balapan, storage penuh, submit/retry. |
| [/dashboard/siswa](../../apps/web/app/dashboard/siswa/page.tsx) | 367 | SEC-14, UX-02, UX-04 | Ringkasan hanya data yang boleh dirilis; hitungan aktif/selesai, error sesi. |
| [/dashboard/siswa/results/[attemptId]](../../apps/web/app/dashboard/siswa/results/[attemptId]/page.tsx) | 560 | SEC-14, UX-02, UX-06 | Pemilik, rilis hasil, status, rincian skor dan waktu. |
| [/dashboard/siswa/results](../../apps/web/app/dashboard/siswa/results/page.tsx) | 177 | SEC-14, UX-02, UX-04, UX-06–07 | Status selesai, skor tersembunyi di API, keyboard, data kosong/error. |
| [/dashboard/siswa/results/review/[attemptId]](../../apps/web/app/dashboard/siswa/results/review/[attemptId]/page.tsx) | 1043 | SEC-14, BUG-11–12, BUG-15 | Kunci hanya setelah rilis, status final, bukti historis, semua tipe soal. |
| [/dashboard/siswa/schedule](../../apps/web/app/dashboard/siswa/schedule/page.tsx) | 356 | SEC-01, BUG-13, UX-02, UX-06 | Public/private, target kelas/individu, awal/akhir ujian dan zona waktu. |
| [/](../../apps/web/app/page.tsx) | 145 | QA-01 | Login, transisi sesi, error/timeout, redirect role; uji rate limit deployment. |

## Komponen/jalur bersama yang ditelusuri

| Jalur | Fokus |
|---|---|
| Dashboard layout, session, JWT/proxy helpers | Identitas, role, loading, error, perbedaan izin UI/server |
| ExamPage, ExamViewer, renderer/form tipe soal | Autosave, timer, offline, hook, metadata, lampiran |
| Students / exam-attempts | Penugasan, deadline, finalisasi, hasil, retry dan late sync |
| Questions / imports / grading / teachers | Kepemilikan bank/answer, bobot, regrade, penilaian manual |
| Proctoring / monitoring | Event, hitungan warning, reset/terminasi dan statistik |
| Storage / backup | Kontrak respons, kepemilikan objek, validasi arsip, integritas dan pemulihan |
| Analytics / notifications / PAS | Akurasi informasi, pagination, hasil parsial dan ekspor |
| FastAPI scoring dan parser | Paritas tes lama, validasi jawaban, duplikasi pilihan |

Inventaris penuh menyimpan path, jumlah baris, SHA-256, serta metadata struktur halaman pada [inventory.json](inventory.json). Angka baris adalah ukuran cakupan mekanis, bukan metrik kualitas atau jaminan semua baris telah diverifikasi manual.
