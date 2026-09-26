# Audit perekaman jawaban, waktu, jaringan, dan keamanan ujian

Diperbarui 26 September 2026. Pemeriksaan ini merupakan audit lanjutan setelah 45 temuan awal dan IMP-01 selesai. Fokusnya adalah perjalanan jawaban sejak siswa memilih jawaban sampai attempt berstatus final.

## Ringkasan keputusan

Alur normal sudah mempunyai perlindungan berlapis: state browser, snapshot IndexedDB dengan fallback `localStorage`, antrean per soal, autosave server, retry massal, dan submit transaksional. Backend mengikat setiap mutasi ke pengguna yang sedang login, attempt, ujian, perangkat, status, dan deadline berdasarkan jam database. ANS-01, ANS-02, dan ANS-08 telah diperbaiki pada tahap 13; ANS-04 pada tahap 14; ANS-05 pada tahap 15; ANS-03 pada tahap 16; ANS-06 pada tahap 17; dan ANS-07 pada tahap 18. Seluruh delapan temuan audit lanjutan telah diperbaiki dan mempunyai tes regresi lokal.

Jawaban antarsiswa tidak mempunyai jalur pencampuran pada API normal. Risiko yang masih nyata adalah jawaban siswa yang sama tertahan atau tidak ikut dinilai pada gangguan jaringan tertentu. Halaman yang sudah dimuat tetap dapat dipakai saat offline dan snapshot bertahan melewati reload/crash. Namun aplikasi belum dapat dimuat ulang tanpa jaringan karena aset serta API ujian memerlukan koneksi. Menghapus data browser atau berpindah perangkat tetap menghilangkan akses ke salinan lokal.

| ID | Prioritas | Status | Ringkasan |
|---|---:|---|---|
| ANS-01 | P1 | Selesai, tes lokal lulus | Timeout membatalkan request autosave yang menggantung |
| ANS-02 | P1 | Selesai, tes lokal lulus | Auto-submit retry berkelanjutan dengan backoff |
| ANS-03 | P1 operasional | Selesai, tes lokal lulus | Pemulihan setelah deadline terotorisasi dan dapat diaudit |
| ANS-04 | P1 | Selesai, tes lokal lulus | Validasi soal dan opsi saat autosave |
| ANS-05 | P2 | Selesai, tes lokal lulus | Start bersamaan kembali ke satu attempt aktif |
| ANS-06 | P2 | Selesai, tes lokal lulus | Snapshot IndexedDB dengan preflight dan fallback |
| ANS-07 | P2 | Selesai, tes lokal lulus | Antrean pengawasan durable, heartbeat, dan terminasi terkonfirmasi |
| ANS-08 | P2 | Selesai, tes lokal lulus | Submit memakai snapshot ref terbaru |

## Alur perekaman saat ini

1. Saat jawaban berubah, nilai terbaru langsung masuk ke `answersRef` dan state React.
2. Seluruh peta jawaban ditulis berurutan ke IndexedDB dan dicerminkan ke `localStorage` sebagai fallback kompatibilitas.
3. Autosave dimasukkan ke `PerKeyQueue`. Perubahan pada soal yang sama berjalan berurutan, sedangkan soal berbeda dapat dikirim paralel.
4. Backend mengunci baris attempt, memeriksa pemilik, status `in_progress`, perangkat, waktu mulai, dan deadline, lalu melakukan upsert dengan konflik `(attempt_id, question_id)`.
5. Kegagalan autosave ditandai dan dicoba ulang setiap 15 detik. Ketika browser kembali online, seluruh snapshot lokal dikirim lewat endpoint bulk.
6. Saat tab disembunyikan atau ditutup, jawaban yang masih gagal atau sedang dikirim dititipkan melalui `sendBeacon`.
7. Submit mengirim seluruh snapshot jawaban lagi. Backend menilai jawaban, mengunci attempt, meng-upsert jawaban, lalu memperbarui status/nilai/waktu selesai dalam satu transaksi.
8. Submit bersifat idempoten: bila respons sukses hilang di jaringan, pengulangan terhadap attempt final mengembalikan sukses tanpa menggandakan hasil.

