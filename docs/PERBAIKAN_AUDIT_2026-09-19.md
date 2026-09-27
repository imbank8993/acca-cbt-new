# Catatan perbaikan audit ACCA CBT

Dimulai 19 September 2026; diperbarui 27 September 2026. Acuan: [audit awal](AUDIT_LENGKAP_2026-09-19.md), baseline Git `a8861683c7612920a511859f1d1f009ec4d49f17`.

## Status pekerjaan

Tiga puluh enam tahap implementasi telah diselesaikan dan diuji. **Seluruh 45 ID audit awal, temuan tambahan IMP-01, delapan temuan audit jawaban/jaringan, tiga temuan lifecycle, serta temuan lanjutan sampai Tahap 36 sudah ditangani.** “Selesai” berarti perubahan kode dan tes lokal lulus; validasi browser dan deployment produksi masih dicatat terpisah. SEC-14 selesai setelah jalur perubahan jawaban pascapenutupan ditutup pada Tahap 4.

Audit lanjutan terhadap perekaman jawaban dan gangguan jaringan menemukan delapan area hardening baru. ANS-01, ANS-02, dan ANS-08 diperbaiki pada tahap 13; ANS-04 pada tahap 14; ANS-05 pada tahap 15; ANS-03 pada tahap 16; ANS-06 pada tahap 17; dan ANS-07 pada tahap 18. Temuan ini berada di luar 45 ID awal dan dicatat terpisah dalam [audit perekaman jawaban dan jaringan](perbaikan-2026-09-19/AUDIT-PEREKAMAN-JAWABAN-DAN-JARINGAN.md).

Migrasi yang dinyatakan permanen pada catatan tiap tahap telah diterapkan ke `acca_db` dan diverifikasi lewat koneksi baru. Belum dilakukan pengunggahan/penghapusan objek R2 sungguhan atau deployment. Bukti audit awal dipertahankan sebagai baseline; skrip reproduksi lama sengaja mengharapkan bug lama sehingga tidak lagi menjadi tes kelulusan untuk kode terbaru.

| Tahap | Lingkup | Temuan | Verifikasi |
|---|---|---|---|
| 1 | Akses ujian, DTO soal siswa, pencocokan submit, rilis hasil | SEC-01, SEC-02, SEC-04, sebagian SEC-14, BUG-13, UX-04 | 36 tes regresi lokal lulus |
| 2 | Kepemilikan resource, validasi nilai, event pengawasan, storage | SEC-05–09, SEC-11, BUG-01, BUG-06–07 | 32 tes baru; gabungan tahap 1–2: 68 lulus |
| 3 | Integritas pilihan kompleks dan agregasi nilai manual | BUG-15–16 | 3 tes backend lulus; 98 tes Python lulus (78 lama + 20 baru) |
| 4 | State attempt, deadline, submit atomik, autosave/recovery, dashboard pengawas | SEC-03, SEC-10, penyelesaian SEC-14, BUG-03, BUG-08–10, UX-01 | 7 tes tahap 4; gabungan tes Node: 78 lulus; TypeScript API/web lulus |
| 5 | Keamanan, atomicity, dan cakupan backup/restore | SEC-12–13, BUG-02, BUG-04–05 | 7 tes tahap 5; gabungan tes Node: 85 lulus; TypeScript API/web lulus |
| 6 | Keandalan UI, aksesibilitas, waktu, pagination, dan ekspor analitik | BUG-14, UX-02–03, UX-05–12 | 7 tes tahap 6; gabungan tes Node: 92 lulus; TypeScript API/web lulus |
| 7 | Pengaman regresi lint frontend di CI | QA-01 | Baseline penuh diperketat menjadi 1.214 error dan 640 warning lama; kenaikan per aturan menggagalkan CI |
| 8 | Integritas urutan dan relasi stimulus saat impor soal | IMP-01 (temuan tambahan) | 44 tes round-trip dan 9 tes service lulus; TypeScript API/web lulus |
| 9 | Integritas soal dan jawaban historis | BUG-11 | 5 skenario regresi BUG-11; 13 tes service dan TypeScript API/web lulus |
| 10 | Keseragaman sumber soal ujian legacy dan multi-bank | BUG-12 | 3 tes BUG-12; gabungan tes Node menjadi 95 lulus; TypeScript API/web lulus |
| 11 | Integrasi lintas layanan dan gate regresi P1 | QA-02 | 4 tes integrasi baru; paket CI: 102 tes Node + 44 round-trip + 13 service lulus |
| 12 | Implementasi bersama halaman bank soal lintas peran | QA-03 | 4 tes paritas route/otorisasi; paket CI: 106 tes Node + 44 round-trip + 13 service lulus |
| 13 | Ketahanan autosave dan auto-submit pada jaringan bermasalah | ANS-01, ANS-02, ANS-08 | 4 tes baru; paket CI: 110 tes Node + 44 round-trip + 13 service lulus |
| 14 | Validasi relasi soal dan opsi pada autosave | ANS-04 | 5 tes baru; paket CI: 115 tes Node + 44 round-trip + 13 service lulus |
| 15 | Idempotensi start dan pencegahan attempt aktif ganda | ANS-05 | 3 tes baru; paket CI: 118 tes Node + 44 round-trip + 13 service lulus |
| 16 | Pemulihan jawaban offline yang terotorisasi dan dapat diaudit | ANS-03 | 4 tes baru; paket CI: 122 tes Node + 44 round-trip + 13 service lulus |
| 17 | IndexedDB untuk snapshot jawaban dan identitas perangkat | ANS-06 | 4 tes baru; paket CI: 126 tes Node + 44 round-trip + 13 service lulus |
| 18 | Antrean event keamanan, heartbeat, status offline, terminasi terkonfirmasi | ANS-07 | 5 tes baru; paket CI: 131 tes Node + 44 round-trip + 13 service lulus |
| 19 | Race reset/grading, finalisasi kedaluwarsa, dan paket validasi staging | LIF-01–03 | 4 tes baru; paket CI: 135 tes Node + 44 round-trip + 13 service lulus |
| 20 | Penguncian aplikasi ke satu sekolah | SCHOOL-01–06 | 6 tes baru dan audit database |
| 21 | Backup/restore satu sekolah | SCHOOL-07–08 | Cakupan dan identitas arsip divalidasi |
| 22 | Konteks sekolah hanya dari sesi | SCHOOL-09 | 4 tes transport lulus |
| 23 | Satu sumber peran dashboard | SCHOOL-ROLE-01–04 | 4 tes lulus |
| 24 | Profil sekolah operasional dari sesi | SCHOOL-PROFILE-01–04 | 4 tes lulus |
| 25 | Timeout permintaan baca | NET-01–06 | 6 tes lulus |
| 26 | Idempotensi pembuatan data | IDM-01–06 | 6 tes dan migrasi permanen |
| 27 | Idempotensi data turunan | IDM-07–11 | 5 tes dan migrasi permanen |
| 28 | Integritas isi bank soal | QID-01–07 | 7 tes dan migrasi permanen |
| 29 | Integritas pembangkitan ujian massal | GEN-01–07 | 7 tes lulus |
| 30 | Integritas penugasan ruang PAS | ROOM-01–09 | 9 tes dan migrasi permanen |
| 31 | Integritas penghapusan ujian | DEL-01–13 | 13 tes lulus |
| 32 | Jadwal siswa dengan banyak riwayat kelas | SCHEDULE-01–03 | 3 tes lulus |
| 33 | Integritas penugasan ujian | ASSIGN-01–05 | 5 tes lulus |
| 34 | Pemulihan peserta terpilih per kelas | RESTORE-01–05 | 5 tes dan migrasi permanen |
| 35 | Sinkronisasi ujian hasil generate | SYNC-01–09 | 9 tes dan audit database tanpa temuan |
| 36 | Integritas sesi dan jadwal PAS | SESSION-01–08 | 8 tes, migrasi permanen, dan audit tanpa temuan |

Daftar 45 ID audit awal serta temuan tambahan IMP-01 beserta statusnya tersedia dalam [tracker perbaikan](perbaikan-2026-09-19/STATUS_TEMUAN.md).

## Tahap 1 — Akses ujian dan kerahasiaan jawaban

### SEC-01 dan BUG-13: satu aturan akses untuk daftar, detail, soal, dan mulai ujian

**Sebelum:** daftar siswa memfilter penugasan, tetapi permintaan langsung ke detail/soal/start tidak memeriksa aturan yang sama. Ujian public tanpa penugasan justru tidak muncul di daftar.

**Sesudah:** helper bersama `exam-access.ts` membentuk audiens dari keanggotaan organisasi aktif, kelas reguler, kelas tambahan, dan peserta individual. Ujian harus published dan organisasi pemiliknya harus termasuk keanggotaan aktif pengguna. Ujian private memerlukan penugasan; public tersedia bagi anggota aktif organisasi pemilik tanpa penugasan tambahan. Kesalahan membaca sumber izin menghasilkan 503 dan tidak memberikan akses. Kunci public tidak ditafsirkan sebagai akses anonim atau lintas sekolah.

Soal sebelum `start_time` ditolak menggunakan waktu server. Detail jadwal masih dapat dibaca peserta sah sebelum mulai. Jalur mulai tetap memiliki pemeriksaan waktu yang sudah ada. Pemeriksaan deadline pada setiap save/submit masih menjadi SEC-03 dan belum diklaim selesai. Pembacaan soal setelah akhir waktu tidak diblokir dalam tahap ini karena alur pemulihan lama mengambil soal sebelum memanggil start; perubahan alur recovery ditangani bersama SEC-10/BUG-10.

**Lokasi:** [exam-access.ts](../apps/api/src/students/exam-access.ts), [students.service.ts](../apps/api/src/students/students.service.ts), [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts). Keterangan public diperjelas pada halaman ujian admin/proktor/guru.

**Pengujian:** peserta individual, kelas reguler/tambahan, public tanpa target, private tidak ditugaskan, organisasi lain, keanggotaan tidak aktif, draft, kegagalan query izin, serta soal sebelum mulai.

**Dampak kompatibilitas:** akun lama yang hanya mempunyai keanggotaan kelas tetapi tidak mempunyai keanggotaan organisasi aktif kini ditolak dari ujian baru. Periksa konsistensi keanggotaan pada staging sebelum rollout; riwayat hasil tetap menggunakan kepemilikan attempt. Tidak dibuat bypass untuk administrator pada endpoint peserta.

### SEC-02: pemisahan data tampilan dari kunci penilaian

**Sebelum:** metadata soal/opsi mentah, bobot, jawaban isian, pasangan benar, dan urutan benar ikut dikirim ke browser.

**Sesudah:** `student-question.ts` membuat DTO dengan allowlist. Siswa tetap menerima teks, ID opsi, gambar yang diperlukan, stimulus, instruksi, serta konfigurasi lampiran esai. Field grading, penjelasan kunci, bobot, dimensi penilaian, metadata tambahan tak dikenal, dan jawaban isian tidak diteruskan.

Untuk matching/kategorisasi, kandidat kanan/kategori diambil sebagai daftar terpisah tanpa pemetaan jawaban per opsi; fallback data lama tunggal/jamak tetap didukung. Daftar kandidat diurutkan secara independen agar urutan pasangan tersimpan tidak menjadi petunjuk. Untuk soal ordering, tampilan opsi disusun deterministik dari ID/seed peserta-ujian dan diberi nomor tampilan baru; urutan kunci database tidak diekspos. Data penilaian server tidak diubah.

**Lokasi:** [student-question.ts](../apps/api/src/students/student-question.ts), [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts).

**Pengujian:** tipe objektif, esai/alias, psikometri, matching, kategori, fallback kandidat lama, order yang stabil meski urutan kunci berubah, serta pemakaian DTO oleh endpoint soal sebenarnya. Tes memeriksa isi respons, bukan sekadar ketidakmunculan field di UI.

