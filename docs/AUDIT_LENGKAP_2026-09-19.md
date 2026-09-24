# Audit kode, keamanan, dan UI/UX ACCA CBT

Tanggal: 19 September 2026. Baseline Git: `a8861683c7612920a511859f1d1f009ec4d49f17`.

**Status terbaru:** dokumen ini adalah baseline sebelum perbaikan. Lihat [catatan perbaikan bertahap](PERBAIKAN_AUDIT_2026-09-19.md) dan [tracker](perbaikan-2026-09-19/STATUS_TEMUAN.md) untuk implementasi terbaru. **Errata BUG-15:** endpoint batch scoring melewati esai; cacat yang terkonfirmasi adalah kontribusi nilai manual hilang dari total saat regrade, bukan baris nilai esai selalu ditimpa nol. Penjelasan awal BUG-15 di bawah harus dibaca dengan koreksi ini.

## Kesimpulan dan urutan penanganan

Ditemukan **45 catatan temuan**: 23 P1, 21 P2, dan 1 P3. Catatan ini menggabungkan bug, celah kontrol akses, cacat UI/UX, serta tiga temuan kualitas; bukan 45 eksploit yang semuanya sudah dibuktikan di produksi. **14 skenario reproduksi sintetis berhasil menunjukkan cacat saat ini**. Dua skenario memakai mesin penilaian Python asli; 12 lainnya memakai layanan asli dengan dependensi mock atau reproduksi algoritma.

Prioritas pertama adalah menjaga **kerahasiaan soal/kunci, integritas nilai, dan jawaban siswa**: SEC-01–04, SEC-06–10, SEC-14, BUG-03, BUG-08–09, BUG-15–16. Selanjutnya amankan dan uji **backup/restore** (SEC-12–13, BUG-02, BUG-04–05) sebelum mengandalkannya sebagai satu-satunya pemulihan. Perbaiki kontrak upload (BUG-01) dan alur penilaian manual (BUG-06) bersamaan dengan pengujian ujung-ke-ujung. Urutan dalam setiap kelompok mengikuti dependensi, bukan hanya nomor temuan.

Tidak ada kode aplikasi yang diubah oleh audit ini. Tidak dilakukan penghapusan objek storage, pengiriman payload ke layanan produksi, maupun pembacaan/mutasi database sekolah. Skrip bukti memakai data sintetis dan tidak memerlukan kredensial.

## Ruang lingkup dan batas kesimpulan

Inventaris mencakup **437 berkas sumber / 90.006 baris**, termasuk **51 halaman / 34.198 baris halaman**. Baris dihitung dengan pemisahan newline sehingga newline terakhir dapat menambah satu baris kosong. Sumber yang diinventarisasi: app/components/lib frontend, API Nest, scoring FastAPI, dan shared package. File konfigurasi yang relevan juga diperiksa secara terarah. Dependensi, build output, dan semua aset biner tidak dimasukkan dalam angka sumber.

Setiap halaman dicatat dalam [matriks halaman](audit-2026-09-19/MATRIKS_HALAMAN.md). Penelusuran dilakukan dari halaman ke helper API/controller/service serta penyimpanan dan scoring, dengan perhatian mendalam pada alur berisiko dan komponen bersama. **Inventaris seluruh baris tidak sama dengan verifikasi manual setiap baris atau semua kombinasi runtime.** Halaman salinan antarrole ditelusuri melalui struktur, pencarian pola, dan implementasi representatif; tidak diklaim telah diuji visual satu per satu. Tidak adanya temuan khusus pada halaman bukan sertifikasi bahwa halaman aman.

Lingkungan browser autentikasi, screenshot/responsivitas aktual, pembaca layar, database/FK deployment, reverse proxy, konfigurasi R2, rate limit eksternal, dan pemindaian advisory dependensi belum diuji. Layanan menggunakan database bersama menurut README, sehingga audit tidak mencoba migrasi/reset atau restore nyata. Schema Prisma tanpa model tidak digunakan sebagai bukti bahwa FK tidak ada. Tidak ada klaim CVE, kompromi produksi, atau XSS yang sudah dieksploitasi. Build produksi, uji beban, dan uji integrasi jaringan belum dijalankan.

## Hasil pemeriksaan

| Pemeriksaan | Hasil | Makna/batas |
|---|---|---|
| TypeScript frontend tanpa emit | Lulus | Konsistensi tipe, bukan validasi perilaku/otorisasi |
| TypeScript API tanpa emit | Lulus | Sama; banyak any membatasi jangkauan |
| Pytest scoring | 78 lulus | Tes yang ada lulus; tidak mencakup semua input adversarial |
| ESLint frontend | 1367 error, 653 warning | Gagal; diagnostik tidak dihitung sebagai bug unik |
| Reproduksi TypeScript/algoritma | 12/12 cacat tereproduksi | Mock DB/storage, tidak mengukur enforcement deployment |
| Reproduksi grading Python | 2/2 cacat tereproduksi | Fungsi scoring asli, data sintetis |

Perintah, bukti, dan batas reproduksi tercantum pada [rencana uji](audit-2026-09-19/RENCANA_UJI.md). Hasil mesin tersedia pada [verification-results.json](audit-2026-09-19/verification-results.json), [verification-scoring.json](audit-2026-09-19/verification-scoring.json), serta [ringkasan lint](audit-2026-09-19/eslint-summary.json). Hasil positif skrip reproduksi berarti **bug masih ada**, bukan aplikasi lulus keamanan.

## Cara membaca prioritas dan bukti

- **P1 — tinggi:** berpotensi merusak integritas ujian/nilai, membocorkan kunci, menghilangkan data, atau membuka akses lintas resource. Disarankan ditangani sebelum ujian nyata yang bergantung pada alur tersebut. Tidak diberi P0 karena dampak produksi/eksploit luas tanpa prasyarat belum diverifikasi.
- **P2 — sedang:** fungsi, informasi, aksesibilitas, atau pembatasan lokal tidak konsisten; tetap membutuhkan perbaikan terencana.
- **P3 — rendah:** utang pemeliharaan yang memperbesar kemungkinan regresi.
- **R:** cacat direproduksi dengan data sintetis; cakupan mock/algoritma dijelaskan per temuan.
- **S:** bukti langsung dari alur kode; skenario runtime yang ditulis adalah rencana validasi staging, bukan klaim sudah dijalankan.
- **T:** hasil pemeriksaan alat/tes. Ketergantungan pada konfigurasi atau data deployment dijelaskan dalam temuan.

## Indeks temuan