## Waktu ujian

Deadline yang menentukan penerimaan jawaban berada di backend dan memakai jam database. Deadline efektif adalah nilai paling awal antara `personal_end_time` dan `exam.end_time`. Jam perangkat hanya dipakai untuk tampilan countdown; memundurkan jam laptop tidak membuat backend menerima jawaban terlambat.

Frontend menerima `remainingSeconds` dari server dan membentuk deadline absolut. Timer tetap mengejar waktu nyata ketika tab di-background. Ketika mencapai nol, frontend mencoba submit otomatis. Bila submit tiba setelah deadline, server menutup attempt sebagai `auto_submitted` dan menilai jawaban yang sudah ada di database.

Konsekuensinya, jawaban yang hanya tersimpan lokal ketika deadline server lewat tidak otomatis diterima. Ini adalah kebijakan keamanan saat ini agar siswa tidak dapat mengubah jawaban setelah waktu habis. Pemulihan memerlukan reset proktor, yang membuka grace period tercatat dan melepaskan kunci perangkat.

## Pemisahan jawaban antarsiswa

Perlindungan yang sudah ada:

- identitas pengguna berasal dari cookie/token dan `JwtAuthGuard`, bukan dari body;
- `assertOwnedAndRunning` menolak attempt yang `user_id`-nya berbeda;
- submit mencocokkan `clientAttemptId`, `examId`, dan pengguna;
- setiap attempt memakai UUID dan setiap jawaban unik pada `(attempt_id, question_id)`;
- perangkat yang berbeda ditolak sampai proktor melakukan reset;
- kunci cache lokal memakai `attemptId`, sehingga akun lain tidak membaca cache melalui ID ujiannya saja.

Dengan lapisan tersebut, menukar `attemptId` di request tidak dapat menulis jawaban siswa lain. Device ID bukan autentikasi dan dapat dibaca browser, tetapi hanya menjadi lapisan tambahan setelah identitas pengguna diperiksa.

## Risiko lanjutan

### ANS-01 — P1 — Selesai: request autosave dapat menggantung dan menahan antrean satu soal

`apiSend` memakai `fetch` tanpa timeout atau `AbortController`. Pada koneksi yang tidak benar-benar putus tetapi tidak pernah membalas, promise autosave tetap pending. `PerKeyQueue` kemudian menahan semua perubahan berikutnya untuk soal itu. Penanda `inFlight` membuat beacon membawa nilai terbaru saat halaman ditutup, dan submit tetap mengirim snapshot penuh, tetapi selama pengerjaan tidak ada retry untuk request yang belum pernah resolve.

Perbaikan yang diterapkan: klien API menerima timeout opsional dengan `AbortController`. Autosave tunggal dibatalkan setelah 15 detik; bulk sync dan submit setelah 30 detik. Request yang dibatalkan menghasilkan kegagalan terkontrol sehingga soal ditandai untuk retry, sedangkan request lama tidak dapat tiba belakangan dan menimpa nilai baru.

### ANS-02 — P1 — Selesai: auto-submit dapat berhenti setelah tiga retry

Auto-submit yang gagal dijadwalkan ulang maksimal tiga kali. Jika `navigator.onLine` tetap `true` saat gateway, DNS, reverse proxy, atau backend tidak dapat dijangkau, event `online` tidak muncul ketika layanan pulih. Setelah tiga percobaan, tidak ada retry otomatis lanjutan. Autosave dapat pulih melalui interval 15 detik, tetapi status attempt dapat tetap `in_progress` sampai ada proses lain yang menutupnya.