**Batas:** tes browser rendering semua tipe belum dilakukan. Allowlist perlu diperluas secara sengaja bila fitur tampilan baru ditambahkan; jangan kembali menyebarkan seluruh metadata.

### SEC-04: attempt harus cocok dengan ujian

**Sebelum:** attempt milik siswa dapat dipakai pada submit ujian lain; jalur alreadySubmitted juga tidak mencocokkan ujian.

**Sesudah:** pemeriksaan awal submit memverifikasi `exam_id` sebelum penilaian dan sebelum respons alreadySubmitted. Resolver juga menolak ID asing/tidak ada atau pasangan ujian yang salah, tanpa diam-diam memilih attempt lain. Pengulangan submit pada attempt selesai yang cocok tetap idempoten.

**Pengujian:** mismatch pada in_progress/submitted/auto_submitted, penolakan sebelum scoring, serta submit ulang yang sah.

### SEC-14 dan UX-04: hasil aktif/tersembunyi tidak bocor lewat jalur hasil biasa

**Sebelum:** daftar hasil menyertakan attempt aktif dan skor belum dirilis; review/detail bisa dibuka ketika masih mengerjakan jika show_results aktif. Analitik masih memasukkan nilai tersembunyi.

**Sesudah:** daftar hasil hanya berisi status final. Skor total dan IRT dikirim null ketika show_results belum true. Pemilik attempt aktif ditolak dari detail/review. Overview, histori, perbandingan dan agregasi peringkat analitik siswa hanya memakai hasil yang sudah dirilis; batas jumlah histori diterapkan setelah penyaringan. Staf pada review tetap harus melalui izin ujian yang ada.

**Lokasi:** [students.service.ts](../apps/api/src/students/students.service.ts), [exam-review.service.ts](../apps/api/src/analytics/exam-review.service.ts), [student-analytics.service.ts](../apps/api/src/analytics/student-analytics.service.ts).

**Pengujian:** attempt aktif tidak muncul sebagai hasil, skor tersembunyi null, review aktif ditolak sebelum mengambil soal/jawaban, analitik tersembunyi kosong, serta histori tetap mengisi limit dengan hasil yang dirilis.

Jalur late sync otomatis yang sebelumnya masih dapat mengubah jawaban setelah attempt final sudah ditutup pada tahap 4. Filtering analitik dilakukan setelah pembacaan database demi kompatibilitas adapter; optimasi query/pagination untuk volume besar belum dilakukan.

## Tahap 2 — Penulisan data harus mengikuti pemilik dan aturan nilai

### SEC-05: preferensi tidak dapat mengganti identitas target

Service hanya memetakan field preferensi yang diizinkan dan selalu menetapkan user_id dari sesi. ID, timestamp, dan field asing dari body tidak diteruskan. Boolean divalidasi, menit pengingat harus integer 0–10.080, dan jam tenang menerima format HH:mm atau HH:mm:ss yang valid; kosong/null menghapus jam tenang. Field asing diabaikan agar UI yang mengirim objek preferensi lengkap tetap kompatibel.

**Lokasi:** [notifications.service.ts](../apps/api/src/notifications/notifications.service.ts). **Tes:** percobaan user_id korban, timestamp/kolom asing, tipe nilai salah, waktu invalid, format lama dan pengosongan nilai.

### SEC-07: soal, opsi, dan referensi harus berasal dari bank yang diizinkan

Update memeriksa bahwa soal sudah ada pada bank tujuan. ID opsi existing harus unik dan benar-benar milik soal itu. Stimulus, instruksi, dimensi, dan kisi-kisi yang dirujuk harus berasal dari bank yang sama. Semua pemeriksaan dilakukan sebelum mutasi pertama. Soal baru memakai insert tanpa ID klien; soal lama memakai update dengan kondisi ID dan bank, sehingga ID asing tidak dapat direlokasi lewat upsert.

**Lokasi:** [questions.service.ts](../apps/api/src/questions/questions.service.ts). **Tes:** soal asing, opsi asing, stimulus lintas bank, opsi existing pada create, serta update sah dengan bobot nol.

**Batas:** penggantian opsi belum menjadi satu transaksi database penuh. Kegagalan infrastruktur di tengah rangkaian write masih perlu penanganan atomicity; tes “tanpa partial write” tahap ini hanya membuktikan input yang tidak sah ditolak sebelum write, bukan rollback seluruh kegagalan database. Perlindungan perubahan bank/soal historis diselesaikan pada tahap 9 (BUG-11).

### SEC-08 dan BUG-06: penilaian esai dibatasi ke attempt dan rentang yang benar

Sebelum write, service memeriksa izin staf ujian, status attempt final, map nilai tidak kosong, kepemilikan seluruh answer ID, tipe esai, angka finite, serta rentang nol sampai maksimum per soal. Satu item invalid membatalkan permintaan sebelum mutasi. Update setiap jawaban juga mempunyai kondisi attempt_id.

Penilaian parsial tetap menandai needs_manual_grading. Nilai nol yang sudah dinilai dibedakan dari nol sementara yang menunggu guru lewat is_correct. Total akademik memakai denominator soal akademik dan tidak memasukkan tipe psikometri.

**Lokasi:** [teachers.service.ts](../apps/api/src/teachers/teachers.service.ts). **Tes:** answer asing, soal objektif, skor 999/negatif/NaN/string, map kosong, penilaian bertahap, nilai nol, dan ujian campuran.

**Batas:** write tiap jawaban belum atomik sebagai satu batch; kegagalan tengah proses dikembalikan sebagai error untuk retry, tetapi nilai yang sempat tersimpan dapat tetap ada. Validasi request bukan pengganti transaksi. Data skor historis yang sudah invalid tidak dimigrasikan atau diperbaiki otomatis.

### SEC-09: event administratif tidak dapat dikirim sebagai event siswa

Controller dan service memakai allowlist event siswa. RESET_BY_PROCTOR, FORCE_TERMINATED, LATE_ANSWER_SYNC, dan event tidak dikenal ditolak. Metadata actor_id/source ditetapkan server sehingga tidak dapat diganti body. Event lama `blur` dan `tab_close` tetap didukung.

**Lokasi:** [proctoring.controller.ts](../apps/api/src/proctoring/proctoring.controller.ts), [proctoring.service.ts](../apps/api/src/proctoring/proctoring.service.ts). **Tes:** penolakan event administratif/asing sebelum penulisan dan identitas sumber untuk event sah.

**Batas:** ini memperbaiki pemalsuan event reset, bukan menjamin pengawasan browser tidak dapat dilewati. Transisi terminasi, deadline, dan enforcement jumlah pelanggaran masih perlu tahap state machine berikutnya.

### SEC-11: impor memakai kebijakan pemilik bank yang sama dengan editor

assertCanImport memakai assertBankAccess. Jalur permission dan bulkImport sama-sama mewarisi pembatasan guru hanya ke bank yang berhak dikelolanya; pengecualian Proktor/Admin mengikuti service otorisasi yang sudah ada.

**Lokasi:** [imports.service.ts](../apps/api/src/imports/imports.service.ts). **Tes:** bank asing ditolak pada permission dan eksekusi impor.

### SEC-06 dan BUG-01: kepemilikan objek serta kontrak sukses storage

Upload pengguna non-assignment disimpan di `users/<userId>/<folder>/<file>`, dengan userId dari sesi. Assignment tetap memakai `assignments/<examId>/<userId>/<file>` dan owner dipaksa oleh server. Delete pengguna hanya menerima dua bentuk namespace itu jika owner cocok; prefix lain dan segmen dot ditolak. Host r2.dev yang tidak dikonfigurasi tidak lagi diterima sebagai URL storage sendiri.

Respons upload dan delete sukses kini menyertakan `success: true`, sesuai kontrak uploader frontend, sehingga HTTP 200 tidak lagi dianggap gagal karena field hilang.

**Lokasi:** [storage.controller.ts](../apps/api/src/storage/storage.controller.ts), [storage.service.ts](../apps/api/src/storage/storage.service.ts). **Tes:** objek korban, prefix legacy/shared, backup-restores, traversal, upload milik sendiri, delete milik sendiri, kontrak success, serta host storage asing.

**Dampak kompatibilitas:** URL berkas lama tetap dapat dibaca. Endpoint delete pengguna kini menolak berkas lama yang tidak mempunyai namespace pemilik. Pembersihan berkas lama perlu jalur staf/internal yang memang sudah mengotorisasi resource atau migrasi kepemilikan yang terverifikasi; jangan menambahkan bypass berdasarkan role global tanpa hubungan resource. Objek internal bersama seperti hasil render persamaan tidak diberi owner pengguna secara fiktif.

### BUG-07: bobot nol dipertahankan

Default menggunakan `??`, bukan `||`, pada penyimpanan opsi dan dua pemetaan bulk import frontend. Angka nol tidak lagi dianggap kosong. Perubahan ini tidak menghitung ulang semua nilai historis secara otomatis.

**Lokasi:** [questions.service.ts](../apps/api/src/questions/questions.service.ts), [BulkImportModal.tsx](../apps/web/app/components/questions/BulkImportModal.tsx). **Tes:** penyimpanan update opsi nol; TypeScript frontend mencakup perubahan pemetaan impor. Interaksi impor browser belum diuji.

## Tahap 3 — Integritas mesin penilaian dan total nilai manual

### BUG-15: kontribusi nilai esai dipertahankan ketika menghitung ulang total

**Koreksi audit awal:** endpoint batch Python melewati esai dan tidak mengembalikan item score-zero untuknya. Karena itu klaim awal bahwa baris cbt_answers esai pasti ditimpa nol terlalu luas. Cacat yang terkonfirmasi adalah total_score/base_score dihitung tanpa menjumlahkan nilai manual yang sudah ada. Koreksi ini dicatat agar keputusan perbaikan mengikuti alur sebenarnya.

Regrade dan grading dari jawaban tersimpan kini membaca score/is_correct manual, menambahkan kontribusinya pada total otomatis sebelum normalisasi, dan menghitung status pending dari esai yang belum benar-benar dinilai. Nilai jawaban/feedback esai tidak disentuh. Nilai manual nol dengan is_correct false tetap dianggap selesai dinilai; flag null tetap pending.

**Lokasi:** [grading.service.ts](../apps/api/src/grading/grading.service.ts). **Tes:** otomatis 10 + manual 8 dengan maksimum 20 menghasilkan 90, bukan 50; metadata/feedback tetap; jalur saved-answer konsisten; nilai nol dan pending dibedakan.

**Batas:** tes memakai kontrak scoring tiruan yang meniru respons batch asli, tanpa HTTP antarservice. Kegagalan write/regrade batch serta perubahan soal historis masih menjadi pekerjaan lanjutan. Tidak dilakukan recalculation nilai produksi.

### BUG-16: jawaban duplikat tidak memperoleh kredit ganda

MCQ kompleks memerlukan pilihan unik dan kesetaraan himpunan dengan kunci yang tidak kosong. Checklist dan ranking menolak pilihan duplikat/ID asing untuk pemberian skor dimensi; ordering juga menolak duplikat/ID asing. Matching dan kategorisasi memakai himpunan string unik, sehingga X,X tidak menggantikan X,Y. Nilai nested yang bukan string tidak menyebabkan error set pada cabang-cabang tersebut.

**Lokasi:** [grading.py](../apps/scoring/app/services/grading.py). **Tes:** 20 kasus integritas baru meliputi duplikasi/ID asing pada empat tipe, pilihan valid, bobot nol, pairing duplikat, dan input nested. Seluruh 78 tes paritas yang sudah ada tetap lulus.

Kebijakan input malformed adalah tidak memberikan kredit pada cabang yang ditolak, bukan menggandakan pilihan atau menghentikan seluruh batch. Validasi bentuk seluruh tipe lain tetap perlu diperluas; ini tidak diklaim menutup semua input malformed yang mungkin.

