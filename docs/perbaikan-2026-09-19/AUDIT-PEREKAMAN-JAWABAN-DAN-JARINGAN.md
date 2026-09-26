# Audit perekaman jawaban, waktu, jaringan, dan keamanan ujian

Diperbarui 26 September 2026. Pemeriksaan ini merupakan audit lanjutan setelah 45 temuan awal dan IMP-01 selesai. Fokusnya adalah perjalanan jawaban sejak siswa memilih jawaban sampai attempt berstatus final.

## Ringkasan keputusan

Alur normal sudah mempunyai perlindungan berlapis: state browser, salinan `localStorage`, antrean per soal, autosave server, retry massal, dan submit transaksional. Backend mengikat setiap mutasi ke pengguna yang sedang login, attempt, ujian, perangkat, status, dan deadline berdasarkan jam database.

Jawaban antarsiswa tidak mempunyai jalur pencampuran pada API normal. Risiko yang masih nyata adalah jawaban siswa yang sama tertahan atau tidak ikut dinilai pada gangguan jaringan tertentu. Mode offline juga hanya bertahan selama halaman yang sudah dimuat tetap terbuka; menutup tab, menghapus data browser, berpindah perangkat, atau reload tanpa jaringan dapat menghilangkan salinan yang belum sampai ke server.

## Alur perekaman saat ini

1. Saat jawaban berubah, nilai terbaru langsung masuk ke `answersRef` dan state React.
2. Seluruh peta jawaban ditulis ke `localStorage` dengan kunci `exam_answers_{attemptId}`.
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

### ANS-01 — P1: request autosave dapat menggantung dan menahan antrean satu soal

`apiSend` memakai `fetch` tanpa timeout atau `AbortController`. Pada koneksi yang tidak benar-benar putus tetapi tidak pernah membalas, promise autosave tetap pending. `PerKeyQueue` kemudian menahan semua perubahan berikutnya untuk soal itu. Penanda `inFlight` membuat beacon membawa nilai terbaru saat halaman ditutup, dan submit tetap mengirim snapshot penuh, tetapi selama pengerjaan tidak ada retry untuk request yang belum pernah resolve.

Perbaikan yang disarankan: timeout yang benar-benar meng-abort request autosave, lalu tandai soal gagal agar bulk retry mengambil nilai terbaru. Request lama harus dibatalkan; sekadar `Promise.race` dapat membiarkan jawaban lama tiba setelah jawaban baru.

### ANS-02 — P1: auto-submit dapat berhenti setelah tiga retry

Auto-submit yang gagal dijadwalkan ulang maksimal tiga kali. Jika `navigator.onLine` tetap `true` saat gateway, DNS, reverse proxy, atau backend tidak dapat dijangkau, event `online` tidak muncul ketika layanan pulih. Setelah tiga percobaan, tidak ada retry otomatis lanjutan. Autosave dapat pulih melalui interval 15 detik, tetapi status attempt dapat tetap `in_progress` sampai ada proses lain yang menutupnya.

Perbaikan yang disarankan: state machine submit yang terus mencoba dengan backoff sampai server mengonfirmasi status final, menerima pembatalan eksplisit dari proktor, atau halaman ditutup. Tampilan harus membedakan “tersimpan lokal”, “tersimpan server”, dan “submit dikonfirmasi”.

### ANS-03 — P1 operasional: jawaban offline setelah deadline memerlukan tindakan proktor

Siswa dapat terus mengisi halaman yang sudah terbuka ketika jaringan putus. Jika jaringan kembali sebelum deadline, bulk sync dan submit dapat merekam seluruh jawaban. Jika kembali sesudah deadline, backend dengan sengaja menolak perubahan baru dan menilai snapshot server. Salinan lokal dipertahankan, tetapi hanya dapat disinkronkan setelah proktor melakukan reset.

Ini bukan pencampuran jawaban, tetapi dapat terlihat sebagai “jawaban hilang” bila prosedur pengawas tidak memahami alur pemulihan. Menerima jawaban lokal otomatis setelah deadline juga tidak aman karena browser tidak dapat membuktikan kapan jawaban dibuat.

Perbaikan yang disarankan: SOP pemulihan proktor, indikator jumlah jawaban lokal/server, dan audit log reset yang menampilkan alasan serta rentang waktu. Bila sekolah memilih toleransi offline otomatis, kebijakannya memerlukan desain lease bertanda tangan dan batas risiko yang disetujui, bukan sekadar mempercayai waktu browser.

### ANS-04 — P1: autosave belum memastikan soal dan opsi berasal dari ujian aktif

Endpoint autosave memvalidasi UUID dan kepemilikan attempt, tetapi `upsertAnswers` belum memastikan `questionId` termasuk sumber soal ujian tersebut atau `selected_option_id` merupakan opsi milik soal itu. Foreign key hanya membuktikan bahwa soal/opsi ada. Klien yang dimodifikasi dapat menyisipkan baris asing ke attempt miliknya.