Perbaikan yang diterapkan: batas tiga percobaan dihapus. Auto-submit mengulang dengan backoff 10 detik, 20 detik, lalu maksimal 30 detik untuk percobaan berikutnya sampai server mengonfirmasi status final atau halaman dibongkar. Hanya satu timer retry dan satu request submit yang boleh aktif. Setelah kegagalan otomatis, layar tetap berada pada status menunggu sinkronisasi agar siswa tidak mengira submit sudah selesai.

### ANS-03 — P1 operasional — Selesai: pemulihan setelah deadline terotorisasi dan dapat diaudit

Siswa dapat terus mengisi halaman yang sudah terbuka ketika jaringan putus. Jika jaringan kembali sebelum deadline, bulk sync dan submit dapat merekam seluruh jawaban. Jika kembali sesudah deadline, backend dengan sengaja menolak perubahan baru dan menilai snapshot server. Salinan lokal dipertahankan, tetapi hanya dapat disinkronkan setelah proktor melakukan reset.

Ini bukan pencampuran jawaban, tetapi dapat terlihat sebagai “jawaban hilang” bila prosedur pengawas tidak memahami alur pemulihan. Menerima jawaban lokal otomatis setelah deadline juga tidak aman karena browser tidak dapat membuktikan kapan jawaban dibuat.

Perbaikan yang diterapkan: reset mewajibkan alasan, memakai jam database, mengunci attempt, menghitung jawaban server, dan menulis seluruh metadata pemulihan secara atomik. Siswa melihat jumlah jawaban lokal/server dan tenggat pada banner pemulihan; layar kedaluwarsa mempertahankan cache dan memperingatkan agar perangkat serta data browser tidak diganti. Prosedur lengkap tersedia pada [SOP pemulihan jawaban offline](SOP-PEMULIHAN-JAWABAN-OFFLINE.md).

Kebijakan tetap fail-closed: tanpa reset staf, server menolak jawaban setelah deadline. Pemulihan memberi 15 menit dan semua jawaban masih melewati validasi attempt, perangkat, soal/opsi, dan deadline. Browser tetap tidak dipercaya sebagai sumber waktu jawaban.

### ANS-04 — P1 — Selesai: autosave memastikan soal dan opsi berasal dari ujian aktif

Endpoint autosave memvalidasi UUID dan kepemilikan attempt, tetapi `upsertAnswers` belum memastikan `questionId` termasuk sumber soal ujian tersebut atau `selected_option_id` merupakan opsi milik soal itu. Foreign key hanya membuktikan bahwa soal/opsi ada. Klien yang dimodifikasi dapat menyisipkan baris asing ke attempt miliknya.

Penilaian normal dan auto-finish memuat daftar soal ujian lalu mengabaikan soal asing, sehingga temuan ini tidak memberi akses ke attempt siswa lain dan tidak langsung menaikkan nilai. Namun baris asing dapat mencemari monitoring, analitik, ekspor, atau pemeriksaan manual.

Perbaikan yang diterapkan: save tunggal dan bulk sync mengunci serta memeriksa attempt lebih dulu, lalu memakai resolver sumber ujian bersama dan hanya memuat ID soal yang diminta. Setiap `questionId` harus ada pada bank langsung atau sumber multi-bank ujian. `selected_option_id` harus menjadi opsi milik soal tersebut, dan format kolom harus sesuai tipe soal. Seluruh batch divalidasi sebelum upsert di dalam transaksi; satu baris tidak sah membatalkan semua perubahan.

### ANS-05 — P2 — Selesai: start attempt bersamaan kembali ke satu sesi

Sebelumnya alur start melakukan “cari attempt aktif, lalu insert” tanpa lock atau constraint unik untuk pasangan ujian-pengguna. Dua permintaan start bersamaan dapat sama-sama tidak menemukan attempt lalu membuat dua baris `in_progress`. Submit dengan `clientAttemptId` tetap memilih attempt yang benar, tetapi jawaban dapat terbagi bila dua tab mengerjakan dua attempt dan monitoring menampilkan peserta ganda.