## Tahap 4 — Integritas state pengerjaan dan pemulihan jawaban

### SEC-03: deadline dan perangkat diperiksa pada setiap mutasi jawaban

Save tunggal, sinkronisasi massal, dan submit kini mewajibkan device ID sepanjang 8–200 karakter. Setiap penulisan mengunci baris attempt, memeriksa pemilik, status `in_progress`, perangkat yang terikat, waktu mulai, serta deadline efektif menggunakan jam database. Pemeriksaan tidak lagi bergantung pada timer browser atau pada halaman monitoring yang sedang terbuka. Permintaan tepat pada atau sesudah deadline ditolak.

**Lokasi:** [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts), [students.dto.ts](../apps/api/src/students/dto/students.dto.ts), [prisma-db-adapter.ts](../apps/api/src/prisma/prisma-db-adapter.ts).

**Pengujian:** device kosong, device berbeda, penulisan sah, serta penulisan setelah deadline. Fixture database kini mendukung jam server, lock, transaksi, dan rollback untuk membuktikan perilaku kegagalan.

**Batas:** device ID browser adalah pengikat sesi operasional, bukan identitas perangkat yang tahan pemalsuan. Kontrol utama tetap autentikasi pengguna, kepemilikan attempt, status, dan deadline server.

### SEC-10 dan penyelesaian SEC-14: state final tidak dapat dibuka lewat late sync

Terminasi otomatis dan terminasi paksa memakai compare-and-set dari `in_progress`; permintaan ulang pada attempt final tidak mengubah `finished_at`, tidak menilai ulang, dan tidak menulis log terminasi baru. Endpoint late answer lama dipertahankan untuk kompatibilitas rute, tetapi selalu menolak perubahan pada attempt `auto_submitted` dan mengarahkan pemulihan melalui reset proktor.

Setelah reset yang sah, proktor menerbitkan grace period 15 menit pada metadata attempt. Penanda ini memungkinkan resume setelah batas akhir global, tetapi hanya sampai deadline pemulihan. Klien lalu mengirim salinan lokal melalui endpoint sinkronisasi biasa, sehingga seluruh pemeriksaan status, perangkat, dan deadline kembali berlaku. Tanpa reset, cache lokal dipertahankan dan UI meminta siswa menghubungi proktor.

**Lokasi:** [proctoring.service.ts](../apps/api/src/proctoring/proctoring.service.ts), [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx).

**Pengujian:** late sync pada attempt final ditolak, terminasi ulang idempoten, auto-finish hanya menilai sekali, serta recovery proktor dapat dilanjutkan setelah jadwal global berakhir.

### BUG-03: jawaban dan status submit disimpan sebagai satu transaksi

Submit mengunci attempt, melakukan upsert seluruh jawaban hasil penilaian, lalu mengubah status, skor, metadata, dan waktu selesai dalam satu transaksi database. Kegagalan penyimpanan jawaban me-roll back perubahan status; UI dapat mencoba submit lagi tanpa menemukan attempt final yang kehilangan bukti jawaban. Submit ulang yang sudah final tetap idempoten.

**Pengujian:** fixture memaksa kegagalan tabel jawaban dan memverifikasi status tetap `in_progress` serta `finished_at` tidak terisi.

### BUG-08: autosave per soal dijalankan berurutan

`PerKeyQueue` mengantre perubahan untuk soal yang sama, sehingga request lama selalu selesai sebelum request baru dimulai. Autosave soal berbeda tetap dapat berjalan paralel. Penanda in-flight dipertahankan sampai antrean terakhir selesai agar flush saat tab ditutup tetap membawa nilai terbaru.

**Lokasi:** [per-key-queue.ts](../apps/web/lib/per-key-queue.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx). **Tes:** dua save soal yang sama terbukti berurutan, sedangkan save soal lain tetap berjalan tanpa menunggu.

### BUG-09: kegagalan Web Storage tidak menghentikan ujian

Pembacaan dan penulisan `localStorage`/`sessionStorage` yang berada pada jalur pembukaan, heartbeat, autosave, sinkronisasi, dan pembersihan cache kini dilindungi. Browser mode privat, storage penuh, atau kebijakan perangkat tidak lagi melempar exception yang menghentikan autosave server atau menggagalkan pembukaan halaman. UI memberi peringatan ketika cache jawaban lokal tidak dapat ditulis.

### BUG-10: finalisasi kedaluwarsa dan recovery memakai state yang sama

Membuka ulang attempt setelah batas global kini menjalankan auto-finish idempoten walaupun halaman monitoring tidak pernah dibuka. Jawaban server dinilai dan cache lokal tetap ada. Jika proktor menyetujui pemulihan, reset membuat deadline pemulihan bertanda server; resume tidak lagi langsung menutup attempt hanya karena jadwal global telah lewat.

### UX-01: dashboard pengawas memakai data API nyata

Dashboard dan layar monitoring pengawas tidak lagi menampilkan statistik maupun kejadian contoh sebagai data aktif. Pemilihan ujian, ringkasan attempt, log pelanggaran, refresh berkala, dan navigasi monitoring mengambil data dari layanan NestJS. Empty state dan status pemuatan ditampilkan ketika data belum tersedia.

## Tahap 5 — Backup/restore yang terotorisasi, terbatas, dan atomik

### SEC-12 dan BUG-02: izin serta signature diperiksa sebelum ekstraksi dan upload

Route import kini mewajibkan `organizationId` pada query URL. Token dan izin proktor untuk organisasi tersebut diperiksa ke NestJS sebelum `request.formData()` membaca multipart body. Nilai organisasi di form harus sama dengan nilai yang sudah diotorisasi, dan endpoint import NestJS tetap memeriksa izin lagi saat mutasi dimulai.

Arsip dibatasi 50 MB terkompresi, 120 MB hasil dekompresi, 20 MB manifest, 10 MB per gambar, dan 501 file. Jalur absolut/traversal, file di luar `backup.cbtbak` dan folder `images/`, serta ekstensi gambar yang tidak diizinkan ditolak. Signature HMAC dihitung dan dibandingkan atas manifest asli sebelum path gambar diganti atau objek R2 ditulis. Satu byte perubahan pada manifest menyebabkan restore berhenti dengan nol upload.

Setelah signature sah, gambar diunggah. Kegagalan salah satu gambar atau kegagalan import database menghapus kembali seluruh objek yang baru dibuat, sehingga restore gagal tidak meninggalkan objek yatim. Kunci objek memakai UUID kriptografis.

**Lokasi:** [import route](../apps/web/app/api/backup/import/route.ts), [backup controller](../apps/api/src/backup/backup.controller.ts), [backup service](../apps/api/src/backup/backup.service.ts), serta halaman backup admin/proktor.

**Konfigurasi:** fallback secret konstan telah dihapus. `BACKUP_SECRET_KEY` minimal 32 karakter wajib tersedia; tanpa itu export/import mengembalikan 503. Contohnya tercatat di [.env.example](../.env.example).

### SEC-13: gambar ekspor hanya dibaca dari bucket aplikasi

Ekspor tidak lagi menjalankan `fetch(url)` terhadap URL yang tersimpan di HTML. URL harus dapat dipetakan menjadi object key pada bucket R2 yang dikonfigurasi; objek lalu dibaca langsung melalui API S3/R2. URL loopback, alamat privat, domain eksternal, bucket R2 lain, dan redirect HTTP tidak pernah diminta oleh server. Maksimum 500 gambar, 10 MB per objek, dan 100 MB total gambar diterapkan sebelum ZIP dibuat.

**Lokasi:** [export route](../apps/web/app/api/backup/export/route.ts), [storage.ts](../apps/web/lib/storage.ts). Gambar eksternal yang tidak dikelola aplikasi tetap sebagai tautan di manifest dan tidak dimasukkan sebagai berkas backup.

### BUG-04: manifest divalidasi penuh dan restore database memakai transaksi

Sebelum write pertama, service memeriksa versi, bentuk setiap bagian, batas 500.000 baris, ID duplikat, serta referensi pengguna, kelas, bank, soal, ujian, attempt, periode PAS, sesi, dan ruang. Manifest cacat berhenti sebelum wipe.

Wipe, pemulihan profil/keanggotaan, dan seluruh insert data organisasi berjalan dalam satu transaksi database. Setiap hasil delete/insert diperiksa; kegagalan di tengah restore me-roll back ke data awal. Pembuatan akun auth diselesaikan sebelum transaksi agar hashing banyak password tidak menghabiskan timeout transaksi. Akun auth baru dilunakkan kembali jika transaksi organisasi gagal.

**Batas:** akun auth berada di schema/lapis terpisah sehingga kompensasinya berupa soft-delete, bukan rollback transaksi yang sama. Round-trip database staging dengan FK deployment tetap wajib sebelum rollout produksi.

### BUG-05: manifest versi 2 mencakup relasi fitur aktif

Ekspor versi 2 menambahkan kelas tambahan dan anggotanya; petunjuk, kisi-kisi, dimensi dan interpretasi; target kelas, peserta individual dan sumber bank ujian; snapshot soal attempt dan log keamanan; periode, sesi, jadwal, ruang, pengawas dan peserta PAS; serta label organisasi. Semua peran anggota dipertahankan, bukan hanya peran pertama. Referensi `created_by`, `updated_by`, guru, dan proktor dipetakan ke UUID lingkungan tujuan.

Error baca tabel kini menggagalkan ekspor dan tidak lagi diubah menjadi array kosong. Restore lama versi 1 tetap diterima bila bagian inti lengkap; bagian baru yang memang tidak ada diperlakukan kosong. UI tidak lagi mengklaim sukses untuk arsip parsial akibat query gagal.

**Pengujian tahap 5:** signature arsip bergambar dan manipulasi manifest, batas jumlah entry ZIP, urutan otorisasi sebelum parsing, larangan `fetch(url)`, validasi referensi sebelum wipe, rollback kegagalan insert, ekspor fail-closed, serta pemeriksaan izin ringan tanpa write.

## Tahap 6 — Keandalan UI, aksesibilitas, dan ketepatan informasi

### BUG-14: seluruh hook komponen selalu dipanggil dalam urutan yang sama

State URL tugas pada `ExamViewer` dipindahkan sebelum keadaan kosong yang mengembalikan UI lebih awal. `QuestionForms` tidak lagi mengembalikan `null` sebelum deklarasi callback; tipe yang belum dikenali jatuh ke tampilan fallback pada akhir pemilih form. Perubahan ini mencegah error urutan hook ketika data atau tipe soal berubah antar-render.

**Lokasi:** [ExamViewer.tsx](../apps/web/app/components/questions/ExamViewer.tsx), [QuestionForms.tsx](../apps/web/app/components/questions/forms/QuestionForms.tsx). **Pengujian:** pemeriksaan struktur memastikan semua `useEffect` dan state tugas berada sebelum early return; TypeScript web lulus.

### UX-02 dan UX-03: kegagalan data dan autentikasi mempunyai jalan pemulihan

Klien jadwal, hasil, dan notifikasi kini menyediakan hasil sukses/gagal yang eksplisit. Halaman tidak lagi mengubah error API menjadi daftar kosong yang terlihat seperti “belum ada data”; pengguna melihat pesan kegagalan dan tombol coba lagi. Helper lama yang mengembalikan array tetap tersedia untuk pemanggil lain agar perubahan tidak memutus jalur yang belum dimigrasikan.

Dashboard mempunyai batas waktu pemeriksaan sesi dan keadaan error tersendiri. Sesi hilang, resolusi peran gagal, atau pemeriksaan yang terlalu lama akan menampilkan pilihan coba lagi/login, bukan spinner tanpa akhir. Timer dibersihkan setelah resolusi berhasil maupun gagal.

