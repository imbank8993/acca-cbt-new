# Catatan perbaikan audit ACCA CBT

Dimulai 19 September 2026; diperbarui 20 September 2026. Acuan: [audit awal](AUDIT_LENGKAP_2026-09-19.md), baseline Git `a8861683c7612920a511859f1d1f009ec4d49f17`.

## Status pekerjaan

Tiga tahap implementasi lokal telah diselesaikan dan diuji. **17 ID temuan ditangani: 16 selesai pada lingkup kode yang disebutkan, 1 diperbaiki sebagian, dan 28 temuan belum dikerjakan.** “Selesai” di sini berarti perubahan kode dan tes lokal lulus; bukan berarti sudah diterapkan ke produksi atau diuji dengan database sekolah. SEC-14 tetap parsial karena kebijakan pemulihan jawaban setelah submit (SEC-10) belum ditutup.

Tidak dilakukan migrasi, perubahan database sekolah, pengunggahan/penghapusan objek R2 sungguhan, atau deployment. Bukti audit awal dipertahankan sebagai baseline; skrip reproduksi lama sengaja mengharapkan bug lama sehingga tidak lagi menjadi tes kelulusan untuk kode terbaru.

| Tahap | Lingkup | Temuan | Verifikasi |
|---|---|---|---|
| 1 | Akses ujian, DTO soal siswa, pencocokan submit, rilis hasil | SEC-01, SEC-02, SEC-04, sebagian SEC-14, BUG-13, UX-04 | 36 tes regresi lokal lulus |
| 2 | Kepemilikan resource, validasi nilai, event pengawasan, storage | SEC-05–09, SEC-11, BUG-01, BUG-06–07 | 32 tes baru; gabungan tahap 1–2: 68 lulus |
| 3 | Integritas pilihan kompleks dan agregasi nilai manual | BUG-15–16 | 3 tes backend lulus; 98 tes Python lulus (78 lama + 20 baru) |

Daftar seluruh 45 ID beserta statusnya tersedia dalam [tracker perbaikan](perbaikan-2026-09-19/STATUS_TEMUAN.md).

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

### SEC-14 (parsial) dan UX-04: hasil aktif/tersembunyi tidak bocor lewat jalur hasil biasa

**Sebelum:** daftar hasil menyertakan attempt aktif dan skor belum dirilis; review/detail bisa dibuka ketika masih mengerjakan jika show_results aktif. Analitik masih memasukkan nilai tersembunyi.

**Sesudah:** daftar hasil hanya berisi status final. Skor total dan IRT dikirim null ketika show_results belum true. Pemilik attempt aktif ditolak dari detail/review. Overview, histori, perbandingan dan agregasi peringkat analitik siswa hanya memakai hasil yang sudah dirilis; batas jumlah histori diterapkan setelah penyaringan. Staf pada review tetap harus melalui izin ujian yang ada.

**Lokasi:** [students.service.ts](../apps/api/src/students/students.service.ts), [exam-review.service.ts](../apps/api/src/analytics/exam-review.service.ts), [student-analytics.service.ts](../apps/api/src/analytics/student-analytics.service.ts).

**Pengujian:** attempt aktif tidak muncul sebagai hasil, skor tersembunyi null, review aktif ditolak sebelum mengambil soal/jawaban, analitik tersembunyi kosong, serta histori tetap mengisi limit dengan hasil yang dirilis.

**Masih terbuka:** SEC-10 memungkinkan pemulihan/terminasi ulang setelah status final; karena itu rilis hasil belum dapat dianggap terlindungi end-to-end dari penyalahgunaan late sync. Filtering analitik dilakukan setelah pembacaan database demi kompatibilitas adapter; optimasi query/pagination untuk volume besar belum dilakukan.

## Tahap 2 — Penulisan data harus mengikuti pemilik dan aturan nilai

### SEC-05: preferensi tidak dapat mengganti identitas target

Service hanya memetakan field preferensi yang diizinkan dan selalu menetapkan user_id dari sesi. ID, timestamp, dan field asing dari body tidak diteruskan. Boolean divalidasi, menit pengingat harus integer 0–10.080, dan jam tenang menerima format HH:mm atau HH:mm:ss yang valid; kosong/null menghapus jam tenang. Field asing diabaikan agar UI yang mengirim objek preferensi lengkap tetap kompatibel.

**Lokasi:** [notifications.service.ts](../apps/api/src/notifications/notifications.service.ts). **Tes:** percobaan user_id korban, timestamp/kolom asing, tipe nilai salah, waktu invalid, format lama dan pengosongan nilai.

### SEC-07: soal, opsi, dan referensi harus berasal dari bank yang diizinkan