Perbaikan yang diterapkan: sebelum insert, service membuka transaksi dan mengambil advisory lock berdasarkan pasangan ujian-pengguna. Di dalam lock, status aktif dan final diperiksa ulang. Request yang kalah melanjutkan attempt pemenang; perangkat lain tetap ditolak oleh kunci perangkat tanpa membuat baris baru. Unique index parsial database membatasi satu baris `in_progress` pada `(exam_id, user_id)`.

Migrasi tidak menghapus duplikat lama. Bila ditemukan pasangan aktif ganda, migrasi berhenti dan meminta operator meninjau kumpulan jawaban setiap attempt sebelum memfinalkan duplikat. Ini mencegah pembersihan otomatis menghilangkan jawaban siswa.

### ANS-06 — P2 — Selesai: snapshot offline memakai IndexedDB dengan fallback

Sebelumnya `localStorage` dapat ditolak, penuh, dibersihkan, atau hilang pada mode privat. Aplikasi memberi peringatan dan autosave server tetap berjalan, tetapi crash/reload saat offline tidak dapat dipulihkan. Device ID juga menjadi volatile bila storage tidak tersedia, sehingga reload dapat tampak sebagai perangkat baru.

Perbaikan yang diterapkan: IndexedDB menjadi penyimpanan utama dan `localStorage` menjadi fallback/mirror kompatibilitas. Preflight tulis, permintaan persistence, dan estimasi kapasitas berjalan sebelum start. Tanpa storage yang dapat ditulis, attempt tidak dibuat. Cache lama dimigrasikan, write diserialisasi, cleanup tidak mendahului write tertunda, dan ID perangkat ikut dipersistenkan. Rincian desain dan batasnya tersedia di [dokumentasi penyimpanan durable](PENYIMPANAN-JAWABAN-OFFLINE-DURABLE.md).

### ANS-07 — P2 — Selesai: pengawasan browser saat offline memakai antrean durable

Fullscreen, blur, visibility, shortcut, dan log pelanggaran berjalan di browser. Saat jaringan terputus, log server dan terminasi tidak selalu terkonfirmasi. Siswa juga mengendalikan perangkat/browser, sehingga mekanisme ini tidak dapat dianggap sebagai pengamanan anti-cheat yang kuat.

Perbaikan yang diterapkan: event disimpan lebih dahulu dalam antrean IndexedDB dengan fallback `localStorage`, lalu dikirim berurutan saat online. Setiap event memakai UUID idempoten; unique index server mencegah retry dihitung dua kali. Heartbeat terautentikasi dan terikat perangkat memperbarui `last_seen_at`, lalu monitoring empat peran menampilkan koneksi terputus setelah 45 detik tanpa heartbeat. Ketika batas pelanggaran tercapai, UI diblokir dan terus mencoba terminasi; sesi hanya dibersihkan setelah server mengonfirmasi penutupan. Rincian alur, migrasi, kondisi gagal, dan batas keamanan tersedia di [dokumentasi pengawasan offline](PENGAWASAN-OFFLINE-DAN-HEARTBEAT.md).

### ANS-08 — P2 — Selesai: submit membaca state render, bukan snapshot ref paling mutakhir

Autosave menggunakan `answersRef` agar perubahan cepat tidak membaca closure lama, tetapi submit masih mengirim variabel state `answers`. Pada interaksi biasa React biasanya merender perubahan sebelum klik berikutnya. Namun perubahan jawaban yang berimpit dengan auto-submit waktu nol atau event koneksi dapat memakai closure render sebelumnya. Setelah server mengonfirmasi submit, cache lokal dibersihkan sehingga jawaban terakhir dapat tidak ikut.

Perbaikan yang diterapkan: submit membaca `answersRef.current` tepat ketika request dibuat. Timeout `Promise.race` lama dihapus karena tidak membatalkan fetch yang mendasarinya; pembatalan kini dilakukan di klien HTTP. Tes regresi menjaga penggunaan ref terbaru.

## Skenario yang wajib diuji di staging