**Lokasi:** [students API](../apps/web/lib/api/students.ts), [notifications API](../apps/web/lib/api/notifications.ts), [jadwal siswa](../apps/web/app/dashboard/siswa/schedule/page.tsx), [hasil siswa](../apps/web/app/dashboard/siswa/results/page.tsx), [notifikasi](../apps/web/app/dashboard/notifications/page.tsx), [dashboard layout](../apps/web/app/dashboard/layout.tsx).

### UX-05: esai tidak masuk hitungan benar/salah objektif

Ringkasan detail attempt admin, guru, dan proktor memakai satu helper. `correct` dan `wrong` hanya menghitung soal non-esai dengan flag boolean yang tegas; esai/uraian selalu masuk kolom esai walaupun sudah diberi nilai. Rumus lama dapat menghasilkan hitungan salah negatif karena jawaban esai bernilai benar ikut masuk `correct` lalu dikurangi lagi.

**Lokasi:** [answer-stats.ts](../apps/web/lib/answer-stats.ts) dan tiga halaman detail monitoring. **Tes:** campuran objektif benar/salah serta esai bernilai dan belum dinilai menghasilkan total 4, benar 1, salah 1, esai 2.

### UX-06: jadwal dan hasil memakai satu zona waktu sekolah

Formatter bersama memakai `Asia/Jakarta` dan label `WIB` untuk tanggal, waktu, dan rentang jadwal. Timestamp tanpa suffix diperlakukan sebagai UTC sesuai kontrak data lama. Pembentukan output memakai `formatToParts`, sehingga tanda baca locale tidak mengubah bentuk jam yang ditampilkan.

**Lokasi:** [school-time.ts](../apps/web/lib/school-time.ts), halaman jadwal dan hasil siswa. **Tes:** instant `2026-09-19T18:30:00Z` ditampilkan sebagai `20 Sep 2026 01:30 WIB`, termasuk rentang yang melintasi pergantian hari UTC.

### UX-07: kartu hasil dan toggle dapat dioperasikan dengan keyboard

Kartu hasil siswa kini elemen `button` semantik dengan fokus terlihat, label aksesibel, dan status disabled ketika detail belum boleh dibuka. Seluruh toggle preferensi notifikasi mempunyai `type="button"`, `role="switch"`, `aria-checked`, dan label yang menjelaskan pengaturan. Perilaku klik dan tampilan yang ada dipertahankan.

### UX-08: respons monitoring lama tidak menimpa pilihan baru

Setiap pemuatan detail ujian proktor membawa nomor generasi. Hanya respons dari permintaan terbaru yang boleh mengganti attempt, analisis, dan spinner. Mengganti pilihan juga langsung membatalkan generasi sebelumnya secara logis, sehingga respons jaringan yang datang terbalik tidak memunculkan data ujian lama.

**Lokasi:** [monitoring proktor](../apps/web/app/dashboard/proktor/monitoring/page.tsx). Pola generasi yang sama dipakai pada pemuatan notifikasi saat filter berubah.

### UX-09: hasil pembuatan jadwal parsial terlihat dan dapat dicoba ulang

Halaman PAS admin dan proktor menampilkan jumlah ujian yang berhasil serta setiap ID/alasan jadwal yang dilewati. Setelah respons parsial, hanya ID yang gagal yang tetap terpilih; operator dapat memperbaiki penyebab lalu mencoba ulang tanpa membuat ulang jadwal yang sudah berhasil.

### UX-10: notifikasi lama dapat dimuat bertahap

Endpoint notifikasi menerima `offset`, `limit`, filter tipe, dan filter belum dibaca dengan batas maksimum 100 item. Query yang gagal kini menghasilkan error server, bukan array kosong. UI memuat 50 item per halaman, menjalankan filter di server, menyediakan tombol “Muat Lebih Banyak”, dan mengabaikan respons filter lama. Penghapusan atau penandaan baca memuat ulang halaman pertama agar daftar konsisten.

**Batas:** pagination masih berbasis offset. Pada arus notifikasi yang sangat tinggi, cursor `created_at + id` akan lebih stabil terhadap insert baru di antara dua permintaan.

### UX-11: ekspor analitik mempertahankan jawaban kompleks

Sheet detail jawaban memakai formatter yang sama dengan layar review. Pilihan tunggal menjadi label opsi; pilihan ganda menjadi beberapa baris; benar/salah, matching, kategori, urutan, isian, dan jawaban esai terstruktur diubah menjadi teks yang dapat dibaca. Ekspor tidak lagi menampilkan `-` hanya karena jawabannya berada di `essay_answer` sebagai JSON.

**Lokasi:** [analitik ujian guru](../apps/web/app/dashboard/guru/analytics/exam/[id]/page.tsx), [answer-display.ts](../apps/web/lib/answer-display.ts). **Tes:** pilihan ganda kompleks dan objek benar/salah menghasilkan seluruh pilihan/nilai yang tersimpan.

### UX-12: tren membandingkan kelompok historis yang valid

Nilai kronologis dibagi menjadi kelompok lama dan baru yang keduanya tidak kosong. Dua nilai `90 → 60` kini menghasilkan turun dan `60 → 90` menghasilkan naik; satu nilai atau perubahan paling banyak lima poin tetap stabil. Jumlah nilai ganjil diuji agar tidak kembali membagi dengan kelompok kosong.

**Lokasi:** [student-analytics.service.ts](../apps/api/src/analytics/student-analytics.service.ts).

## Tahap 7 — Baseline lint yang mencegah regresi baru

### QA-01: utang lint lama dibedakan dari pelanggaran baru

Pemindaian penuh frontend saat ini menghasilkan 1.214 error dan 640 warning. Jumlah ini masih merupakan utang teknis dan tidak dinyatakan bersih. Baseline menyimpan jumlah aktual per aturan, termasuk `rules-of-hooks`, `immutability`, `refs`, `purity`, `set-state-in-effect`, `no-explicit-any`, dan aturan aksesibilitas. Pemeriksaan gagal bila jumlah aturan mana pun bertambah, jika muncul aturan baru, atau jika total error/warning naik. Penurunan pada tahap 12 sudah dikunci sebagai baseline baru.

Workflow deployment menjalankan pemeriksaan ini setelah typecheck frontend dan sebelum build/deploy. Dengan demikian, pelanggaran berisiko runtime tidak lagi tenggelam tanpa pagar hanya karena seluruh backlog belum dapat dibereskan dalam satu perubahan.

**Lokasi:** [check-web-lint-baseline.cjs](../tools/check-web-lint-baseline.cjs), [eslint-baseline.json](perbaikan-2026-09-19/eslint-baseline.json), [package.json](../package.json), [deploy.yml](../.github/workflows/deploy.yml).

**Verifikasi:** `npm run lint:web:baseline` lulus pada baseline 26 September 2026 dan menampilkan ringkasan jumlah. Opsi maintainer `node tools/check-web-lint-baseline.cjs --update` tersedia untuk memperketat baseline setelah perbaikan; perubahan baseline harus ikut direview agar kenaikan tidak diterima diam-diam.

## Tahap 8 — Urutan impor dan kepemilikan stimulus

### IMP-01: nomor soal hasil impor tidak deterministik dan referensi nomor tidak dinormalisasi

Soal hasil satu bulk import dapat berbagi timestamp. Backend sebelumnya menghapus `metadata.order_index`, sehingga UUID acak menjadi pemutus urutan dan susunan template berubah setelah disimpan. Backend kini menormalkan urutan soal lama di dalam transaksi dan memberi setiap soal impor `order_index` sesuai urutan hasil parser. Stimulus, petunjuk, dan kisi-kisi tetap melekat melalui ID masing-masing; nomor tampil tidak lagi berpindah secara acak.

Parser Word menyamakan `01`, `1.`, dan `Soal 1`, serta mendukung referensi `1,2`, `1;2`, `1 dan 2`, dan `1-3`. Parser Word dan Excel mengurutkan hasil berdasarkan nomor sumber bila tersedia. Excel tidak lagi memakai kolom `No` sebagai pengganti teks pertanyaan dan akan menolak file tanpa kolom soal.

Rincian penyebab, perubahan, cakupan tes, dan batas staging tersedia di [dokumentasi integritas impor](perbaikan-2026-09-19/IMPORT_SOAL_2026-09-26.md).

## Tahap 9 — Integritas soal dan jawaban historis

### BUG-11: pemeriksaan pemakaian mengikuti relasi jawaban aktual

Penghapusan soal kini memeriksa `cbt_answers`, yaitu tabel yang benar-benar ditulis saat siswa menjawab. Pemeriksaan tabel snapshot lama `cbt_exam_attempt_questions` tetap dipertahankan untuk data impor/legacy, tetapi bukan lagi satu-satunya bukti pemakaian. Jika ada jawaban, soal hanya ditandai `_deleted`; baris soal, opsi, dan jawaban tetap utuh untuk review, analitik, serta penilaian historis.

Perlindungan juga mencakup soal yang dilewati siswa. Begitu bank mempunyai attempt, komposisi bank dibekukan: soal tidak dapat ditambah, disunting, diimpor ulang, diubah metadatanya, atau disusun ulang. Kebijakan ini mencegah soal yang tidak dijawab tiba-tiba hilang dari penyebut nilai atau berganti nomor pada review. Operator diarahkan membuat bank baru untuk versi berikutnya.

Bank yang sudah direferensikan oleh ujian, baik melalui `question_bank_id` maupun `cbt_exam_question_sources`, tidak dapat dihapus. Dengan demikian cascade atau perilaku FK deployment tidak dapat menghapus bukti ujian secara tidak sengaja.

**Lokasi:** [questions.service.ts](../apps/api/src/questions/questions.service.ts), [question-banks.service.ts](../apps/api/src/questions/question-banks.service.ts), [imports.service.ts](../apps/api/src/imports/imports.service.ts). Rincian keputusan, skenario, dan batas verifikasi tersedia di [dokumentasi BUG-11](perbaikan-2026-09-19/BUG-11-INTEGRITAS-HISTORIS-SOAL.md).

## Tahap 10 — Satu sumber kebenaran soal ujian

### BUG-12: ujian legacy dan multi-bank dirender serta dinilai dari himpunan yang sama

Resolver bersama kini menggabungkan `cbt_exams.question_bank_id` dengan seluruh relasi `cbt_exam_question_sources`. Bank langsung ditempatkan pertama, sumber tambahan dideduplikasi dan diurutkan deterministik, lalu soal disusun menurut sumber, `metadata.order_index`, waktu pembuatan, dan ID. Penanda urutan internal tidak ikut dikirim ke browser, ekspor, atau layanan scoring.

Resolver tersebut dipakai oleh pengambilan soal siswa, submit, penutupan otomatis, regrade, review hasil, analisis monitoring, penilaian esai guru, analitik ujian, dan ekspor. Komponen ujian di browser selalu meminta soal kepada backend dan tidak lagi menolak ujian hanya karena `question_bank_id` langsung kosong.

Tes regresi membuktikan bahwa ujian legacy dengan dua bank menampilkan dan menilai dua soal yang identik, relasi duplikat tidak menggandakan bank, gabungan bank langsung dan sumber legacy mempunyai urutan stabil, serta frontend tidak lagi memakai `question_bank_id` sebagai gerbang pemuatan.

**Lokasi:** [exam-question-sources.ts](../apps/api/src/common/exam-question-sources.ts), [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts), [grading.service.ts](../apps/api/src/grading/grading.service.ts), [exam-review.service.ts](../apps/api/src/analytics/exam-review.service.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx). Rincian lengkap tersedia di [dokumentasi BUG-12](perbaikan-2026-09-19/BUG-12-SUMBER-SOAL-UJIAN.md).

## Tahap 11 — Integrasi lintas layanan dan gate regresi