Penilaian normal dan auto-finish memuat daftar soal ujian lalu mengabaikan soal asing, sehingga temuan ini tidak memberi akses ke attempt siswa lain dan tidak langsung menaikkan nilai. Namun baris asing dapat mencemari monitoring, analitik, ekspor, atau pemeriksaan manual.

Perbaikan yang disarankan: validasi seluruh question ID terhadap resolver sumber ujian dan, untuk pilihan tunggal, validasi opsi terhadap question ID sebelum upsert. Bulk sync harus menolak seluruh batch secara atomik bila satu baris tidak sah.

### ANS-05 — P2: start attempt masih mempunyai race pembuatan ganda

Alur start melakukan “cari attempt aktif, lalu insert” tanpa lock atau constraint unik yang terlihat pada skema untuk pasangan ujian-pengguna. Dua permintaan start bersamaan dapat sama-sama tidak menemukan attempt lalu membuat dua baris `in_progress`. Submit dengan `clientAttemptId` tetap memilih attempt yang benar, tetapi jawaban dapat terbagi bila dua tab mengerjakan dua attempt dan monitoring menampilkan peserta ganda.

Perbaikan yang disarankan: constraint unik database untuk satu attempt per `(exam_id, user_id)` atau transaksi/advisory lock yang menangani konflik secara idempoten.

### ANS-06 — P2: salinan offline bergantung pada satu browser profile

`localStorage` dapat ditolak, penuh, dibersihkan, atau hilang pada mode privat. Aplikasi memberi peringatan dan autosave server tetap berjalan, tetapi crash/reload saat offline tidak dapat dipulihkan. Device ID juga menjadi volatile bila storage tidak tersedia, sehingga reload dapat tampak sebagai perangkat baru.

Perbaikan yang disarankan: IndexedDB sebagai penyimpanan utama dengan fallback, pengecekan kapasitas sebelum ujian, dan larangan memulai mode offline bila durable storage tidak tersedia. Tetap tidak ada jaminan setelah data browser sengaja dihapus.

### ANS-07 — P2: pengawasan browser saat offline bersifat best-effort

Fullscreen, blur, visibility, shortcut, dan log pelanggaran berjalan di browser. Saat jaringan terputus, log server dan terminasi tidak selalu terkonfirmasi. Siswa juga mengendalikan perangkat/browser, sehingga mekanisme ini tidak dapat dianggap sebagai pengamanan anti-cheat yang kuat.

Perbaikan yang disarankan: antrekan durable untuk event keamanan, konfirmasi terminasi server, status offline pada dashboard proktor, serta kebijakan ruang ujian. Jangan menggunakan event browser sebagai satu-satunya bukti kecurangan.

### ANS-08 — P2: submit membaca state render, bukan snapshot ref paling mutakhir

Autosave menggunakan `answersRef` agar perubahan cepat tidak membaca closure lama, tetapi submit masih mengirim variabel state `answers`. Pada interaksi biasa React biasanya merender perubahan sebelum klik berikutnya. Namun perubahan jawaban yang berimpit dengan auto-submit waktu nol atau event koneksi dapat memakai closure render sebelumnya. Setelah server mengonfirmasi submit, cache lokal dibersihkan sehingga jawaban terakhir dapat tidak ikut.

Perbaikan yang disarankan: submit selalu membaca `answersRef.current` tepat sebelum request dan tes regresi untuk perubahan jawaban terakhir yang berimpit dengan auto-submit.

## Skenario yang wajib diuji di staging

1. Putus jaringan selama 2 menit, jawab beberapa tipe soal, pulihkan sebelum deadline, dan cocokkan browser, API, serta database.
2. Putus jaringan melewati deadline, lalu jalankan SOP reset proktor dan pastikan audit log serta nilai akhir jelas.
3. Simulasikan request autosave yang menggantung, bukan langsung gagal, lalu ubah soal yang sama beberapa kali.
4. Hilangkan respons submit setelah transaksi berhasil dan pastikan retry idempoten.
5. Jalankan submit bersamaan dengan autosave terakhir, force terminate, dan auto-finish.
6. Mulai ujian bersamaan dari dua tab dan dua perangkat.
7. Coba menulis attempt siswa lain, soal dari ujian lain, dan opsi dari soal lain.
8. Uji storage penuh, mode privat, reload offline, browser crash, serta token kedaluwarsa di tengah ujian.
9. Bandingkan jumlah jawaban pada UI, `localStorage`, `cbt_answers`, review hasil, monitoring, dan ekspor.

## Urutan perbaikan

1. ANS-01 dan ANS-02 untuk mencegah antrean/submit berhenti pada jaringan setengah hidup.
2. ANS-04 untuk menjaga integritas setiap baris autosave.
3. ANS-08 untuk memastikan snapshot submit selalu paling mutakhir.
4. ANS-05 untuk menghilangkan attempt ganda.
5. ANS-03, ANS-06, dan ANS-07 sebagai kebijakan serta ketahanan operasional offline.