1. Putus jaringan selama 2 menit, jawab beberapa tipe soal, pulihkan sebelum deadline, dan cocokkan browser, API, serta database.
2. Putus jaringan melewati deadline, lalu jalankan SOP reset proktor dan pastikan audit log serta nilai akhir jelas.
3. Simulasikan request autosave yang menggantung, bukan langsung gagal, lalu ubah soal yang sama beberapa kali.
4. Hilangkan respons submit setelah transaksi berhasil dan pastikan retry idempoten.
5. Jalankan submit bersamaan dengan autosave terakhir, force terminate, dan auto-finish.
6. Mulai ujian bersamaan dari dua tab dan dua perangkat.
7. Coba menulis attempt siswa lain, soal dari ujian lain, dan opsi dari soal lain.
8. Uji storage penuh, mode privat, reload offline, browser crash, serta token kedaluwarsa di tengah ujian.
9. Bandingkan jumlah jawaban pada UI, IndexedDB/fallback `localStorage`, `cbt_answers`, review hasil, monitoring, dan ekspor.

## Urutan perbaikan

Seluruh ANS-01 sampai ANS-08 telah selesai. Langkah berikutnya adalah validasi staging terhadap PostgreSQL nyata, browser siswa, dan simulasi jaringan.

## Verifikasi tahap 13

Empat tes baru membuktikan bahwa timeout memicu abort nyata, endpoint jawaban memakai batas waktu yang ditentukan, backoff tetap tersedia setelah percobaan ketiga, dan submit membaca snapshot ref terbaru. Tes ini tergabung dalam `npm run test:audit`. TypeScript API dan frontend lulus.

## Verifikasi tahap 14

Lima tes ANS-04 membuktikan penolakan soal asing, penolakan opsi milik soal lain, rollback seluruh bulk sync ketika satu baris tidak sah, dukungan bank langsung dan multi-bank, serta penolakan format kolom yang tidak sesuai tipe soal. Paket lengkap kini menjalankan 115 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service.

## Verifikasi tahap 15

Tiga tes ANS-05 membuktikan bahwa dua start bersamaan dari perangkat yang sama menerima ID attempt yang sama, perangkat kedua tidak membentuk attempt tambahan dan tetap menghasilkan audit kunci perangkat, serta migrasi menolak duplikat lama sebelum memasang unique index parsial. Paket lengkap kini menjalankan 118 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service.

## Verifikasi tahap 16

Empat tes ANS-03 membuktikan audit alasan/aktor/jumlah/deadline dengan jam database, penolakan alasan kosong, rollback reset bila log gagal, serta indikator jumlah lokal/server pada layar siswa. Paket lengkap kini menjalankan 122 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service.

## Verifikasi tahap 17

Empat tes ANS-06 membuktikan serialisasi snapshot, fallback ketika IndexedDB tidak tersedia, pemblokiran start bila seluruh storage ditolak, serta penggunaan preflight, restore, cleanup, migrasi cache, pemeriksaan kapasitas, persistence, dan ID perangkat durable. Paket lengkap kini menjalankan 126 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service.

## Verifikasi tahap 18

Lima tes ANS-07 membuktikan deduplikasi event retry, validasi heartbeat pemilik/perangkat, kontrak antrean durable, urutan konfirmasi terminasi sebelum pembersihan sesi, indikator offline empat peran, dan pengaman migrasi. Paket lengkap kini menjalankan 131 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service. Build backend dan typecheck frontend lulus.

## Verifikasi tahap 19

Empat tes lifecycle membuktikan hasil grading auto-finish/terminasi yang tertunda tidak masuk setelah reset, audit terminasi mendahului reset, dan finalisasi monitoring menutup status sebelum menunggu scoring. Validator migrasi serta audit database read-only ditambahkan untuk staging. Paket lengkap kini menjalankan 135 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service. Rincian tersedia pada [panduan tahap 19](TAHAP-19-VALIDASI-LIFECYCLE-DAN-STAGING.md).