### QA-02: kasus P1 terhubung ke tes yang dijalankan CI

Skenario integrasi baru menjalankan service nyata pada satu state database fixture: peserta memulai ujian legacy, menerima soal tanpa kunci, pengguna lain ditolak saat mencoba menyimpan jawaban, pemilik melakukan autosave dan submit, hasil dinilai, review dibuka, lalu soal historis dihapus secara lunak tanpa mengubah nilai atau menghilangkan opsi/jawaban.

Tes kontrak HTTP membuka aplikasi Nest lokal dan memanggil endpoint submit melalui HTTP. Guard memasang identitas terautentikasi, `ValidationPipe` menolak DTO tidak sah, field identitas palsu dibuang, serta controller meneruskan pengguna hasil guard—bukan ID dari body—ke service. Tes tambahan menjaga BUG-09 dan memastikan setiap temuan P1 dalam audit mempunyai skenario serta berkas regresi yang masih ada.

Pada akhir tahap 11, `npm run test:audit` menjalankan 102 tes Node, 44 pemeriksaan round-trip parser/ekspor, dan 13 pemeriksaan service. Workflow deployment menjalankan gate ini sebelum kompilasi dan deployment. Matriks [cakupan P1](perbaikan-2026-09-19/p1-test-coverage.json) mengikat 23 temuan P1 ke bukti tesnya.

**Lokasi:** [workflow-integration-stage11.test.cjs](../apps/api/test/workflow-integration-stage11.test.cjs), [package.json](../package.json), [deploy.yml](../.github/workflows/deploy.yml). Rincian cakupan dan batas lingkungan tersedia di [dokumentasi QA-02](perbaikan-2026-09-19/QA-02-INTEGRASI-LINTAS-LAYANAN.md).

## Tahap 12 — Paritas halaman bank soal lintas peran

### QA-03: satu implementasi UI untuk admin, guru, dan proktor

Tiga halaman detail bank soal sebelumnya menyalin sekitar 1.088 baris implementasi yang sama. Perbaikan pada impor, stimulus, editor, ekspor, dan pratinjau harus diterapkan tiga kali sehingga satu peran mudah tertinggal. Halaman admin juga memakai kunci memori berawalan `proktor`, dan ketiga salinan menyimpan fungsi template DOCX mati yang menunjuk berkas publik yang tidak ada.

Seluruh perilaku detail bank soal kini berada di `QuestionBankDetailPage`. Route admin, guru, dan proktor masing-masing hanya meneruskan identitas route untuk membentuk URL navigasi serta namespace cache yang terpisah. Nilai peran tidak dipakai sebagai izin: setiap baca/tulis tetap melalui endpoint yang dilindungi `JwtAuthGuard`, `RolesGuard`, dan pemeriksaan `AuthorizationService.assertBankAccess` pada backend.

Empat tes regresi menjaga agar ketiga route terus memakai komponen yang sama, namespace cache dan URL mengikuti route aktif, kode template mati tidak kembali, dan guard/pemeriksaan kepemilikan backend tetap ada. Konsolidasi mengurangi implementasi route dari 3 × 1.088 baris menjadi satu komponen 1.087 baris dan tiga pembungkus 5 baris. Penghapusan salinan juga menurunkan baseline lint dari 1.338 error/709 warning menjadi 1.214 error/640 warning.

**Lokasi:** [QuestionBankDetailPage.tsx](../apps/web/app/components/questions/QuestionBankDetailPage.tsx), route [admin](../apps/web/app/dashboard/admin/questions/[bankId]/page.tsx), [guru](../apps/web/app/dashboard/guru/questions/[bankId]/page.tsx), dan [proktor](../apps/web/app/dashboard/proktor/questions/[bankId]/page.tsx), serta [role-page-parity-stage12.test.cjs](../apps/api/test/role-page-parity-stage12.test.cjs). Rincian keputusan dan batas cakupan tersedia di [dokumentasi QA-03](perbaikan-2026-09-19/QA-03-HALAMAN-BERSAMA.md).

## Tahap 13 — Ketahanan autosave dan auto-submit

### ANS-01, ANS-02, dan ANS-08: request dapat dibatalkan, retry berkelanjutan, snapshot terbaru

Autosave tunggal kini mempunyai timeout 15 detik, sedangkan bulk sync dan submit mempunyai timeout 30 detik. Timeout memakai `AbortController`, sehingga fetch lama benar-benar dibatalkan sebelum antrean soal melanjutkan pekerjaan berikutnya. Kegagalan tetap ditandai untuk bulk retry.

Auto-submit tidak lagi berhenti setelah tiga percobaan. Retry memakai jeda 10 detik, 20 detik, lalu maksimum 30 detik sampai server mengonfirmasi status final. Guard ref memastikan hanya satu submit aktif dan satu timer retry terjadwal. Submit juga membaca `answersRef.current` tepat sebelum request sehingga jawaban terakhir tidak tertinggal ketika perubahan berimpit dengan timer nol atau pemulihan jaringan.

Empat tes baru menguji abort request menggantung, pemasangan timeout pada endpoint jawaban, backoff setelah percobaan ketiga, serta snapshot ref terbaru. **Lokasi:** [client.ts](../apps/web/lib/api/client.ts), [students.ts](../apps/web/lib/api/students.ts), [exam-retry.ts](../apps/web/lib/exam-retry.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx), dan [answer-resilience-stage13.test.cjs](../apps/api/test/answer-resilience-stage13.test.cjs). Rincian risiko yang masih terbuka tersedia di [audit perekaman jawaban](perbaikan-2026-09-19/AUDIT-PEREKAMAN-JAWABAN-DAN-JARINGAN.md).

## Tahap 14 — Integritas target autosave

### ANS-04: soal dan opsi harus berasal dari ujian aktif

Sebelum upsert, backend kini memvalidasi seluruh jawaban terhadap resolver sumber soal ujian yang juga dipakai oleh tampilan, submit, dan grading. Query hanya memuat ID soal yang dikirim, bukan seluruh bank. Soal harus berasal dari bank langsung atau salah satu sumber multi-bank ujian. Untuk tipe pilihan tunggal, opsi harus menjadi anak dari soal tersebut. Jawaban teks dan pilihan tunggal tidak boleh dicampur atau digunakan pada tipe soal yang salah.

Validasi dilakukan setelah pemeriksaan pemilik/perangkat/deadline dan sebelum penulisan, di dalam transaksi yang mengunci attempt. Bulk sync bersifat atomik: satu soal atau opsi asing membatalkan seluruh batch tanpa meninggalkan jawaban parsial. Lima tes baru mencakup soal asing, opsi silang, rollback batch, multi-bank sah, dan format kolom salah.

**Lokasi:** [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) dan [answer-integrity-stage14.test.cjs](../apps/api/test/answer-integrity-stage14.test.cjs).

## Tahap 15 — Satu attempt aktif per siswa dan ujian

### ANS-05: start bersamaan menjadi idempoten

Keputusan “lanjutkan atau buat attempt” kini diperiksa ulang di dalam transaksi. Transaksi mengambil advisory lock dengan kunci stabil dari `examId:userId`, lalu mencari attempt aktif dan attempt final sekali lagi sebelum melakukan insert. Dua tab dari perangkat yang sama menerima ID attempt yang sama. Jika perangkat berbeda kalah dalam race, ia diarahkan ke attempt pemenang dan ditolak oleh kunci perangkat yang sudah ada, sehingga tidak terbentuk baris pengerjaan kedua.

Migrasi menambahkan unique index parsial `(exam_id, user_id)` untuk status `in_progress` sebagai perlindungan database. Migrasi sengaja berhenti bila menemukan duplikat aktif lama. Data tersebut tidak boleh dihapus otomatis karena setiap attempt dapat membawa kumpulan jawaban berbeda; operator harus meninjau jawaban dan menentukan attempt yang sah lebih dahulu.

Tiga tes baru menjalankan start bersamaan dari perangkat yang sama, start bersamaan dari dua perangkat, serta memeriksa pengaman migrasi dan index parsial. **Lokasi:** [exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts), [migrasi ANS-05](../database/migrations/20260926_01_unique_active_exam_attempt.sql), dan [attempt-start-stage15.test.cjs](../apps/api/test/attempt-start-stage15.test.cjs).

## Tahap 16 — Pemulihan jawaban offline setelah deadline

### ANS-03: reset proktor mempunyai alasan, audit atomik, dan ringkasan sinkronisasi

Reset attempt kini mewajibkan alasan 5–500 karakter. Backend memeriksa kewenangan staf, mengunci baris attempt, memakai jam database, menghitung jawaban server, membuka grace period 15 menit bila deadline telah lewat, dan menulis event audit dalam satu transaksi. Audit menyimpan aktor, alasan, waktu reset, status/deadline sebelumnya, tenggat pemulihan, dan jumlah jawaban server. Jika update atau log gagal, seluruh reset dibatalkan.

Semua layar monitoring meminta alasan dan menampilkan jumlah jawaban server serta tenggat yang diberikan. Saat siswa membuka kembali attempt pada browser yang sama, banner menampilkan jumlah jawaban lokal dan server. Snapshot lokal dikirim ulang melalui endpoint bulk yang tetap memeriksa pemilik, perangkat, soal/opsi, status, dan deadline. Pada layar kedaluwarsa, siswa diberi tahu jumlah jawaban lokal serta diminta tidak menghapus data browser atau berpindah perangkat.

Empat tes baru mencakup audit dan deadline berbasis jam database, penolakan alasan kosong, rollback saat log audit gagal, serta kontrak indikator lokal/server. **Lokasi:** [proctoring.service.ts](../apps/api/src/proctoring/proctoring.service.ts), [proctoring.controller.ts](../apps/api/src/proctoring/proctoring.controller.ts), [proctoring.ts](../apps/web/lib/api/proctoring.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx), [offline-recovery-stage16.test.cjs](../apps/api/test/offline-recovery-stage16.test.cjs), dan [SOP pemulihan offline](perbaikan-2026-09-19/SOP-PEMULIHAN-JAWABAN-OFFLINE.md).

## Tahap 17 — Penyimpanan jawaban offline durable

### ANS-06: IndexedDB utama, fallback kompatibel, dan preflight sebelum start

Snapshot jawaban serta tanda ragu kini ditulis ke IndexedDB dan dicerminkan ke `localStorage` sebagai fallback. Write untuk satu attempt diserialisasi agar transaksi lambat tidak menimpa perubahan terbaru. Cache legacy dimigrasikan saat dibaca, sinkronisasi setelah jaringan pulih membaca snapshot durable, dan cleanup setelah submit diurutkan setelah seluruh write yang masih berjalan.

Sebelum attempt dibuat, halaman menguji tulis/hapus nyata, meminta persistence browser, dan memeriksa kapasitas. Browser tanpa IndexedDB masih dapat memakai fallback dengan peringatan. Jika seluruh storage ditolak, ujian tidak dimulai. ID perangkat acak juga disimpan di IndexedDB sehingga reload tetap memakai perangkat yang sama ketika `localStorage` diblokir.

Empat tes baru mencakup urutan write cepat, fallback `localStorage`, penolakan start tanpa storage, serta kontrak preflight/restore/write/cleanup/migrasi/persistence perangkat. **Lokasi:** [exam-durable-storage.ts](../apps/web/lib/exam-durable-storage.ts), [device-id.ts](../apps/web/lib/device-id.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx), [offline-storage-stage17.test.cjs](../apps/api/test/offline-storage-stage17.test.cjs), dan [dokumentasi penyimpanan durable](perbaikan-2026-09-19/PENYIMPANAN-JAWABAN-OFFLINE-DURABLE.md).

## Tahap 18 — Pengawasan offline dan status koneksi peserta

### ANS-07: event durable, retry idempoten, heartbeat, dan terminasi terkonfirmasi