| ID | Prioritas | Bukti | Temuan |
|---|---|---|---|
| [SEC-01](#sec-01) | P1 | R | Akses langsung ujian melewati penugasan peserta |
| [SEC-02](#sec-02) | P1 | R | Metadata kunci jawaban ikut dikirim ke siswa |
| [SEC-03](#sec-03) | P1 | R | Deadline dan pengikatan perangkat tidak ditegakkan saat menyimpan jawaban |
| [SEC-04](#sec-04) | P1 | R | ID pengerjaan tidak dicocokkan dengan ID ujian saat submit |
| [SEC-05](#sec-05) | P2 | R | Preferensi notifikasi dapat ditulis ke user_id pengguna lain |
| [SEC-06](#sec-06) | P1 | R | Penghapusan berkas non-assignment tidak memeriksa pemilik |
| [SEC-07](#sec-07) | P1 | R | Upsert soal dan opsi menerima ID resource asing |
| [SEC-08](#sec-08) | P1 | R | Penilaian esai dapat menargetkan answer ID dari pengerjaan lain |
| [SEC-09](#sec-09) | P1 | R | Siswa dapat memalsukan event reset proktor |
| [SEC-10](#sec-10) | P1 | S | Terminasi ulang membuka kembali jendela susulan jawaban |
| [SEC-11](#sec-11) | P2 | S | Impor soal memakai izin lebih longgar daripada editor bank |
| [SEC-12](#sec-12) | P1 | S | Arsip backup diproses dan diunggah sebelum autentikasi/otorisasi final |
| [SEC-13](#sec-13) | P1 | S | Ekspor backup melakukan fetch URL gambar tanpa pembatasan tujuan |
| [SEC-14](#sec-14) | P1 | S | Kebijakan hasil ujian diterapkan tidak konsisten di API |
| [BUG-01](#bug-01) | P1 | R | Unggah berhasil di server tetapi dianggap gagal oleh UI |
| [BUG-02](#bug-02) | P1 | R | Restore ZIP bergambar merusak signature sebelum diverifikasi |
| [BUG-03](#bug-03) | P1 | R | Submit dapat berhasil meski penyimpanan jawaban gagal |
| [BUG-04](#bug-04) | P1 | S | Restore menghapus data sebelum validasi lengkap dan tanpa transaksi |
| [BUG-05](#bug-05) | P1 | S | Cakupan backup tidak lengkap untuk fitur aplikasi sekarang |
| [BUG-06](#bug-06) | P1 | R | Nilai esai tidak dibatasi dan status penilaian selesai terlalu dini |
| [BUG-07](#bug-07) | P2 | R | Bobot opsi nol berubah menjadi satu |
| [BUG-08](#bug-08) | P1 | S | Autosave jawaban rentan tertimpa request lama |
| [BUG-09](#bug-09) | P1 | S | Kegagalan localStorage menghentikan autosave ke server |
| [BUG-10](#bug-10) | P2 | S | Resume sesudah akhir global dapat menutup jalan pemulihan offline |
| [BUG-11](#bug-11) | P1 | S | Pemeriksaan soal yang sudah dipakai tidak mengikuti relasi jawaban aktual |
| [BUG-12](#bug-12) | P2 | S | Dukungan bank soal legacy tidak konsisten antarjalur |
| [BUG-13](#bug-13) | P2 | S | Ujian public dapat diterbitkan tetapi tidak muncul di daftar siswa |
| [BUG-14](#bug-14) | P2 | S | Hook React diletakkan setelah conditional return |
| [BUG-15](#bug-15) | P1 | S | Regrade dapat menimpa nilai esai yang sudah dinilai manual |
| [BUG-16](#bug-16) | P1 | R | Pilihan duplikat dapat memanipulasi skor |
| [UX-01](#ux-01) | P2 | S | Dashboard pengawas menampilkan statistik dan kejadian contoh sebagai data aktif |
| [UX-02](#ux-02) | P2 | S | Kegagalan API disamarkan menjadi daftar kosong |
| [UX-03](#ux-03) | P2 | S | Fallback autentikasi dapat tetap menampilkan loading tanpa jalan keluar |
| [UX-04](#ux-04) | P2 | S | Daftar hasil menyebut pengerjaan aktif sebagai selesai |
| [UX-05](#ux-05) | P2 | S | Hitungan jawaban salah dapat negatif setelah penilaian esai |
| [UX-06](#ux-06) | P2 | S | Waktu hasil dan jadwal menggunakan zona waktu berbeda |
| [UX-07](#ux-07) | P2 | S | Navigasi kartu dan kontrol toggle tidak sepenuhnya dapat diakses dengan keyboard |
| [UX-08](#ux-08) | P2 | S | Respons monitoring lama dapat menimpa ujian yang baru dipilih |
| [UX-09](#ux-09) | P2 | S | Detail jadwal PAS tidak menjelaskan hasil pembuatan parsial |
| [UX-10](#ux-10) | P2 | S | Notifikasi lama tidak memiliki jalur pagination yang jelas |
| [UX-11](#ux-11) | P2 | S | Ekspor jawaban analitik kehilangan isi tipe soal kompleks |
| [UX-12](#ux-12) | P2 | S | Indikator tren dapat menyatakan naik saat nilai menurun |
| [QA-01](#qa-01) | P2 | T | Lint frontend belum menjadi pemeriksaan kualitas yang lulus |
| [QA-02](#qa-02) | P2 | T | Pengujian yang tersedia belum mencakup integritas alur lintas layanan |
| [QA-03](#qa-03) | P3 | S | Halaman role yang diduplikasi memperbesar risiko perbaikan tidak merata |

## Rincian temuan

<a id="sec-01"></a>

### SEC-01 — Akses langsung ujian melewati penugasan peserta

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 73; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 137; [apps/api/src/students/students.service.ts](../apps/api/src/students/students.service.ts) baris 272.

**Penyebab:** Daftar ujian memfilter target/partisipan, tetapi getQuestions dan start tidak menerapkan pemeriksaan kelayakan peserta yang sama. getQuestions hanya mensyaratkan published; detail ujian juga tidak menegakkan kebijakan publikasi/target yang setara. Guard JWT membuktikan identitas, bukan hak mengikuti ujian tertentu.

**Skenario/verifikasi:** Gunakan akun siswa A dan ID ujian published yang hanya ditugaskan kepada kelas B. Panggil layanan detail/soal/start secara langsung, tanpa melalui daftar jadwal. Mock getQuestions membuktikan tidak ada query keanggotaan atau attempt.

**Dampak:** Siswa yang mengetahui ID ujian dapat melihat soal atau membuat pengerjaan di luar penugasannya. Jangkauan lintas organisasi bergantung data dan konfigurasi deployment; tidak diuji di produksi.

**Perbaikan yang disarankan:** Buat satu assertExamEligibility yang memeriksa organisasi aktif, target kelas/peserta, kebijakan public, status publikasi, dan waktu. Terapkan pada seluruh endpoint siswa termasuk detail, soal, dan start.

**Kriteria selesai:** Siswa di luar target mendapat 403 pada semua jalur; siswa yang sah tetap dapat mengerjakan. Public mengikuti kebijakan eksplisit, bukan menjadi bypass organisasi.

<a id="sec-02"></a>

### SEC-02 — Metadata kunci jawaban ikut dikirim ke siswa

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 73; [apps/scoring/app/services/grading.py](../apps/scoring/app/services/grading.py) baris 92.

**Penyebab:** Proyeksi soal mengirim metadata soal dan opsi, termasuk data yang dipakai mesin penilaian: jawaban/variasi isian, correct_order, pasangan matching, kategori benar, serta bobot. Menghilangkan is_correct saja tidak menyembunyikan seluruh kunci.

**Skenario/verifikasi:** Buat soal isian dengan metadata.blanks[].answer, lalu baca respons soal menggunakan akun siswa. Reproduksi sintetis menerima nilai answer secara utuh.

**Dampak:** Kunci dapat dibaca lewat respons jaringan sebelum menjawab. Terhubung dengan SEC-01, kebocoran tidak terbatas peserta yang seharusnya mengikuti ujian.

**Perbaikan yang disarankan:** Pisahkan DTO rendering siswa dari DTO penilaian. Gunakan allowlist per tipe soal, pisahkan label kandidat dari pemetaan jawaban benar, dan simpan bobot/kunci hanya pada server.

**Kriteria selesai:** Uji semua tipe soal: siswa mendapat seluruh data untuk merender, tanpa jawaban benar, pemetaan benar, atau bobot penilaian; tampilan soal tetap berfungsi.

<a id="sec-03"></a>

### SEC-03 — Deadline dan pengikatan perangkat tidak ditegakkan saat menyimpan jawaban

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 432; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 598; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 137.

**Penyebab:** assertOwnedAndRunning hanya memeriksa pemilik dan status in_progress. Save/submit tidak selalu memeriksa personal_end_time serta batas akhir ujian. Penutupan karena waktu bergantung jalur resume/monitoring. Device ID yang kosong dapat melewati perbandingan perangkat; save/submit tidak mengikat perangkat secara konsisten.

**Skenario/verifikasi:** Dengan attempt in_progress yang personal_end_time-nya sudah lewat, kirim save tanpa menjalankan resume atau monitoring. Layanan menerima penulisan dalam mock.

**Dampak:** Timer browser dapat dilewati dan jawaban diterima setelah waktu habis selama status belum diperbarui server. Perangkat berbeda juga tidak selalu terhalang.

**Perbaikan yang disarankan:** Tegakkan deadline efektif dan status secara atomik di server pada setiap mutasi. Bedakan grace period pemulihan yang sah dari jawaban baru. Gunakan token sesi pengerjaan yang diterbitkan server jika pengikatan perangkat diperlukan.

**Kriteria selesai:** Save dan submit setelah deadline mengikuti kebijakan yang sama tanpa bergantung browser/proktor. Uji kondisi tepat pada batas waktu dan balapan finalisasi.

<a id="sec-04"></a>

### SEC-04 — ID pengerjaan tidak dicocokkan dengan ID ujian saat submit

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 861; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 598.

**Penyebab:** Saat clientAttemptId tersedia, resolveAttemptForSubmit memeriksa pemilik tetapi tidak mencocokkan exam_id dengan examId pada rute. Penilaian menggunakan ujian dari rute sementara penyimpanan memakai ID pengerjaan yang diberikan.

**Skenario/verifikasi:** Siswa mempunyai attempt A untuk ujian A. Kirim submit ke ujian B dengan attempt A. Mock membuktikan resolver menerima pasangan yang berbeda.

**Dampak:** Hasil pengerjaan milik siswa sendiri dapat tercampur antarujian; nilai atau jawaban dapat dicatat ke attempt yang salah. Ini bukan bukti mengambil alih attempt siswa lain.

**Perbaikan yang disarankan:** Pilih attempt dengan id, user_id, dan exam_id sekaligus; ambil konteks penilaian dari attempt yang sudah tervalidasi. Periksa juga jalur alreadySubmitted.

**Kriteria selesai:** Pasangan ujian/attempt yang tidak cocok selalu ditolak sebelum penilaian atau penulisan.

<a id="sec-05"></a>

### SEC-05 — Preferensi notifikasi dapat ditulis ke user_id pengguna lain

**Prioritas:** P2. **Bukti:** R. **Lokasi:** [apps/api/src/notifications/notifications.service.ts](../apps/api/src/notifications/notifications.service.ts) baris 139.

**Penyebab:** Objek upsert menyusun user_id dari identitas sebelum menyebarkan preferences. Body bertipe Record tidak memberi allowlist DTO yang mencegah user_id menimpa identitas.

**Skenario/verifikasi:** Kirim preferences sintetis berisi user_id korban. Mock menunjukkan baris upsert memakai ID korban.

**Dampak:** Pengguna login dapat mengubah preferensi notifikasi orang lain jika mengetahui ID-nya, termasuk mematikan pemberitahuan.

**Perbaikan yang disarankan:** Gunakan DTO field preferensi yang eksplisit, tolak field ekstra, dan tetapkan user_id server setelah pemetaan allowlist.

**Kriteria selesai:** Body berisi user_id/id/field asing ditolak atau diabaikan; target selalu pengguna terautentikasi.

<a id="sec-06"></a>

### SEC-06 — Penghapusan berkas non-assignment tidak memeriksa pemilik

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/storage/storage.controller.ts](../apps/api/src/storage/storage.controller.ts) baris 151; [apps/api/src/storage/storage.service.ts](../apps/api/src/storage/storage.service.ts) baris 113.

**Penyebab:** Pemeriksaan pemilik hanya diterapkan untuk prefix assignments/. Key di prefix lain diteruskan ke deleteObject bagi pengguna yang sudah login. Penerimaan host r2.dev juga perlu dibatasi pada host storage yang benar-benar dikonfigurasi.

**Skenario/verifikasi:** Gunakan siswa biasa dengan URL gambar questions milik pihak lain. Mock menunjukkan deleteObject dipanggil tanpa pemeriksaan bank/pemilik.

**Dampak:** Gambar soal atau aset lain yang URL-nya diketahui berpotensi dihapus. Bukti tidak melakukan penghapusan R2 sungguhan.

**Perbaikan yang disarankan:** Simpan hubungan objek dengan pemilik/organisasi/resource. Otorisasi penghapusan terhadap resource untuk seluruh prefix dan cocokkan origin storage secara tepat.

**Kriteria selesai:** Siswa tidak dapat menghapus gambar bank soal atau aset pengguna lain; pemilik/staf yang berhak tetap dapat menghapus aset yang diizinkan.

<a id="sec-07"></a>

### SEC-07 — Upsert soal dan opsi menerima ID resource asing

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/questions/questions.service.ts](../apps/api/src/questions/questions.service.ts) baris 81; [apps/api/src/questions/questions.service.ts](../apps/api/src/questions/questions.service.ts) baris 303.

**Penyebab:** save memeriksa akses bank tujuan dari DTO, kemudian upsert memakai dto.id tanpa memeriksa kepemilikan soal yang sudah ada. Pola serupa pada ID opsi perlu membatasi opsi ke soal induknya.

**Skenario/verifikasi:** Guru yang berhak pada bank A mengirim ID soal existing dari bank B dengan bankId A. Mock membuktikan upsert menerima ID asing setelah hanya bank tujuan diperiksa.

**Dampak:** Soal pihak lain dapat tertimpa atau dipindahkan; opsi dan nilai ujian yang bergantung pada soal ikut berisiko.

**Perbaikan yang disarankan:** Pisahkan create dan update. Untuk update, muat resource asal dan periksa izin pada asal serta tujuan; opsi existing harus milik questionId yang sama. Lakukan perubahan sebagai transaksi.

**Kriteria selesai:** ID soal/opsi lintas bank, pemilik, dan organisasi ditolak tanpa mengubah resource mana pun.

<a id="sec-08"></a>

### SEC-08 — Penilaian esai dapat menargetkan answer ID dari pengerjaan lain

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/teachers/teachers.service.ts](../apps/api/src/teachers/teachers.service.ts) baris 256.

**Penyebab:** Otorisasi dilakukan terhadap attempt yang dipilih, tetapi update setiap nilai hanya memakai id jawaban. Tidak ada pengikatan answer ke attempt tersebut dan ke tipe soal esai.

**Skenario/verifikasi:** Guru yang boleh menilai attempt A memasukkan ID jawaban milik attempt B ke map grades. Mock mencatat update ID asing.

**Dampak:** Guru dapat mengubah nilai jawaban di luar pengerjaan yang diizinkan. Ini terpisah dari validasi rentang nilai pada BUG-06.

**Perbaikan yang disarankan:** Ambil semua jawaban yang diminta dengan attempt_id dan tipe esai, verifikasi jumlah serta kepemilikannya, lalu update dengan kondisi id + attempt_id dalam transaksi.

**Kriteria selesai:** Answer ID asing/non-esai ditolak seluruhnya sebelum ada nilai berubah; nilai esai sah tetap tersimpan.

<a id="sec-09"></a>

### SEC-09 — Siswa dapat memalsukan event reset proktor

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/proctoring/proctoring.controller.ts](../apps/api/src/proctoring/proctoring.controller.ts) baris 18; [apps/api/src/proctoring/proctoring.service.ts](../apps/api/src/proctoring/proctoring.service.ts) baris 58.

**Penyebab:** eventType pada log pelanggaran hanya divalidasi sebagai string. Layanan menerima RESET_BY_PROCTOR dari pemilik attempt, padahal event tersebut dipakai sebagai batas waktu reset penghitungan pelanggaran.

**Skenario/verifikasi:** Kirim eventType RESET_BY_PROCTOR melalui jalur log siswa. Mock menunjukkan event disimpan dan dipakai sebagai batas hitungan.

**Dampak:** Integritas log pengawasan dan hitungan pelanggaran rusak; riwayat dapat tampak seolah proktor melakukan reset. Pengawasan browser tetap bukan jaminan anti-kecurangan mutlak.

**Perbaikan yang disarankan:** Pisahkan event server/proktor dari allowlist event siswa. Catat actor dan asal event di server serta tegakkan transisi/hitungan di server.

**Kriteria selesai:** Siswa tidak dapat menulis event administratif atau mereset hitungan; reset sah mencatat identitas proktor.

<a id="sec-10"></a>

### SEC-10 — Terminasi ulang membuka kembali jendela susulan jawaban

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/api/src/proctoring/proctoring.service.ts](../apps/api/src/proctoring/proctoring.service.ts) baris 194; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 465.

**Penyebab:** forceTerminate mengizinkan pemilik attempt dan menulis status auto_submitted serta finished_at baru tanpa kondisi status sebelumnya. syncLateAnswers memakai finished_at untuk batas enam jam, menerima jawaban kosong/lebih lengkap, dan hanya membandingkan perangkat jika kedua nilai tidak kosong.

**Skenario/verifikasi:** Pada staging, submit attempt, panggil forceTerminate milik sendiri, lalu susulkan jawaban baru pada bagian yang sebelumnya kosong. Ulangi terminasi setelah jendela susulan berlalu untuk menguji pembaruan batas waktunya.

**Dampak:** Jawaban dapat diubah setelah pengumpulan dengan menyamarkannya sebagai pemulihan offline. Tidak ada bukti server bahwa jawaban susulan memang dibuat sebelum deadline.

**Perbaikan yang disarankan:** Terapkan state machine dan compare-and-set; terminasi harus idempoten dan tidak mengubah finished_at yang sudah final. Batasi pemulihan dengan kebijakan/audit proktor atau bukti checkpoint server yang dapat diverifikasi.

**Kriteria selesai:** Attempt submitted tidak dapat diubah menjadi auto_submitted oleh siswa; terminasi ulang tidak memperpanjang jendela; susulan yang tidak sah ditolak.

<a id="sec-11"></a>

### SEC-11 — Impor soal memakai izin lebih longgar daripada editor bank

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/api/src/imports/imports.service.ts](../apps/api/src/imports/imports.service.ts) baris 54; [apps/api/src/questions/questions.service.ts](../apps/api/src/questions/questions.service.ts) baris 81.

**Penyebab:** assertCanImport memeriksa status staf pada organisasi resource dengan assertStaffByRecord, sedangkan editor bank memakai assertBankAccess. Guru dapat lolos impor pada bank guru lain dalam organisasi yang sama meskipun tidak berhak mengedit melalui jalur normal.

**Skenario/verifikasi:** Guru A mencoba bulk import ke bank milik guru B yang tidak dibagikan. Bandingkan izin endpoint import dengan endpoint save soal biasa.

**Dampak:** Kebijakan kepemilikan bank menjadi tidak konsisten dan konten bank pihak lain dapat ditambah melalui impor.

**Perbaikan yang disarankan:** Gunakan kebijakan assertBankAccess yang sama untuk preview/permission dan eksekusi impor; bila akses bersama memang diinginkan, nyatakan kebijakannya secara eksplisit.

**Kriteria selesai:** Semua jalur create/edit/import menghasilkan keputusan izin yang identik untuk bank yang sama.

<a id="sec-12"></a>

### SEC-12 — Arsip backup diproses dan diunggah sebelum autentikasi/otorisasi final

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/web/app/api/backup/import/route.ts](../apps/web/app/api/backup/import/route.ts) baris 22; [apps/web/app/api/backup/import/route.ts](../apps/web/app/api/backup/import/route.ts) baris 115.

**Penyebab:** Rute memeriksa keberadaan token, kemudian membuka ZIP, mendekompresi dan mengunggah objek sebelum validasi signature serta panggilan Nest yang memeriksa izin. Tidak ada batas ukuran terkompresi/hasil dekompresi/jumlah entry dalam kode jalur ini.

**Skenario/verifikasi:** Di staging dengan storage terisolasi, gunakan siswa yang tidak berhak memulihkan backup dan ZIP kecil valid secara struktur tetapi signature salah; amati apakah storage sudah ditulis sebelum respons penolakan. Batas reverse proxy deployment belum diverifikasi.

**Dampak:** Pengguna tanpa hak restore dapat menghabiskan memori, waktu proses, dan kuota storage; hasil gagal dapat meninggalkan objek yatim.

**Perbaikan yang disarankan:** Validasi identitas dan izin organisasi sebelum membaca payload berat. Verifikasi manifest asli sebelum upload; batasi ukuran, rasio dekompresi, jumlah entry, ekstensi, serta lakukan rollback objek pada kegagalan.

**Kriteria selesai:** Pemanggil tanpa hak atau signature salah menghasilkan nol penulisan storage; arsip melewati limit ditolak dini tanpa konsumsi memori tidak terkendali.

<a id="sec-13"></a>

### SEC-13 — Ekspor backup melakukan fetch URL gambar tanpa pembatasan tujuan

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/web/app/api/backup/export/route.ts](../apps/web/app/api/backup/export/route.ts) baris 65.

**Penyebab:** URL gambar dari HTML tersimpan diambil oleh server menggunakan fetch. Tidak ada allowlist origin, validasi alamat privat/loopback, pemeriksaan redirect, batas byte, atau timeout khusus pada jalur ini.

**Skenario/verifikasi:** Pada lingkungan uji terisolasi, simpan HTML soal dengan src menuju server canary internal, lalu ekspor sebagai proktor. Pastikan tidak menguji alamat internal produksi.

**Dampak:** Potensi SSRF: request dari server dapat menjangkau layanan internal dan respons ikut dalam arsip. Eksploitabilitas bergantung siapa yang dapat menyimpan URL, egress jaringan, dan perilaku respons; belum diuji melalui jaringan.

**Perbaikan yang disarankan:** Batasi gambar pada storage yang dikelola aplikasi dan ambil objek berdasarkan key. Bila URL eksternal wajib, validasi DNS/IP dan setiap redirect, tolak jaringan privat, serta batasi waktu dan ukuran.

**Kriteria selesai:** Loopback, private IP, redirect ke internal, DNS rebinding, dan respons berlebih ditolak; gambar storage sah tetap ikut backup.

<a id="sec-14"></a>

### SEC-14 — Kebijakan hasil ujian diterapkan tidak konsisten di API

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/api/src/students/students.service.ts](../apps/api/src/students/students.service.ts) baris 296; [apps/api/src/students/students.service.ts](../apps/api/src/students/students.service.ts) baris 320; [apps/api/src/analytics/exam-review.service.ts](../apps/api/src/analytics/exam-review.service.ts) baris 90; [apps/api/src/analytics/student-analytics.service.ts](../apps/api/src/analytics/student-analytics.service.ts) baris 5.

**Penyebab:** listResults/analitik siswa mengirim skor walau show_results false; penyembunyian di UI tidak melindungi respons API. Endpoint review/detail memeriksa pemilik dan show_results, tetapi tidak mensyaratkan status attempt selesai sebelum menyediakan jawaban/kunci.

**Skenario/verifikasi:** Uji siswa pemilik attempt dengan show_results false dan periksa respons skor. Lalu nyalakan show_results pada ujian yang masih in_progress dan panggil review/detail secara langsung.

**Dampak:** Nilai yang belum dirilis dapat terlihat. Dengan show_results aktif, siswa berpotensi membaca kunci saat masih mengerjakan; tingkat risiko tertinggi berasal dari cabang kedua.

**Perbaikan yang disarankan:** Terapkan kebijakan release hasil server-side yang mencakup status attempt, waktu rilis ujian, dan show_results, pada daftar, detail, review, analitik, serta ekspor siswa.

**Kriteria selesai:** Tidak ada skor/kunci pada respons sebelum kebijakan rilis terpenuhi; role staf tetap mengikuti otorisasi yang sesuai.

<a id="bug-01"></a>

### BUG-01 — Unggah berhasil di server tetapi dianggap gagal oleh UI

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/storage/storage.controller.ts](../apps/api/src/storage/storage.controller.ts) baris 103; [apps/web/lib/uploader.ts](../apps/web/lib/uploader.ts) baris 49; [apps/web/app/api/storage/upload/route.ts](../apps/web/app/api/storage/upload/route.ts) baris 55.

**Penyebab:** Nest mengembalikan url/key/provider tanpa success, proxy storage meneruskannya, sementara uploader mengharuskan result.success. Jalur delete memakai kontrak serupa.

**Skenario/verifikasi:** Berikan respons HTTP 200 berbentuk respons controller kepada uploadToHosting. Reproduksi menghasilkan pesan Gagal mengunggah (HTTP 200).

**Dampak:** Gambar/lampiran sudah berada di storage tetapi pengguna melihat kegagalan; percobaan ulang membuat objek yatim dan menghambat penyuntingan soal/tugas.

**Perbaikan yang disarankan:** Standarkan DTO respons upload/delete dan proxy; gunakan status HTTP serta bentuk payload yang konsisten.

**Kriteria selesai:** Tes kontrak controller → proxy → uploader pada sukses dan gagal. Sukses menampilkan URL, gagal hanya untuk kegagalan nyata.

<a id="bug-02"></a>

### BUG-02 — Restore ZIP bergambar merusak signature sebelum diverifikasi

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/web/app/api/backup/import/route.ts](../apps/web/app/api/backup/import/route.ts) baris 115; [apps/web/app/api/backup/import/route.ts](../apps/web/app/api/backup/import/route.ts) baris 80.

**Penyebab:** readArchive mengganti URL gambar dalam manifest dengan URL upload baru sebelum POST menghitung HMAC. Ekspor menandatangani payload dengan path arsip, sehingga payload setelah penggantian berbeda.

**Skenario/verifikasi:** Gunakan manifest bertanda tangan yang memuat src gambar arsip. Ganti URL seperti readArchive lalu hitung HMAC; verifikasi gagal. Ini reproduksi algoritma, bukan round-trip storage.

**Dampak:** Backup ZIP dengan gambar yang berhasil dipulihkan ditolak sebagai rusak dan berkas upload tertinggal. Backup tanpa penggantian URL dapat lolos.

**Perbaikan yang disarankan:** Verifikasi signature atas manifest asli dahulu, baru buat salinan payload untuk pemetaan URL. Pisahkan integritas arsip dari transformasi restore.

**Kriteria selesai:** Round-trip backup dengan gambar mempertahankan isi/relasi dan lolos integritas; perubahan satu byte pada manifest tetap ditolak sebelum upload.

<a id="bug-03"></a>

### BUG-03 — Submit dapat berhasil meski penyimpanan jawaban gagal

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 598; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 841.

**Penyebab:** Status/nilai attempt diperbarui sebelum seluruh jawaban selesai dipersist. persistAnswers hanya mencatat error database dan tidak melempar kegagalan. Retry dapat masuk alreadySubmitted; UI membersihkan salinan lokal setelah sukses.

**Skenario/verifikasi:** Mock database mengembalikan error penulisan jawaban. persistAnswers tetap resolve. Pada staging lanjutkan dengan fault injection saat submit dan periksa status, respons, jawaban, serta cache lokal.

**Dampak:** Pengumpulan tampak selesai tetapi bukti jawaban hilang atau tidak cocok dengan nilai; salinan lokal yang masih berguna dapat terhapus.

**Perbaikan yang disarankan:** Gunakan transaksi jawaban/status/nilai atau tahap finalisasi yang dapat diulang dengan aman. Propagasikan kegagalan dan bersihkan cache hanya setelah server mengonfirmasi persist lengkap.

**Kriteria selesai:** Setiap error penulisan menghasilkan retry yang aman tanpa status final palsu; submit identik tetap idempoten.

<a id="bug-04"></a>

### BUG-04 — Restore menghapus data sebelum validasi lengkap dan tanpa transaksi

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/api/src/backup/backup.service.ts](../apps/api/src/backup/backup.service.ts) baris 145; [apps/api/src/backup/backup.service.ts](../apps/api/src/backup/backup.service.ts) baris 236; [apps/api/src/backup/backup.service.ts](../apps/api/src/backup/backup.service.ts) baris 353.

**Penyebab:** Import hanya memeriksa keberadaan payload.data sebelum wipe. Penghapusan dan banyak insert dilakukan bertahap tanpa transaksi keseluruhan; beberapa hasil delete tidak diperiksa.

**Skenario/verifikasi:** Pada database sekali pakai, gunakan backup bertanda tangan dengan relasi invalid atau paksa insert gagal setelah wipe. Bandingkan seluruh data sebelum dan setelah kegagalan.

**Dampak:** Restore gagal dapat meninggalkan organisasi kosong atau sebagian terpulihkan. Efek FK/cascade sebenarnya harus diuji pada schema deployment, bukan ditebak dari schema.prisma.

**Perbaikan yang disarankan:** Validasi schema/version dan referential integrity sebelum mutasi; gunakan staging tables/transaksi yang sesuai serta backup pra-restore dan pemeriksaan setiap error.

**Kriteria selesai:** Kegagalan di tahap mana pun mempertahankan data awal atau rollback lengkap; tidak ada respons sukses untuk restore parsial.

<a id="bug-05"></a>

### BUG-05 — Cakupan backup tidak lengkap untuk fitur aplikasi sekarang

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/api/src/backup/backup.service.ts](../apps/api/src/backup/backup.service.ts) baris 56; [apps/api/src/backup/backup.service.ts](../apps/api/src/backup/backup.service.ts) baris 145; [apps/api/src/backup/backup.service.ts](../apps/api/src/backup/backup.service.ts) baris 192.

**Penyebab:** Daftar ekspor/impor tidak mencakup target/peserta ujian yang digunakan jalur siswa, konfigurasi/jadwal PAS, dan sejumlah relasi/metadata terpisah seperti dimensi serta log keamanan. Error baca dapat diubah menjadi array kosong. Remapping identitas hanya berfokus user_id, tidak seluruh foreign key pembuat seperti created_by.

**Skenario/verifikasi:** Buat fixture dengan target kelas, peserta individual, jadwal PAS, dimensi, dan pembuat yang UUID-nya berbeda di tujuan; export–restore lalu bandingkan entitas dan alur aksesnya.

**Dampak:** Berkas yang terlihat sebagai backup lengkap dapat kehilangan kemampuan menampilkan ujian, konfigurasi, atau atribusi pembuat. Data yang tidak dicakup dapat terhapus oleh cascade atau menjadi stale; efek tepatnya bergantung schema nyata.

**Perbaikan yang disarankan:** Tetapkan manifest cakupan/version eksplisit dan daftar seluruh relasi; gagalkan ekspor pada error baca. Petakan semua referensi pengguna dan uji round-trip dengan checksum/count per entitas.

**Kriteria selesai:** Seluruh fitur yang dijanjikan UI pulih dengan relasi valid. Data yang sengaja tidak dicadangkan dinyatakan jelas dan tidak diklaim sebagai backup lengkap.

<a id="bug-06"></a>

### BUG-06 — Nilai esai tidak dibatasi dan status penilaian selesai terlalu dini

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/api/src/teachers/teachers.service.ts](../apps/api/src/teachers/teachers.service.ts) baris 256; [apps/api/src/teachers/dto/teachers.dto.ts](../apps/api/src/teachers/dto/teachers.dto.ts) baris 21.

**Penyebab:** Map grades tidak memvalidasi angka finite/rentang terhadap skor maksimum per soal. Layanan menyetel needs_manual_grading false setelah permintaan, termasuk penilaian parsial. Rumus maksimum juga perlu disamakan dengan penilaian akademik yang mengecualikan tipe psikometri.

**Skenario/verifikasi:** Kirim nilai 999 pada esai berskor maksimum kecil; mock menerimanya. Uji terpisah map kosong atau hanya satu dari beberapa esai.

**Dampak:** Nilai dapat melebihi batas dan pekerjaan yang belum dinilai terlihat tuntas. Ini berbeda dari IDOR pada SEC-08.

**Perbaikan yang disarankan:** Validasi tipe/rentang setiap skor, tentukan kelengkapan dari seluruh esai di database, dan gunakan aturan agregasi yang sama untuk submit, manual grading, serta regrade.

**Kriteria selesai:** NaN/negatif/di atas maksimum ditolak; penilaian parsial tetap pending; ujian campuran menghasilkan skor akademik konsisten.

<a id="bug-07"></a>

### BUG-07 — Bobot opsi nol berubah menjadi satu

**Prioritas:** P2. **Bukti:** R. **Lokasi:** [apps/api/src/questions/questions.service.ts](../apps/api/src/questions/questions.service.ts) baris 326.

**Penyebab:** replaceOptions memakai operator || untuk default bobot. Angka nol yang sah dianggap kosong, berbeda dari jalur impor yang memakai pemeriksaan nullish.

**Skenario/verifikasi:** Simpan opsi berbobot 0 melalui editor. Mock menangkap weight 1 dalam data upsert.

**Dampak:** Skor psikometri atau soal berbobot berubah tanpa persetujuan pembuat; hasil editor dan impor tidak konsisten.

**Perbaikan yang disarankan:** Gunakan ?? setelah validasi angka serta tetapkan apakah bobot negatif memang diperbolehkan oleh desain.

**Kriteria selesai:** Bobot 0, 1, dan bobot lain dipertahankan identik melalui create/edit/import/reload.

<a id="bug-08"></a>

### BUG-08 — Autosave jawaban rentan tertimpa request lama

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/web/app/components/questions/ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx) baris 709; [apps/web/app/components/questions/ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx) baris 76.

**Penyebab:** Perubahan jawaban mengirim request yang dapat berjalan bersamaan tanpa revision per soal. Pelacakan in-flight memakai Set ID soal sehingga penyelesaian request pertama dapat menghapus tanda ketika request kedua masih berjalan. Tidak ada jaminan server menerapkan jawaban terbaru.

**Skenario/verifikasi:** Di staging beri delay pada simpan A, ubah cepat menjadi B, biarkan B selesai dahulu lalu A. Periksa database dan status simpan sebelum terminasi otomatis.

**Dampak:** UI dapat menunjukkan B tersimpan tetapi server memegang A. Jalur penutupan yang menilai jawaban server dapat menghasilkan nilai salah.

**Perbaikan yang disarankan:** Gunakan antrean per soal atau revision monoton yang ditegakkan server; status simpan harus terkait revision terbaru dan jumlah request sebenarnya.

**Kriteria selesai:** Pada urutan respons terbalik, reload/terminasi selalu memakai jawaban terakhir yang diakui server; indikator pending tidak hilang terlalu cepat.

<a id="bug-09"></a>

### BUG-09 — Kegagalan localStorage menghentikan autosave ke server

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/web/app/components/questions/ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx) baris 709; [apps/web/app/components/questions/ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx) baris 385.

**Penyebab:** Penulisan localStorage dalam handler jawaban dilakukan sebelum jalur simpan server tanpa perlindungan error yang memadai. QuotaExceededError atau storage yang dinonaktifkan dapat memutus handler setelah state UI berubah.

**Skenario/verifikasi:** Mock localStorage.setItem agar melempar, lalu pilih jawaban. Periksa apakah save server tetap dikirim dan pengguna mendapat peringatan.

**Dampak:** Jawaban tampak dipilih tetapi tidak tersimpan ke server, dan mekanisme retry dapat tidak mencatat kegagalan itu.

**Perbaikan yang disarankan:** Pisahkan kegagalan cache lokal dari autosave jaringan; tangkap error storage dan tampilkan status kemampuan pemulihan offline.

**Kriteria selesai:** Storage penuh/dinonaktifkan tidak menghalangi penyimpanan server dan tidak menghasilkan indikator tersimpan palsu.

<a id="bug-10"></a>

### BUG-10 — Resume sesudah akhir global dapat menutup jalan pemulihan offline

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 137; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 465.

**Penyebab:** Cabang start saat end_time global sudah lewat dapat mengembalikan expiredAttemptId tanpa memfinalisasi attempt in_progress. syncLateAnswers hanya menerima status auto_submitted. Finalisasi dari pembacaan monitoring belum tentu pernah terjadi.

**Skenario/verifikasi:** Siswa offline sampai melewati end_time, tab ditutup, lalu dibuka kembali tanpa proktor membuka monitoring. Attempt masih in_progress dan salinan lokal belum tersinkron.

**Dampak:** Jawaban offline yang seharusnya dapat dipulihkan tertolak karena state server tidak memenuhi prasyarat jalur recovery.

**Perbaikan yang disarankan:** Satukan finalisasi deadline pada layanan yang idempoten sebelum mengembalikan informasi expired; selaraskan recovery dengan kebijakan keamanan SEC-10.

**Kriteria selesai:** Reload setelah deadline memiliki hasil sama dengan/ tanpa monitoring aktif dan tidak kehilangan jawaban sah yang diizinkan kebijakan recovery.

<a id="bug-11"></a>

### BUG-11 — Pemeriksaan soal yang sudah dipakai tidak mengikuti relasi jawaban aktual

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/api/src/questions/questions.service.ts](../apps/api/src/questions/questions.service.ts) baris 191; [apps/api/src/analytics/exam-review.service.ts](../apps/api/src/analytics/exam-review.service.ts) baris 50.

**Penyebab:** Jalur hapus memeriksa tabel snapshot cbt_exam_attempt_questions, sementara alur saat ini memakai bank soal dan cbt_answers; tidak ditemukan penulisan snapshot pada source yang diaudit. Soal yang sudah dijawab dapat dianggap belum dipakai lalu dihapus secara fisik.

**Skenario/verifikasi:** Pada staging dengan schema nyata, jawab sebuah soal lalu hapus dari bank. Periksa query snapshot, cbt_answers, opsi, dan review historis.

**Dampak:** Bergantung FK, penghapusan bisa gagal atau menghapus/memutus bukti jawaban dan review historis. Jangan mengasumsikan cascade tertentu tanpa memeriksa database.

**Perbaikan yang disarankan:** Lindungi soal berdasarkan referensi aktual dan gunakan versioned snapshot/soft deletion yang konsisten dengan semua query render dan grading.

**Kriteria selesai:** Mengubah/menghapus bank tidak menghilangkan bukti soal dan jawaban ujian yang telah berlangsung.

<a id="bug-12"></a>

### BUG-12 — Dukungan bank soal legacy tidak konsisten antarjalur

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/api/src/grading/grading.service.ts](../apps/api/src/grading/grading.service.ts) baris 170; [apps/api/src/students/exam-attempts.service.ts](../apps/api/src/students/exam-attempts.service.ts) baris 73; [apps/web/app/components/questions/ExamPage.tsx](../apps/web/app/components/questions/ExamPage.tsx) baris 218.

**Penyebab:** Grading memiliki fallback cbt_exam_question_sources dengan limit satu, sedangkan pengambilan soal dan halaman siswa bergantung question_bank_id langsung. Data legacy/multi-source tidak diperlakukan seragam.

**Skenario/verifikasi:** Gunakan fixture ujian tanpa question_bank_id tetapi dengan question_sources yang valid. Bandingkan tampilan siswa dengan penilaian backend.

**Dampak:** Ujian legacy dapat dinilai tetapi tidak dapat dibuka atau hanya memakai bank pertama. Relevansi operasional bergantung keberadaan data legacy; belum diverifikasi terhadap database.

**Perbaikan yang disarankan:** Putuskan dukungan multi-bank/legacy secara eksplisit: migrasikan dan tolak state lama, atau gunakan satu resolver sumber yang konsisten di seluruh jalur.

**Kriteria selesai:** Semua ujian yang dianggap valid oleh backend dapat dirender dan dinilai dengan himpunan soal yang identik.

<a id="bug-13"></a>

### BUG-13 — Ujian public dapat diterbitkan tetapi tidak muncul di daftar siswa

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/proktor/exams/page.tsx](../apps/web/app/dashboard/proktor/exams/page.tsx) baris 1175; [apps/api/src/students/students.service.ts](../apps/api/src/students/students.service.ts) baris 179.

**Penyebab:** UI mengizinkan publish ketika metadata.is_public aktif meski tanpa target, tetapi listExams membentuk daftar dari target kelas dan peserta individual tanpa memasukkan kebijakan public.

**Skenario/verifikasi:** Terbitkan ujian public tanpa target kelas/peserta, lalu buka jadwal siswa di organisasi yang sama.

**Dampak:** Pembuat mengira ujian tersedia umum tetapi siswa tidak dapat menemukannya. Perbaikannya harus diselaraskan dengan pembatasan akses langsung SEC-01.

**Perbaikan yang disarankan:** Definisikan public untuk organisasi atau publik internet, lalu terapkan aturan yang sama pada daftar, detail, start, dan UI penerbitan.

**Kriteria selesai:** Ujian public tampil hanya untuk audiens yang dimaksud; ujian private tetap mengikuti penugasan.

<a id="bug-14"></a>

### BUG-14 — Hook React diletakkan setelah conditional return

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/components/questions/ExamViewer.tsx](../apps/web/app/components/questions/ExamViewer.tsx) baris 255; [apps/web/app/components/questions/forms/QuestionForms.tsx](../apps/web/app/components/questions/forms/QuestionForms.tsx) baris 68.

**Penyebab:** ExamViewer mengembalikan tampilan kosong sebelum hook state dokumen/video, dan QuestionForms berhenti ketika tipe tidak dikenali sebelum rangkaian useCallback. ESLint melaporkan total 24 pelanggaran rules-of-hooks pada pola ini.

**Skenario/verifikasi:** Render komponen lalu transisikan questions dari kosong ke berisi tanpa remount; pada form transisikan tipe tidak dikenali menjadi valid. Verifikasi di browser/test komponen.

**Dampak:** Jika transisi tersebut terjadi pada instance yang sama, React dapat gagal karena jumlah/urutan hook berubah. Belum dibuktikan lewat browser untuk setiap pemanggil.

**Perbaikan yang disarankan:** Pindahkan seluruh hook sebelum conditional return atau pisahkan komponen untuk state kosong dan state valid.

**Kriteria selesai:** Transisi kosong/berisi/tipe invalid tidak menimbulkan error hook; lint rules-of-hooks bersih.

<a id="bug-15"></a>

### BUG-15 — Regrade dapat menimpa nilai esai yang sudah dinilai manual

**Prioritas:** P1. **Bukti:** S. **Lokasi:** [apps/api/src/grading/grading.service.ts](../apps/api/src/grading/grading.service.ts) baris 190; [apps/scoring/app/services/grading.py](../apps/scoring/app/services/grading.py) baris 72.

**Penyebab:** regradeAttempt mengirim esai ke scoring yang mengembalikan score 0 dan is_correct null, lalu menulis kembali setiap item ke cbt_answers dan total scaled_score. Nilai manual sebelumnya tidak ikut dimuat/dipertahankan dan status manual tidak diperbarui selaras.

**Skenario/verifikasi:** Nilai esai secara manual, lalu ubah kunci salah satu soal yang memicu regrade ujian tersebut. Bandingkan skor esai, total, dan needs_manual_grading sebelum/sesudah.

**Dampak:** Nilai manual dapat terhapus menjadi nol, sementara pengerjaan masih tampak sudah selesai dinilai.

**Perbaikan yang disarankan:** Pisahkan komponen skor otomatis dan manual; regrade otomatis tidak boleh menimpa nilai manual. Agregasikan ulang keduanya menggunakan denominator akademik yang sama.

**Kriteria selesai:** Edit kunci soal objektif mengubah hanya skor yang terkait dan menjaga nilai/feedback esai serta status grading yang benar.

<a id="bug-16"></a>

### BUG-16 — Pilihan duplikat dapat memanipulasi skor

**Prioritas:** P1. **Bukti:** R. **Lokasi:** [apps/scoring/app/services/grading.py](../apps/scoring/app/services/grading.py) baris 92; [apps/scoring/app/services/grading.py](../apps/scoring/app/services/grading.py) baris 100.

**Penyebab:** MCQ kompleks membandingkan panjang array dan membership tanpa keunikan; checklist menjumlahkan bobot setiap kemunculan ID. Parser tidak menghapus duplikat. Pola membership serupa pada matching/kategorisasi juga perlu diuji.

**Skenario/verifikasi:** Reproduksi mesin penilaian asli: kunci [a,b] dengan jawaban [a,a] mendapat 10/10; checklist satu opsi bobot 2 dikirim tiga kali menghasilkan dimensi 6.

**Dampak:** Siswa yang memodifikasi payload dapat memperoleh skor tidak sesuai jawaban atau menaikkan hasil psikometri. UI pilihan biasa bukan pembatas keamanan.

**Perbaikan yang disarankan:** Validasi jawaban per tipe: ID harus unik, berasal dari soal, jumlah/ranking valid. Untuk himpunan jawaban gunakan kesetaraan set setelah validasi, bukan panjang+membership saja.

**Kriteria selesai:** Duplikat/ID asing ditolak atau dinormalisasi secara konsisten; a,a tidak pernah menggantikan a,b dan checklist tidak menggandakan bobot.

<a id="ux-01"></a>

### UX-01 — Dashboard pengawas menampilkan statistik dan kejadian contoh sebagai data aktif

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/pengawas/page.tsx](../apps/web/app/dashboard/pengawas/page.tsx) baris 31; [apps/web/app/dashboard/pengawas/monitoring/page.tsx](../apps/web/app/dashboard/pengawas/monitoring/page.tsx) baris 1.

**Penyebab:** Angka siswa aktif, kesehatan sistem, dan aktivitas Budi/Siti ditulis statis. Halaman monitoring pengawas masih berupa placeholder, sementara tampilan dashboard memberi kesan data operasional.

**Skenario/verifikasi:** Masuk sebagai pengawas pada dua kondisi database berbeda; kode tetap menghasilkan angka dan kejadian yang sama.

**Dampak:** Petugas dapat menyimpulkan keadaan ujian dari data contoh dan melewatkan kejadian nyata.

**Perbaikan yang disarankan:** Hubungkan ke API dengan izin pengawas yang sesuai, atau beri label demonstrasi/belum tersedia yang jelas dan hilangkan indikator live palsu.

**Kriteria selesai:** Tidak ada angka/nama kejadian contoh pada layar produksi; data memiliki waktu pembaruan serta status gagal/kosong.

<a id="ux-02"></a>

### UX-02 — Kegagalan API disamarkan menjadi daftar kosong

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/lib/api/students.ts](../apps/web/lib/api/students.ts) baris 52; [apps/web/app/dashboard/siswa/results/page.tsx](../apps/web/app/dashboard/siswa/results/page.tsx) baris 10.

**Penyebab:** Sejumlah helper daftar mengembalikan [] saat request gagal. Halaman tidak dapat membedakan belum ada ujian/hasil dari gangguan API atau sesi.

**Skenario/verifikasi:** Paksa respons 500 atau putuskan jaringan saat memuat jadwal/hasil/kelas, lalu lihat empty state.

**Dampak:** Siswa mengira ujian/hasil hilang dan tidak mendapat tindakan retry atau login yang tepat.

**Perbaikan yang disarankan:** Gunakan hasil bertipe data/error dan state loading/error/empty yang berbeda; pertahankan data terakhir dengan penanda stale bila sesuai.

**Kriteria selesai:** 401, 403, offline, 500, dan data kosong memberikan pesan serta tindakan yang berbeda dan dapat diakses.

<a id="ux-03"></a>

### UX-03 — Fallback autentikasi dapat tetap menampilkan loading tanpa jalan keluar

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/layout.tsx](../apps/web/app/dashboard/layout.tsx) baris 43; [apps/web/app/dashboard/layout.tsx](../apps/web/app/dashboard/layout.tsx) baris 29.

**Penyebab:** Safety timer dapat menyetel authChecked saat pemuatan sesi belum menghasilkan konteks role; rendering tetap bergantung activeRoleCtx. Cabang catch juga dapat menyisakan state ini.

**Skenario/verifikasi:** Buat getSessionUser menggantung atau gagal sebelum role tersedia, tunggu melewati timer keselamatan.

**Dampak:** Pengguna terjebak pada layar memuat, tanpa retry atau penjelasan kegagalan.

**Perbaikan yang disarankan:** Gunakan state autentikasi eksplisit (loading/authenticated/unauthenticated/error), timeout request yang nyata, dan aksi retry/login.

**Kriteria selesai:** Setiap kegagalan atau timeout berakhir pada tampilan yang dapat ditindaklanjuti; tidak ada spinner tanpa batas.

<a id="ux-04"></a>

### UX-04 — Daftar hasil menyebut pengerjaan aktif sebagai selesai

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/api/src/students/students.service.ts](../apps/api/src/students/students.service.ts) baris 296; [apps/web/app/dashboard/siswa/results/page.tsx](../apps/web/app/dashboard/siswa/results/page.tsx) baris 109.

**Penyebab:** listResults tidak membatasi status selesai, sedangkan UI memakai label SELESAI dan jumlah hasil sebagai total ujian selesai.

**Skenario/verifikasi:** Mulai ujian tanpa submit lalu buka halaman hasil dari sesi lain atau setelah keluar dari pengerjaan.

**Dampak:** Status dan ringkasan progres menyesatkan; agregasi yang memakai data ini dapat memasukkan pengerjaan belum selesai.

**Perbaikan yang disarankan:** Filter status final di backend untuk hasil atau tampilkan status aktual serta pisahkan pengerjaan berjalan.

**Kriteria selesai:** Attempt in_progress tidak pernah diberi label selesai; hitungan dan rerata mengikuti definisi yang sama.

<a id="ux-05"></a>

### UX-05 — Hitungan jawaban salah dapat negatif setelah penilaian esai

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/proktor/monitoring/[attemptId]/page.tsx](../apps/web/app/dashboard/proktor/monitoring/[attemptId]/page.tsx) baris 95.

**Penyebab:** Statistik memakai total - correct - jumlah_esai. Esai berskor positif dapat ditandai is_correct true sehingga terhitung dalam correct sekaligus dikurangi sebagai esai.

**Skenario/verifikasi:** Gunakan pengerjaan berisi satu esai yang sudah mendapat skor positif: total 1, correct 1, essays 1 menghasilkan wrong -1.

**Dampak:** Ringkasan monitoring admin/proktor/guru membingungkan dan tidak sesuai distribusi jawaban.

**Perbaikan yang disarankan:** Hitung benar/salah hanya pada tipe objektif dan pisahkan kategori esai dinilai/belum dinilai; jangan hanya clamp angka negatif.

**Kriteria selesai:** Kategori statistik saling lepas dan jumlahnya sesuai total untuk ujian objektif, esai, serta campuran.

<a id="ux-06"></a>

### UX-06 — Waktu hasil dan jadwal menggunakan zona waktu berbeda

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/siswa/results/page.tsx](../apps/web/app/dashboard/siswa/results/page.tsx) baris 38; [apps/web/app/dashboard/siswa/schedule/page.tsx](../apps/web/app/dashboard/siswa/schedule/page.tsx) baris 104.

**Penyebab:** Halaman hasil memakai UTC sedangkan jadwal menggunakan konvensi WIB. Konteks proyek menyebut sekolah di Gowa, sehingga zona yang dimaksud perlu diputuskan secara eksplisit; lokasi saja tidak membuktikan pilihan WIB salah.

**Skenario/verifikasi:** Bandingkan timestamp yang sama pada jadwal, hasil, detail, dan penilaian serta perangkat dengan zona berbeda.

**Dampak:** Jam tampil bergeser antarhalaman dan dapat membingungkan batas pengerjaan atau waktu pengumpulan.

**Perbaikan yang disarankan:** Gunakan formatter bersama dengan zona waktu sekolah yang dikonfigurasi, tampilkan label zona, dan simpan waktu server sebagai instant UTC.

**Kriteria selesai:** Instant sama tampil konsisten pada semua halaman dan zona browser; tanggal dekat tengah malam juga benar.

<a id="ux-07"></a>

### UX-07 — Navigasi kartu dan kontrol toggle tidak sepenuhnya dapat diakses dengan keyboard

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/siswa/results/page.tsx](../apps/web/app/dashboard/siswa/results/page.tsx) baris 69; [apps/web/app/dashboard/notifications/settings/page.tsx](../apps/web/app/dashboard/notifications/settings/page.tsx) baris 167.

**Penyebab:** Kartu hasil interaktif menggunakan div/motion.div tanpa semantik link/button atau keyboard setara. Toggle notifikasi perlu nama aksesibel, state aria-checked, dan semantik switch; tampilan visual saja tidak menyampaikan status kepada pembaca layar.

**Skenario/verifikasi:** Navigasikan hasil hanya dengan Tab/Enter/Space dan baca label toggle dengan pembaca layar. Inventaris menandai kandidat clickable div untuk pemeriksaan lanjutan, bukan semuanya otomatis dianggap cacat.

**Dampak:** Pengguna keyboard atau pembaca layar dapat gagal membuka hasil atau mengetahui status pengaturan.

**Perbaikan yang disarankan:** Gunakan link/button native, label programatis, fokus terlihat, serta role/state switch yang sesuai. Audit modal bersama untuk fokus, Escape, dan pengembalian fokus.

**Kriteria selesai:** Seluruh aksi utama dapat dijalankan tanpa mouse dan status toggle diumumkan dengan benar; modal diuji manual di staging.

<a id="ux-08"></a>

### UX-08 — Respons monitoring lama dapat menimpa ujian yang baru dipilih

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/proktor/monitoring/page.tsx](../apps/web/app/dashboard/proktor/monitoring/page.tsx) baris 65; [apps/web/app/dashboard/proktor/monitoring/page.tsx](../apps/web/app/dashboard/proktor/monitoring/page.tsx) baris 72.

**Penyebab:** loadExamData menulis state ketika respons selesai tanpa memastikan examId masih aktif. Beralih cepat A ke B memungkinkan respons A terlambat menimpa data B. Jalur liveAlerts memiliki penanganan tersendiri dan bukan dasar temuan ini.

**Skenario/verifikasi:** Perlambat request ujian A, pilih B, lalu biarkan A selesai terakhir.

**Dampak:** Nama ujian terpilih dapat tidak cocok dengan peserta/statistik yang ditampilkan; petugas berisiko bertindak atas baris yang tidak dimaksud.

**Perbaikan yang disarankan:** Gunakan abort/request generation atau cache keyed by examId; validasi konteks lagi sebelum aksi reset/terminate.

**Kriteria selesai:** Respons stale diabaikan dan semua baris/aksi selalu terikat ujian yang terlihat.

<a id="ux-09"></a>

### UX-09 — Detail jadwal PAS tidak menjelaskan hasil pembuatan parsial

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/proktor/exams/pas/[id]/page.tsx](../apps/web/app/dashboard/proktor/exams/pas/[id]/page.tsx) baris 144; [apps/api/src/pas/pas-schedules.service.ts](../apps/api/src/pas/pas-schedules.service.ts) baris 225.

**Penyebab:** API mengembalikan created dan skipped, tetapi halaman detail PAS admin/proktor hanya memberitakan created. Halaman daftar ujian sudah menampilkan skipped; masalah dibatasi pada detail PAS.

**Skenario/verifikasi:** Pilih beberapa jadwal dengan salah satunya invalid/terlewati, jalankan generate di detail PAS.

**Dampak:** Operator tidak mengetahui jadwal mana yang gagal atau alasan kegagalan dan sulit melanjutkan pekerjaan yang tersisa.

**Perbaikan yang disarankan:** Tampilkan ringkasan sukses/terlewati/gagal per jadwal, simpan item yang belum selesai, dan sediakan retry yang aman.

**Kriteria selesai:** Jumlah dan identitas seluruh hasil cocok dengan pilihan awal; tidak ada kegagalan parsial yang tersembunyi.

<a id="ux-10"></a>

### UX-10 — Notifikasi lama tidak memiliki jalur pagination yang jelas

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/api/src/notifications/notifications.service.ts](../apps/api/src/notifications/notifications.service.ts) baris 56; [apps/web/app/dashboard/notifications/page.tsx](../apps/web/app/dashboard/notifications/page.tsx) baris 25.

**Penyebab:** Halaman meminta batch 50 notifikasi terbaru dan filter UI berjalan atas data yang dimuat, sedangkan unreadCount/markAllRead menjangkau seluruh data pengguna. Tidak tersedia pemuatan halaman lama pada layar ini.

**Skenario/verifikasi:** Buat lebih dari 50 notifikasi dengan notifikasi lama belum dibaca; bandingkan badge, filter unread, dan aksi tandai semua.

**Dampak:** Badge dapat menyatakan ada notifikasi yang tidak dapat dijangkau melalui daftar; tandai semua dapat mengubah item yang belum pernah terlihat.

**Perbaikan yang disarankan:** Tambahkan pagination/cursor dan filter server-side; jelaskan scope tandai semua atau sediakan opsi untuk yang terlihat saja.

**Kriteria selesai:** Seluruh notifikasi dapat diakses, hitungan sesuai filter/scope, dan aksi massal mempunyai cakupan yang dipahami pengguna.

<a id="ux-11"></a>

### UX-11 — Ekspor jawaban analitik kehilangan isi tipe soal kompleks

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/guru/analytics/exam/[id]/page.tsx](../apps/web/app/dashboard/guru/analytics/exam/[id]/page.tsx) baris 147.

**Penyebab:** Ekspor memperlakukan esai sebagai teks dan tipe lainnya melalui selected_option_id tunggal. Jawaban kompleks yang tersimpan di essay_answer sebagai JSON tidak diterjemahkan ke keluaran yang tepat.

**Skenario/verifikasi:** Ekspor hasil yang berisi MCQ kompleks, matching, ranking, atau checklist dengan jawaban valid.

**Dampak:** Kolom laporan dapat berisi tanda kosong walau siswa sudah menjawab, sehingga audit nilai lewat spreadsheet menyesatkan.

**Perbaikan yang disarankan:** Gunakan serializer jawaban per tipe yang sama dengan review, dengan label terbaca dan representasi mentah opsional untuk audit.

**Kriteria selesai:** Jawaban semua tipe soal dapat ditelusuri dari ekspor ke jawaban tersimpan tanpa kehilangan informasi.

<a id="ux-12"></a>

### UX-12 — Indikator tren dapat menyatakan naik saat nilai menurun

**Prioritas:** P2. **Bukti:** S. **Lokasi:** [apps/api/src/analytics/student-analytics.service.ts](../apps/api/src/analytics/student-analytics.service.ts) baris 7.

**Penyebab:** Untuk dua atau tiga skor, slice(0,-3) kosong sehingga olderAvg menjadi nol. recentAvg positif dibanding nol menghasilkan up meskipun skor terakhir turun.

**Skenario/verifikasi:** Dengan riwayat kronologis [90,60], perhitungan menghasilkan recentAvg 75 dan olderAvg 0, lalu up.

**Dampak:** Analitik memberikan umpan balik belajar yang berlawanan dengan perubahan nilai aktual.

**Perbaikan yang disarankan:** Gunakan dua jendela yang sama-sama berisi data atau tampilkan belum cukup data. Definisikan urutan waktu dan ambang tren secara konsisten.

**Kriteria selesai:** Uji 0/1/2/3/4/6 skor, tren naik/turun/stabil, dan urutan riwayat; tidak membandingkan dengan kelompok kosong.

<a id="qa-01"></a>

### QA-01 — Lint frontend belum menjadi pemeriksaan kualitas yang lulus

**Prioritas:** P2. **Bukti:** T. **Lokasi:** [apps/web/eslint.config.mjs](../apps/web/eslint.config.mjs) baris 19.

**Penyebab:** Pemeriksaan ESLint frontend menghasilkan 1.367 error dan 653 warning. Ini mencakup 24 rules-of-hooks, 34 immutability, 41 set-state-in-effect, 9 refs, serta banyak any/unused; jumlah diagnostik bukan jumlah bug unik.

**Skenario/verifikasi:** Jalankan ESLint dari apps/web sesuai perintah pada lampiran pengujian. Hasil mentah disertakan.

**Dampak:** Pelanggaran yang memengaruhi perilaku mudah tenggelam di antara utang lint; lulus TypeScript belum membuktikan hook/state benar.

**Perbaikan yang disarankan:** Prioritaskan rules-of-hooks, immutability, refs dan purity; kelompokkan per akar masalah. Tetapkan baseline sementara yang tidak mengizinkan pelanggaran baru, lalu kurangi bertahap.

**Kriteria selesai:** Pemeriksaan CI membedakan baseline lama dari regresi baru dan seluruh pelanggaran yang dapat menyebabkan kegagalan runtime sudah diselesaikan.

<a id="qa-02"></a>

### QA-02 — Pengujian yang tersedia belum mencakup integritas alur lintas layanan

**Prioritas:** P2. **Bukti:** T. **Lokasi:** [apps/scoring/pyproject.toml](../apps/scoring/pyproject.toml) baris 1.

**Penyebab:** 78 tes scoring yang dijalankan lulus, tetapi reproduksi BUG-16 juga berhasil. Pemeriksaan TypeScript tidak memvalidasi kontrak HTTP, otorisasi per resource, transaksi submit, ataupun backup round-trip.

**Skenario/verifikasi:** Bandingkan tes yang ada dengan matriks kasus pada RENCANA_UJI.md. Reproduksi audit sengaja membuktikan cacat, bukan tes regresi yang menyatakan sistem benar.

**Dampak:** Kesamaan perilaku grading lama/baru dan kompilasi bersih dapat memberikan rasa aman meskipun integritas nilai serta kontrol akses masih bermasalah.

**Perbaikan yang disarankan:** Tambahkan tes negatif multiaktor, kontrak antarservice, fault injection submit/restore, dan kasus adversarial parser sebelum menambah snapshot kosmetik.

**Kriteria selesai:** Kasus prioritas P1 pada rencana uji mempunyai tes regresi yang gagal sebelum perbaikan dan lulus sesudahnya.

<a id="qa-03"></a>

### QA-03 — Halaman role yang diduplikasi memperbesar risiko perbaikan tidak merata

**Prioritas:** P3. **Bukti:** S. **Lokasi:** [apps/web/app/dashboard/proktor/questions/[bankId]/page.tsx](../apps/web/app/dashboard/proktor/questions/[bankId]/page.tsx) baris 392; [apps/web/app/dashboard/admin/questions/[bankId]/page.tsx](../apps/web/app/dashboard/admin/questions/[bankId]/page.tsx) baris 392.

**Penyebab:** Banyak halaman admin/proktor/guru membawa implementasi serupa yang terpisah. Salah satu jejak kode mati adalah handleExportTemplate yang menunjuk template_soal.docx tanpa pemanggil yang ditemukan; ini tidak dihitung sebagai tombol rusak yang terbukti dapat diklik.

**Skenario/verifikasi:** Bandingkan implementasi ujian, bank soal, monitoring dan statistik antarrole saat menerapkan perbaikan.

**Dampak:** Bug dapat bertahan di salah satu role meskipun role lain sudah diperbaiki; kode mati dan helper lama menyulitkan penelusuran.

**Perbaikan yang disarankan:** Satukan komponen dan layanan alur yang sama dengan kebijakan role eksplisit; bersihkan kode mati setelah memastikan tidak ada pemanggil dinamis.

**Kriteria selesai:** Perbaikan bersama diverifikasi untuk semua role dan izin tetap berada di backend, bukan hanya props UI.

## Hal yang perlu diverifikasi sebelum kesimpulan tambahan

1. Periksa rate limit login/API di reverse proxy dan layanan auth; tidak terlihat throttling lokal bukan bukti bahwa deployment tidak memilikinya.
2. Pastikan BACKUP_SECRET_KEY wajib disediakan. Kode memiliki fallback konstan; keberadaan fallback tidak membuktikan deployment memakainya. Gagalkan startup/operasi bila konfigurasi penting kosong.
3. Periksa kebijakan cookie, issuer/audience JWT, siklus sesi/logout, CORS/CSRF, security headers, dan batas request terhadap konfigurasi nyata. Jangan menyimpulkan token dapat dipalsukan hanya dari payload yang dapat dibaca.
4. Uji format jawaban malformed untuk setiap tipe (angka/null/objek bersarang/array besar), serta dampaknya pada satu batch scoring. BUG-16 baru membuktikan dua kasus duplikasi.
5. Audit semua penggunaan HTML kaya, sanitizer, SVG, PDF, dan URL eksternal secara end-to-end. Origin terpisah dan sandbox browser dapat mengubah dampak; tidak ada klaim stored XSS terkonfirmasi dalam laporan ini.
6. Verifikasi FK, indeks unik, transaksi, dan isolasi organisasi pada schema database yang benar-benar terpasang. Lakukan read-only review schema terpisah dari database sekolah jika memungkinkan.
7. Jalankan dependency advisory scan terkini atas lockfile pada lingkungan yang disetujui; audit ini tidak menganggap versi tertentu aman atau rentan tanpa data advisory.
8. Uji browser ponsel/desktop, zoom 200%, fokus, kontras terukur, screen reader, koneksi lambat, offline, dan pulih jaringan. Temuan UI di sini bersumber dari kode, bukan penilaian visual lengkap.

## Rencana pelaksanaan perbaikan

1. Buat fixture staging terisolasi: dua organisasi, dua guru, dua kelas, dua siswa, seluruh tipe soal, serta attempt tiap status. Jangan memakai data pribadi asli.
2. Tutup akses lintas resource dan kebocoran kunci. Jadikan kebijakan kelayakan ujian, rilis hasil, dan kepemilikan resource satu sumber aturan server.
3. Perbaiki state machine attempt, deadline, idempotensi, autosave revision, persist atomik, dan pelestarian nilai manual. Sertakan BUG-16 dalam tes grading.
4. Standarkan kontrak upload lalu desain ulang validasi dan atomicity backup/restore. Jalankan round-trip sebelum mengandalkan backup aplikasi untuk pemulihan.
5. Perbaiki status/error UI, monitoring, informasi waktu, aksesibilitas, dan laporan analitik. Terapkan ke seluruh role melalui komponen bersama.
6. Jalankan matriks regresi, lint yang diprioritaskan, build produksi, serta uji beban sesuai jumlah peserta yang benar-benar ditargetkan. Catat hasil dan risiko tersisa sebelum rilis.

## Lampiran

- [Matriks seluruh halaman](audit-2026-09-19/MATRIKS_HALAMAN.md)
- [Rencana uji dan reproduksi](audit-2026-09-19/RENCANA_UJI.md)
- [Daftar temuan terstruktur](audit-2026-09-19/findings.json)
- [Inventaris sumber beserta hash](audit-2026-09-19/inventory.json)
- [Hasil ESLint lengkap](audit-2026-09-19/eslint-web.json)

Nomor baris merujuk baseline audit dan dapat bergeser setelah perbaikan. Source anchor disimpan di findings.json agar lokasi tetap mudah ditemukan.