Update memeriksa bahwa soal sudah ada pada bank tujuan. ID opsi existing harus unik dan benar-benar milik soal itu. Stimulus, instruksi, dimensi, dan kisi-kisi yang dirujuk harus berasal dari bank yang sama. Semua pemeriksaan dilakukan sebelum mutasi pertama. Soal baru memakai insert tanpa ID klien; soal lama memakai update dengan kondisi ID dan bank, sehingga ID asing tidak dapat direlokasi lewat upsert.

**Lokasi:** [questions.service.ts](../apps/api/src/questions/questions.service.ts). **Tes:** soal asing, opsi asing, stimulus lintas bank, opsi existing pada create, serta update sah dengan bobot nol.

**Batas:** penggantian opsi belum menjadi satu transaksi database penuh. Kegagalan infrastruktur di tengah rangkaian write masih perlu penanganan atomicity; tes “tanpa partial write” tahap ini hanya membuktikan input yang tidak sah ditolak sebelum write, bukan rollback seluruh kegagalan database. Perubahan bank/soal historis juga masih terkait BUG-11.

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

## Hasil pengujian dan cara menjalankan

| Pemeriksaan | Hasil |
|---|---|
| Tahap 1 + 2, Node test runner | 68 lulus, 0 gagal |
| Tahap 3, Node test runner | 3 lulus, 0 gagal |
| Scoring Python | 98 lulus, 0 gagal |
| TypeScript API dan frontend | Lulus sebelum perubahan tahap 3; pemeriksaan final dicatat di bawah setelah selesai |
| Browser, database nyata, R2, deployment | Belum dijalankan |

Dari root repositori:

```powershell
node --test apps/api/test/security-stage1.test.cjs apps/api/test/security-stage2.test.cjs apps/api/test/grading-stage3.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
```

Dari `apps/scoring`:

```powershell
& '.\.venv\Scripts\python.exe' -m pytest tests -q -p no:cacheprovider
```

Node test runner membutuhkan child process. Sandbox lokal menolak spawn EPERM, sehingga tes dijalankan dengan izin eksekusi di luar sandbox; tidak ada perubahan metode fixture menjadi akses database/jaringan. Dua kegagalan awal tes Python tambahan berasal dari fixture matching/kategori yang tidak mempunyai kunci; fixture diperbaiki dengan kunci nyata untuk membedakan input malformed dari soal tanpa kunci. Setelah koreksi, semua 98 tes lulus.

Tes baru berada di [security-stage1.test.cjs](../apps/api/test/security-stage1.test.cjs), [security-stage2.test.cjs](../apps/api/test/security-stage2.test.cjs), [grading-stage3.test.cjs](../apps/api/test/grading-stage3.test.cjs), dan [test_grading_integrity.py](../apps/scoring/tests/test_grading_integrity.py). Fixture database menghormati filter dasar dan mencatat mutasi, tetapi tidak meniru FK, locking, transaksi, ataupun latensi PostgreSQL.

## Prioritas tahap berikutnya

1. **State dan persist pengerjaan:** SEC-03/10, BUG-03/08/09/10. Satukan deadline, terminasi idempoten, pemulihan offline, revision autosave, dan commit jawaban/status yang dapat dipulihkan ketika gagal. Ini juga diperlukan untuk menutup SEC-14 sepenuhnya.
2. **Backup/restore:** SEC-12/13 dan BUG-02/04/05. Validasi izin/signature sebelum upload, pembatasan arsip/URL, manifest lengkap, dan rollback atomik. Jangan menganggap backup sudah dapat diandalkan hanya karena audit awal selesai.
3. **Historis dan kompatibilitas soal:** BUG-11/12, perlindungan soal yang pernah dijawab, dan satu kebijakan sumber bank.
4. **UI/UX dan kualitas:** BUG-14, UX-01–03/05–12, QA-01–03; lakukan pemeriksaan browser dan perbaikan lint terarah setelah alur data stabil.

## Verifikasi sebelum rollout

- Uji dengan akun siswa/guru/proktor asli di staging yang datanya disalin secara aman: keanggotaan aktif, public/private, kelas tambahan, dan peserta individual.
- Render semua tipe soal melalui browser; pastikan kandidat matching/kategori dan lampiran esai tetap berfungsi tanpa metadata kunci.
- Uji upload baru dan penanganan penolakan delete legacy; rencanakan pembersihan berkas lama dengan kepemilikan yang dapat dibuktikan.
- Jalankan penilaian manual, impor bobot nol, dan edit kunci dengan HTTP scoring sebenarnya; bandingkan total dan status pending.
- Validasi schema/FK dan kegagalan tengah write; kelulusan mock tidak membuktikan atomicity.
- Tutup masalah state/persist serta backup prioritas tinggi sebelum menyatakan seluruh proyek aman untuk ujian nyata.