Event keamanan disimpan di IndexedDB sebelum dikirim dan dicerminkan ke `localStorage`. UUID event tetap sama selama retry, sedangkan unique expression index database mencegah hitungan ganda. Heartbeat siswa diverifikasi terhadap pengguna, status attempt, dan perangkat; monitoring menandai attempt aktif sebagai terputus setelah 45 detik tanpa heartbeat.

Saat batas pelanggaran tercapai, halaman masuk keadaan blokir dan mencoba mengirim jawaban tertunda serta terminasi. Sesi CBT baru dibersihkan setelah respons sukses server. Kegagalan jaringan mempertahankan layar blokir dan retry otomatis. Lima tes baru mencakup deduplikasi, heartbeat, antrean, konfirmasi terminasi, empat UI peran, dan migrasi. **Lokasi:** [proctoring.service.ts](../apps/api/src/proctoring/proctoring.service.ts), [ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx), [migrasi ANS-07](../database/migrations/20260926_02_offline_proctoring.sql), [offline-proctoring-stage18.test.cjs](../apps/api/test/offline-proctoring-stage18.test.cjs), dan [dokumentasi pengawasan offline](perbaikan-2026-09-19/PENGAWASAN-OFFLINE-DAN-HEARTBEAT.md).

## Tahap 19 — Race lifecycle dan paket validasi staging

### LIF-01–03: grading lama tidak masuk setelah reset dan validator mencakup migrasi terbaru

Auto-finish dan terminasi kini hanya menulis hasil grading selama attempt tetap `auto_submitted`. Reset membersihkan nilai dan metadata skor lama. Status terminasi serta log audit ditulis atomik sebelum grading, sehingga reset tidak dapat mendahului log terminasi. Finalisasi kedaluwarsa dari monitoring melakukan compare-and-set status sebelum memanggil layanan scoring; kegagalan scoring tidak lagi membiarkan attempt kedaluwarsa terlihat aktif.

Validator migrasi mencakup migrasi sampai tahap 18 dan memeriksa kolom/index hasilnya. Skrip audit database read-only mendeteksi duplikat attempt/jawaban/event, relasi jawaban yatim, schema yang belum terpasang, serta attempt dengan state tidak lengkap. Empat tes baru mencakup dua race reset/grading, urutan finalisasi monitoring, dan kontrak validator. **Lokasi:** [exam-lifecycle-stage19.test.cjs](../apps/api/test/exam-lifecycle-stage19.test.cjs), [audit database read-only](../tools/audit-exam-lifecycle-db.js), [validator migrasi](../tools/validate-migrations.js), dan [panduan staging tahap 19](perbaikan-2026-09-19/TAHAP-19-VALIDASI-LIFECYCLE-DAN-STAGING.md).

## Tahap 20 — Penguncian aplikasi ke satu sekolah

### SCHOOL-01–06: satu identitas sekolah, tanpa cakupan `all`

Kolom `organization_id` dipertahankan sebagai foreign key internal, tetapi kemampuan multi-sekolah dihapus. Sesi kini membawa satu `organizationId`; konteks semu `platform-admin`, cabang `organizationId=all`, dan pemilihan organisasi aktif pertama dihapus. Admin platform tetap harus memakai ID sekolah instalasi yang sama. Sinkronisasi SSO memakai sumber identitas sekolah tunggal dan gagal tertutup bila database berisi lebih dari satu sekolah.

Migrasi menambahkan unique expression index agar `cbt_organizations` hanya dapat memiliki paling banyak satu baris. Migrasi sengaja berhenti bila menemukan data lama lebih dari satu sekolah dan tidak menghapus data otomatis. Enam tes baru menjaga penolakan ID asing, bootstrap satu sekolah, kontrak sesi tunggal, migrasi, dan penghapusan jalur `all`. **Lokasi:** [SingleSchoolService](../apps/api/src/auth/single-school.service.ts), [migrasi single-school](../database/migrations/20260926_03_single_school.sql), [single-school-stage20.test.cjs](../apps/api/test/single-school-stage20.test.cjs), dan [dokumentasi tahap 20](perbaikan-2026-09-19/TAHAP-20-SINGLE-SCHOOL.md).

## Tahap 21 — Backup/restore satu sekolah

### SCHOOL-07–08: sekolah tujuan ditentukan server dan identitas arsip divalidasi

Export, import, dan pemeriksaan izin backup tidak lagi menerima ID sekolah dari browser. `BackupService` mengambil sekolah langsung dari sumber identitas instalasi. Semua `organization_id` yang ditemukan pada arsip—termasuk pada baris anak—dipetakan ke sekolah lokal sebelum insert. Metadata sekolah asal tetap tersedia sebagai informasi dan tidak menentukan tujuan restore.

Validasi arsip kini memeriksa `original_user_id` dan email pengguna yang duplikat sebelum akun dibuat atau data lama dihapus. Dua tes tambahan menjaga pemetaan sekolah dan penolakan identitas duplikat. **Lokasi:** [BackupService](../apps/api/src/backup/backup.service.ts), [backup-integrity-stage5.test.cjs](../apps/api/test/backup-integrity-stage5.test.cjs), dan [dokumentasi tahap 21](perbaikan-2026-09-19/TAHAP-21-BACKUP-SINGLE-SCHOOL.md).

## Tahap 22 — Konteks sekolah hanya dari sesi

### SCHOOL-09: browser tidak lagi memilih sekolah pada endpoint operasional

Sisa parameter `organizationId` di analitik, kelas guru, bank soal, PAS/PAT, konfigurasi ujian, dan dasbor proktor telah dihapus dari query, body, fungsi API browser, serta proxy Next.js. Controller mengambil ID sekolah melalui `CurrentSchoolId` dari pengguna yang telah diverifikasi JWT, lalu memasukkannya ke service secara internal. DTO publik tidak lagi mempunyai properti pemilih sekolah.

Kontrak sesi sekarang mewajibkan satu `organizationId`; permintaan gagal tertutup bila konteks sekolah tidak tersedia. Empat tes baru menjaga kontrak controller, DTO, frontend/proxy, dan sesi. **Lokasi:** [CurrentSchoolId](../apps/api/src/common/decorators/current-school-id.decorator.ts), [single-school-transport-stage22.test.cjs](../apps/api/test/single-school-transport-stage22.test.cjs), dan [dokumentasi tahap 22](perbaikan-2026-09-19/TAHAP-22-KONTEKS-SEKOLAH-DARI-SESI.md).

Typecheck akhir juga menemukan pemeriksaan `isOpen` lama di isi modal Audio, Grafik, dan Video setelah tanggung jawab itu dipindahkan ke wrapper. Tiga referensi yang tidak terdefinisi dihapus; wrapper tetap mencegah isi modal dirender saat tertutup.

## Tahap 23 — Satu sumber peran dashboard

### SCHOOL-ROLE-01–04: hilangkan konteks peran per sekolah yang redundan

Endpoint `/auth/role-contexts` menghitung peran untuk kedua kalinya dengan aturan yang lebih sempit daripada `/auth/me`. Peran dari metadata SSO atau riwayat attempt dapat hilang pada hasil kedua dan membuat layout menolak akun yang sebenarnya sah. Endpoint, proxy, dan fungsi klien tersebut dihapus. Layout kini membentuk konteks peran langsung dari `user.resolved`, sehingga autentikasi dan navigasi memakai satu hasil yang sama.

Tipe konteks UI sekarang hanya membawa `role`. `orgId`, `orgName`, properti pemilih organisasi Sidebar yang tidak digunakan, serta prop `orgId` mati pada komponen bank soal dan PAS telah dihapus. Empat tes baru menjaga kontrak ini. **Lokasi:** [rbac.ts](../apps/web/lib/rbac.ts), [dashboard layout](../apps/web/app/dashboard/layout.tsx), [single-school-role-context-stage23.test.cjs](../apps/api/test/single-school-role-context-stage23.test.cjs), dan [dokumentasi tahap 23](perbaikan-2026-09-19/TAHAP-23-SATU-SUMBER-PERAN.md).

## Tahap 24 — Profil sekolah operasional dari sesi

### SCHOOL-PROFILE-01–04: halaman tidak bergantung pada endpoint profil kedua

Halaman staf sebelumnya meminta organisasi lebih dulu dan hanya memuat data utama bila permintaan itu berhasil. Endpoint Guru bahkan mencari keanggotaan lagi, sehingga peran sah dari metadata SSO dapat memperoleh `null`. Nama sekolah kini ikut dalam `AuthUser` hasil resolver sekolah tunggal. Helper frontend membaca ID dan nama dari cache `/auth/me`; endpoint organisasi Proktor/Guru, proxy, dan query service redundan dihapus.

Dengan perubahan ini, bank soal, ujian, kelas, monitoring, penilaian, analitik, dan PAS tidak lagi mempunyai titik gagal tambahan hanya untuk mendapatkan nama sekolah. Empat tes baru menjaga kontrak sesi dan memastikan endpoint lama tidak kembali. **Lokasi:** [kontrak AuthUser](../packages/shared/src/api.ts), [single-school-session-profile-stage24.test.cjs](../apps/api/test/single-school-session-profile-stage24.test.cjs), dan [dokumentasi tahap 24](perbaikan-2026-09-19/TAHAP-24-PROFIL-SEKOLAH-DARI-SESI.md).

## Tahap 25 — Timeout permintaan baca

### NET-01–06: GET dan pemeriksaan sesi tidak menggantung tanpa batas

Semua `apiGet()` kini dibatalkan setelah 15 detik secara default, dengan opsi override untuk pembacaan berat. Pemeriksaan `/auth/me` mempunyai timeout 10 detik dan memakai identitas cache terakhir pada gangguan jaringan; respons penolakan HTTP tetap menghapus sesi dari sudut pandang UI. Pesan timeout dibuat umum agar tidak menyebut jawaban pada halaman dashboard.

Timeout global pada tahap ini hanya diterapkan pada GET yang aman diulang. Mutasi pembuatan utama kemudian memperoleh timeout dan idempotency key pada tahap 26. Enam tes baru menjaga perilaku abort, default, override, pesan, serta fallback sesi. **Lokasi:** [HTTP client](../apps/web/lib/api/client.ts), [session client](../apps/web/lib/session.ts), [read-timeout-stage25.test.cjs](../apps/api/test/read-timeout-stage25.test.cjs), dan [dokumentasi tahap 25](perbaikan-2026-09-19/TAHAP-25-TIMEOUT-PERMINTAAN-BACA.md).

## Tahap 26 — Idempotensi pembuatan data

### IDM-01–06: retry setelah respons hilang tidak menggandakan data

Pembuatan ujian, kelas reguler/tambahan, impor kelas, periode PAS/PAT, konfigurasi ujian, dan bank soal kini memakai `apiCreate()` dengan timeout 20 detik; impor kelas memakai 60 detik. Browser menyimpan UUID request berdasarkan endpoint dan payload di `sessionStorage`; hasil ambigu mempertahankan kunci untuk retry, sedangkan sukses atau kegagalan pasti membersihkannya. Impor menurunkan UUID stabil per baris sehingga batch parsial dapat dilanjutkan tanpa membuat ulang baris yang sudah berhasil.

Server menghitung hash payload dan menyimpan kunci/hash bersama baris baru. Indeks unik parsial per sekolah menutup race dua request paralel. Retry identik menerima ID lama, sedangkan penggunaan kunci yang sama untuk isi berbeda ditolak. Adapter database kini mempertahankan kode PostgreSQL dari metadata Prisma agar konflik `23505` dapat ditangani secara khusus.

Enam tes baru mencakup retry jaringan, perubahan payload, deduplikasi server, penolakan hash berbeda, indeks keenam tabel, dan pemakaian helper pada seluruh aksi utama. Migrasi baru lulus dry run serta pengulangan DDL di dalam transaksi rollback. **Lokasi:** [helper browser](../apps/web/lib/api/client.ts), [helper server](../apps/api/src/common/idempotent-create.ts), [migrasi tahap 26](../database/migrations/20260927_01_idempotent_creates.sql), [idempotent-create-stage26.test.cjs](../apps/api/test/idempotent-create-stage26.test.cjs), dan [dokumentasi tahap 26](perbaikan-2026-09-19/TAHAP-26-IDEMPOTENSI-PEMBUATAN-DATA.md).

## Tahap 27 — Idempotensi data turunan

### IDM-07–11: parent scope dan indeks atomik untuk jadwal

Tahun ajaran, folder/label bank, sesi/ruang/jadwal PAS, serta bank/jadwal konfigurasi ujian kini memakai `apiCreate()` dan UUID request wajib. Helper server dapat membatasi kunci menurut parent, sehingga retry pada periode atau konfigurasi yang sama mengembalikan ID lama tanpa menghalangi parent lain.

Pemeriksaan “sudah ada” yang rentan race diganti dengan indeks unik database untuk identitas jadwal PAS, bank konfigurasi, dan jadwal konfigurasi. Migrasi memeriksa duplikat lama lebih dulu dan berhenti tanpa menghapus data bila menemukannya. Lima tes baru menjaga parent scope, indeks request, indeks bisnis, kebijakan gagal tertutup, aksi browser, dan DTO.

**Lokasi:** [migrasi tahap 27](../database/migrations/20260927_02_idempotent_child_creates.sql), [idempotent-child-create-stage27.test.cjs](../apps/api/test/idempotent-child-create-stage27.test.cjs), dan [dokumentasi tahap 27](perbaikan-2026-09-19/TAHAP-27-IDEMPOTENSI-DATA-TURUNAN.md).

Migrasi tahap 26 dan 27 diterapkan permanen ke `acca_db` pada 27 September 2026 dalam satu transaksi. Verifikasi menggunakan koneksi baru menemukan seluruh 28 kolom idempotensi dan 17 indeks khusus kedua tahap tersebut.

## Tahap 28 — Integritas isi bank soal

### QID-01–07: retry soal–opsi, impor konten, dan konflik edit dua tab

Soal baru kini memakai mutasi `PUT` idempoten. UUID request dikunci di dalam transaksi; replay mengembalikan ID lama tanpa mengganti ID opsi, sedangkan pembuatan baru menyimpan soal dan seluruh opsi secara atomik. Kisi-kisi, stimulus, petunjuk, dimensi, interpretasi, serta impor stimulus/petunjuk memperoleh perlindungan request yang sama. Impor menurunkan UUID stabil per baris dan tetap atomik.

Kolom `revision` mencegah edit dua tab saling menimpa. Server mengunci soal, membandingkan revisi browser, menaikkan revisi saat berhasil, dan menolak versi lama dengan pesan untuk memuat ulang.

Migrasi tahap 28 telah diterapkan permanen. Tujuh tes menjaga retry, opsi, hash payload, impor, kontrak browser, transaksi, advisory lock, migrasi, dan konflik revisi. **Lokasi:** [migrasi idempotensi konten](../database/migrations/20260927_03_idempotent_question_content.sql), [migrasi revision](../database/migrations/20260927_04_question_revision.sql), [question-content-idempotency-stage28.test.cjs](../apps/api/test/question-content-idempotency-stage28.test.cjs), dan [dokumentasi tahap 28](perbaikan-2026-09-19/TAHAP-28-INTEGRITAS-ISI-BANK-SOAL.md).

## Tahap 29 — Integritas pembangkitan ujian massal

### GEN-01–07: transaksi sumber, retry aman, dan validasi relasi

Pembangkitan ujian dari jadwal PAS dan konfigurasi kini mengunci setiap sumber dengan advisory lock, lalu membuat ujian, target kelas, dan tautan jadwal dalam satu transaksi. UUID ujian diturunkan secara stabil dari ID jadwal dan memakai indeks idempotensi `cbt_exams` Tahap 26. Retry serta dua request bersamaan tidak membuat ujian atau target ganda; kegagalan target/tautan membatalkan seluruh perubahan untuk jadwal tersebut tanpa menghentikan jadwal lain dalam batch.

Server memvalidasi bahwa sesi, bank konfigurasi, bank soal, kelas, periode, dan konfigurasi mempunyai induk serta sekolah yang konsisten. Data lama diperiksa ulang saat generate. Jendela waktu kosong, terbalik, atau berdurasi nol ditolak. ID yang berulang dalam satu request diproses sekali, dan browser memakai timeout 120 detik untuk batch.

Tahap ini tidak membutuhkan migrasi baru karena memakai kolom dan indeks `cbt_exams` yang sudah diterapkan permanen pada Tahap 26. Tujuh tes baru menjaga retry, rollback, deduplikasi batch, lock, kunci stabil, relasi, waktu, dan timeout. **Lokasi:** [layanan jadwal PAS](../apps/api/src/pas/pas-schedules.service.ts), [layanan konfigurasi ujian](../apps/api/src/exam-configs/exam-configs.service.ts), [exam-generation-stage29.test.cjs](../apps/api/test/exam-generation-stage29.test.cjs), dan [dokumentasi tahap 29](perbaikan-2026-09-19/TAHAP-29-INTEGRITAS-PEMBANGKITAN-UJIAN.md).

## Tahap 30 — Integritas penugasan ruang PAS

### ROOM-01–09: rollback daftar, kapasitas, role, dan relasi periode

Penggantian pengawas dan pemindahan siswa kini memakai transaksi serta advisory lock. Kegagalan insert tidak lagi menghapus daftar pengawas atau penempatan siswa lama. Server menghapus ID ganda, memastikan ruang berasal dari periode yang dikirim, memvalidasi anggota aktif beserta perannya, dan menghitung kapasitas dari isi ruang terbaru. Lock per periode mencegah dua browser memakai sisa tempat yang sama.

UI Admin/Proktor menampilkan total, kapasitas, dan sisa tempat serta menghentikan pilihan berlebih sebelum request. Daftar pengawas juga mencakup Guru, Pengawas, Proktor, dan Admin yang sah.

Audit database nyata tidak menemukan data lama yang melanggar lima aturan ruang. Migrasi Tahap 30 menambahkan kapasitas wajib/positif dan foreign key gabungan ruang–periode. Migrasi telah diterapkan permanen dan diverifikasi melalui koneksi baru. **Lokasi:** [layanan ruang PAS](../apps/api/src/pas/pas-rooms.service.ts), [migrasi integritas ruang](../database/migrations/20260927_05_pas_room_integrity.sql), [pas-room-integrity-stage30.test.cjs](../apps/api/test/pas-room-integrity-stage30.test.cjs), dan [dokumentasi tahap 30](perbaikan-2026-09-19/TAHAP-30-INTEGRITAS-PENUGASAN-RUANG-PAS.md).

## Tahap 31 — Integritas penghapusan ujian

### DEL-01–13: perlindungan riwayat, transaksi delete, dan purge uji coba

Tombol hapus biasa tidak lagi menghapus attempt, jawaban, log keamanan, snapshot, atau sertifikat. Ujian yang sudah mempunyai riwayat ditolak. Baris ujian dikunci sebelum pemeriksaan agar attempt baru tidak masuk di sela pemeriksaan dan delete.

Penghapusan jadwal/periode PAS serta jadwal/bank/konfigurasi ujian sekarang memakai transaksi dan lock yang sama dengan generator. Ujian yang belum pernah dikerjakan dan sumbernya dihapus bersama-sama; kegagalan salah satu operasi mengembalikan seluruh perubahan. Audit database nyata menemukan nol ujian yatim dan nol sumber ganda.

Admin/Proktor memperoleh jalur khusus untuk membersihkan ujian uji coba yang sudah tidak dipublikasikan. Judul wajib diketik ulang persis dan purge menghapus seluruh hasil dalam satu transaksi. Guru tidak mempunyai hak purge permanen. **Lokasi:** [helper penghapusan](../apps/api/src/common/exam-deletion.ts), [layanan ujian](../apps/api/src/exams/exams.service.ts), [exam-deletion-stage31.test.cjs](../apps/api/test/exam-deletion-stage31.test.cjs), dan [dokumentasi tahap 31](perbaikan-2026-09-19/TAHAP-31-INTEGRITAS-PENGHAPUSAN-UJIAN.md).

## Tahap 32 — Jadwal siswa dengan banyak riwayat kelas

### SCHEDULE-01–03: parser filter kelas, status waktu, dan ringkasan galat

Pesan “Penugasan ujian belum dapat diperiksa” berasal dari parser adapter yang memecah koma di dalam daftar `in.(...)`. Siswa dengan beberapa riwayat kelas menghasilkan parameter UUID terpotong dan seluruh pembacaan jadwal gagal tertutup. Parser sekarang hanya memisahkan koma tingkat terluar, sehingga setiap ID kelas tetap utuh.

Kartu statistik menampilkan `—` saat data gagal dimuat. Kartu `Draft` yang tidak mungkin terisi bagi siswa diganti `Total Jadwal`. Ujian yang belum mencapai waktu mulai kini hanya berada pada kategori `Akan Datang`, bukan sekaligus `Tersedia`. Audit baca-saja memastikan schema produksi lengkap dan menemukan kondisi banyak kelas yang memicu bug; tidak ada data yang diubah dan tidak diperlukan migrasi. **Lokasi:** [adapter PostgreSQL](../apps/api/src/prisma/prisma-db-adapter.ts), [halaman jadwal siswa](../apps/web/app/dashboard/siswa/schedule/page.tsx), [student-schedule-stage32.test.cjs](../apps/api/test/student-schedule-stage32.test.cjs), dan [dokumentasi tahap 32](perbaikan-2026-09-19/TAHAP-32-JADWAL-SISWA-DAN-FILTER-KELAS.md).

## Tahap 33 — Integritas penugasan ujian

### ASSIGN-01–05: validasi sebelum delete, transaksi, dan lock ujian

Penggantian kelas/peserta sebelumnya menghapus penugasan lama sebelum memvalidasi target baru dan menjalankan delete/insert tanpa transaksi. Jalur ini sekarang mengunci ujian, memvalidasi sekolah dan tahun ajaran kelas, memvalidasi keanggotaan aktif peserta, menghapus ID ganda, lalu mengganti seluruh target dalam satu transaksi. Kegagalan mana pun mengembalikan target, peserta, dan status lama.

Audit baca-saja menemukan 144 keanggotaan historis, tetapi tidak menemukan target ujian pada kelas historis sehingga tidak diperlukan pembersihan data. **Lokasi:** [layanan penugasan ujian](../apps/api/src/proctor/exam-admin.service.ts), [exam-assignment-stage33.test.cjs](../apps/api/test/exam-assignment-stage33.test.cjs), dan [dokumentasi tahap 33](perbaikan-2026-09-19/TAHAP-33-INTEGRITAS-PENUGASAN-UJIAN.md).

## Tahap 34 — Pemulihan peserta terpilih per kelas

### RESTORE-01–05: kelas sumber disimpan, bukan ditebak dari riwayat

Mode siswa terpilih sebelumnya membuang ID kelas dan hanya menyimpan pengguna. Saat modal dibuka kembali, server mengambil keanggotaan kelas pertama tanpa urutan sehingga siswa dengan beberapa kelas dapat muncul pada kelas yang salah. Browser sekarang mengirim pasangan siswa–kelas dan database menyimpan sumber reguler atau tambahan dengan foreign key terpisah.

Server memvalidasi pasangan keanggotaan sebelum mengganti target. Migrasi Tahap 34 telah diterapkan permanen. Audit sebelum migrasi menemukan nol peserta legacy sehingga tidak diperlukan backfill ambigu. Tiga migrasi perlindungan lama yang belum terpasang juga diterapkan; audit akhir `acca_db` menghasilkan nol blocker dan nol warning. **Lokasi:** [layanan penugasan](../apps/api/src/proctor/exam-admin.service.ts), [migrasi sumber kelas](../database/migrations/20260927_06_exam_participant_class_source.sql), [exam-assignment-restore-stage34.test.cjs](../apps/api/test/exam-assignment-restore-stage34.test.cjs), dan [dokumentasi tahap 34](perbaikan-2026-09-19/TAHAP-34-PEMULIHAN-PESERTA-PER-KELAS.md).

## Tahap 35 — Sinkronisasi ujian hasil generate

### SYNC-01–09: sumber dan ujian siswa diperbarui atomik

Perubahan durasi atau mata pelajaran pada bank konfigurasi sebelumnya hanya mengubah sumber dan membiarkan `cbt_exams` memakai nilai lama. Nama dan tahun ajaran juga dapat berbeda dari deskripsi ujian hasil generate. Seluruh jalur perubahan sekarang memakai transaksi dan lock yang sama dengan generator, lalu menyelaraskan sumber dan ujian secara atomik.

Ujian yang sudah mempunyai attempt atau sertifikat tidak dapat diubah. Konfigurasi terkunci, mata pelajaran sekolah lain, rentang tanggal yang meninggalkan jadwal, jadwal di luar rentang, serta jam tutup yang tidak valid juga ditolak. Perubahan identik tetap menjadi no-op yang aman. Audit read-only pada `acca_db` menghasilkan nol perbedaan pada bank, mata pelajaran, durasi, waktu, target, metadata, maupun ujian ber-riwayat. Tahap ini tidak membutuhkan migrasi. **Lokasi:** [layanan konfigurasi](../apps/api/src/exam-configs/exam-configs.service.ts), [audit sinkronisasi](../tools/audit-generated-exam-sync.js), [generated-exam-sync-stage35.test.cjs](../apps/api/test/generated-exam-sync-stage35.test.cjs), dan [dokumentasi tahap 35](perbaikan-2026-09-19/TAHAP-35-SINKRONISASI-UJIAN-HASIL-GENERATE.md).

## Tahap 36 — Integritas sesi dan jadwal PAS

### SESSION-01–08: periode terkunci dan referensi sesi ditegakkan

Tambah/hapus sesi, tambah/hapus jadwal, generate, penguncian, dan penghapusan periode sekarang memakai lock periode yang sama. Periode terkunci menolak seluruh mutasi tersebut, dan generator tidak lagi membentuk ujian dari periode terkunci. Sesi yang masih dipakai jadwal tidak dapat dihapus.

Migrasi Tahap 36 mewajibkan periode, sesi, serta durasi pada jadwal; memvalidasi waktu; dan menambahkan foreign key gabungan sesi–periode dengan `ON DELETE RESTRICT`. Audit sebelum migrasi menemukan nol data yang perlu dibersihkan. Migrasi diterapkan permanen ke `acca_db`; audit setelahnya menghasilkan nol blocker dan nol warning. **Lokasi:** [layanan jadwal PAS](../apps/api/src/pas/pas-schedules.service.ts), [migrasi integritas sesi](../database/migrations/20260927_07_pas_session_integrity.sql), [pas-session-integrity-stage36.test.cjs](../apps/api/test/pas-session-integrity-stage36.test.cjs), dan [dokumentasi tahap 36](perbaikan-2026-09-19/TAHAP-36-INTEGRITAS-SESI-DAN-JADWAL-PAS.md).

## Hasil pengujian dan cara menjalankan

| Pemeriksaan | Hasil |
|---|---|
| Tahap 1 + 2, Node test runner | 68 lulus, 0 gagal |
| Tahap 3, Node test runner | 3 lulus, 0 gagal |
| Tahap 1–4, Node test runner | 78 lulus, 0 gagal |
| Tahap 1–5, Node test runner | 85 lulus, 0 gagal |
| Seluruh regresi Node termasuk integrasi HTTP | 238 lulus, 0 gagal sampai Tahap 36 |
| Scoring Python | 98 lulus, 0 gagal |
| TypeScript API dan frontend | Lulus sampai perubahan tahap 36 |
| Build produksi frontend | Lulus; 92 halaman berhasil diproses |
| Dry run migrasi dalam transaksi rollback | 14 migrasi, 30 kolom, 32 indeks; lulus dan idempoten |
| ESLint baseline penuh | Lulus: 1.212 error/635 warning lama, tanpa kenaikan per aturan |
| Impor/ekspor dan integritas historis soal | 44 pemeriksaan round-trip + 13 pemeriksaan service lulus |
| Database nyata | Audit lifecycle dan sinkronisasi ujian hasil generate lulus tanpa temuan |
| Browser, R2, deployment | Belum dijalankan |

Dari root repositori:

```powershell
npm run test:audit
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
npm run lint:web:baseline
```

Dari `apps/scoring`:

```powershell
& '.\.venv\Scripts\python.exe' -m pytest tests -q -p no:cacheprovider
```

Node test runner paralel membutuhkan child process. Sandbox Windows lokal menolak spawn dengan `EPERM`, sehingga berkas tes dijalankan satu per satu. Seluruh 238 tes sampai Tahap 36 lulus dalam 35 proses terisolasi. Mode satu proses gabungan tidak dipakai sebagai hasil karena dua tes ZIP membutuhkan isolasi modul. Dua kegagalan awal tes Python tambahan berasal dari fixture matching/kategori yang tidak mempunyai kunci; fixture diperbaiki dengan kunci nyata untuk membedakan input malformed dari soal tanpa kunci. Setelah koreksi, semua 98 tes lulus.

Tes baru berada di [security-stage1.test.cjs](../apps/api/test/security-stage1.test.cjs), [security-stage2.test.cjs](../apps/api/test/security-stage2.test.cjs), [grading-stage3.test.cjs](../apps/api/test/grading-stage3.test.cjs), [exam-integrity-stage4.test.cjs](../apps/api/test/exam-integrity-stage4.test.cjs), [backup-integrity-stage5.test.cjs](../apps/api/test/backup-integrity-stage5.test.cjs), [backup-archive-stage5.test.cjs](../apps/api/test/backup-archive-stage5.test.cjs), [analytics-trend-stage6.test.cjs](../apps/api/test/analytics-trend-stage6.test.cjs), [ui-quality-stage6.test.cjs](../apps/api/test/ui-quality-stage6.test.cjs), [question-sources-stage10.test.cjs](../apps/api/test/question-sources-stage10.test.cjs), [read-timeout-stage25.test.cjs](../apps/api/test/read-timeout-stage25.test.cjs), [idempotent-create-stage26.test.cjs](../apps/api/test/idempotent-create-stage26.test.cjs), [idempotent-child-create-stage27.test.cjs](../apps/api/test/idempotent-child-create-stage27.test.cjs), [question-content-idempotency-stage28.test.cjs](../apps/api/test/question-content-idempotency-stage28.test.cjs), [exam-generation-stage29.test.cjs](../apps/api/test/exam-generation-stage29.test.cjs), [pas-room-integrity-stage30.test.cjs](../apps/api/test/pas-room-integrity-stage30.test.cjs), [pas-session-integrity-stage36.test.cjs](../apps/api/test/pas-session-integrity-stage36.test.cjs), [exam-deletion-stage31.test.cjs](../apps/api/test/exam-deletion-stage31.test.cjs), [student-schedule-stage32.test.cjs](../apps/api/test/student-schedule-stage32.test.cjs), [exam-assignment-stage33.test.cjs](../apps/api/test/exam-assignment-stage33.test.cjs), [exam-assignment-restore-stage34.test.cjs](../apps/api/test/exam-assignment-restore-stage34.test.cjs), [generated-exam-sync-stage35.test.cjs](../apps/api/test/generated-exam-sync-stage35.test.cjs), [workflow-integration-stage11.test.cjs](../apps/api/test/workflow-integration-stage11.test.cjs), [role-page-parity-stage12.test.cjs](../apps/api/test/role-page-parity-stage12.test.cjs), [answer-resilience-stage13.test.cjs](../apps/api/test/answer-resilience-stage13.test.cjs), [answer-integrity-stage14.test.cjs](../apps/api/test/answer-integrity-stage14.test.cjs), [attempt-start-stage15.test.cjs](../apps/api/test/attempt-start-stage15.test.cjs), [offline-recovery-stage16.test.cjs](../apps/api/test/offline-recovery-stage16.test.cjs), [offline-storage-stage17.test.cjs](../apps/api/test/offline-storage-stage17.test.cjs), [offline-proctoring-stage18.test.cjs](../apps/api/test/offline-proctoring-stage18.test.cjs), [exam-lifecycle-stage19.test.cjs](../apps/api/test/exam-lifecycle-stage19.test.cjs), [single-school-stage20.test.cjs](../apps/api/test/single-school-stage20.test.cjs), [single-school-transport-stage22.test.cjs](../apps/api/test/single-school-transport-stage22.test.cjs), [single-school-role-context-stage23.test.cjs](../apps/api/test/single-school-role-context-stage23.test.cjs), [single-school-session-profile-stage24.test.cjs](../apps/api/test/single-school-session-profile-stage24.test.cjs), dan [test_grading_integrity.py](../apps/scoring/tests/test_grading_integrity.py). Fixture database menghormati filter dasar, mencatat mutasi, dan meniru lock/transaksi/rollback yang dibutuhkan tes, tetapi tidak meniru FK, isolasi transaksi PostgreSQL, R2 nyata, ataupun latensi jaringan. Tes konkurensi tahap 15 menambahkan serialisasi transaksi khusus untuk meniru efek advisory lock; index unik tetap perlu divalidasi pada PostgreSQL staging.

## Prioritas tahap berikutnya

1. **Validasi staging:** jalankan paket integrasi terhadap PostgreSQL dan storage sekali pakai, lalu uji matriks browser untuk admin, guru, proktor, dan siswa.
2. **Simulasi jaringan/pengawasan:** jalankan checklist tahap 19 untuk heartbeat 45 detik, antrean event offline, retry idempoten, dan terminasi terkonfirmasi di browser nyata.
3. **Sumber mata pelajaran PAS:** samakan ID `master_mapel` bertipe angka dengan `cbt_subjects` bertipe UUID; saat ini dropdown dan kontrak penyimpanan memakai dua sumber berbeda.
4. **Arsip ujian nyata:** tambahkan status arsip agar ujian selesai dapat disembunyikan dari daftar aktif tanpa menghapus rekam akademik.
5. **Pengurangan utang lint:** lanjutkan perbaikan kelompok aturan terbesar secara bertahap tanpa melonggarkan baseline 1.214 error/640 warning yang sudah tercatat.

## Verifikasi sebelum rollout

- Uji dengan akun siswa/guru/proktor asli di staging yang datanya disalin secara aman: keanggotaan aktif, public/private, kelas tambahan, dan peserta individual.
- Render semua tipe soal melalui browser; pastikan kandidat matching/kategori dan lampiran esai tetap berfungsi tanpa metadata kunci.
- Uji upload baru dan penanganan penolakan delete legacy; rencanakan pembersihan berkas lama dengan kepemilikan yang dapat dibuktikan.
- Jalankan penilaian manual, impor bobot nol, dan edit kunci dengan HTTP scoring sebenarnya; bandingkan total dan status pending.
- Validasi schema/FK dan kegagalan tengah write; kelulusan mock tidak membuktikan atomicity.
- Sebelum migrasi tahap 15, cari pasangan `exam_id,user_id` dengan lebih dari satu baris `in_progress`; tinjau jawaban pada setiap attempt dan finalkan duplikat secara manual.
- Tutup masalah state/persist serta backup prioritas tinggi sebelum menyatakan seluruh proyek aman untuk ujian nyata.
