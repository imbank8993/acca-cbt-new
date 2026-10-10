# Audit jawaban, nilai, dan integritas ujian — 10 Oktober 2026

> Bagian audit di bawah mencatat kondisi sebelum perbaikan. Implementasi perbaikan sudah ditambahkan pada 10 Oktober 2026; lihat [catatan perbaikan](perbaikan-ujian-2026-10-10.md). Skrip reproduksi sekarang menjalankan regression test yang mengharapkan perilaku aman.

## Kesimpulan

Alur submit normal sudah mempunyai pengaman yang baik, tetapi belum dapat dinyatakan sepenuhnya andal. Audit menemukan **10 masalah**, dengan **9 reproduksi memakai data buatan** dan satu masalah pemulihan nilai yang ditelusuri dari pemanggil dalam kode. Dampak terpenting: nilai dapat menjadi nol ketika pembacaan jawaban gagal, nilai esai kuis dapat tertimpa, snapshot historis berubah, dan hasil pekerjaan lama dapat menimpa sesi yang sudah direset.

Ini audit kode lokal dan pengujian terisolasi, bukan verifikasi rekaman siswa di database produksi. Tidak ada jawaban siswa atau kode aplikasi yang diubah. Skrip tambahan hanya menggunakan fixture di memori. Tidak ada jaminan audit ini mencakup seluruh kerentanan sistem, konfigurasi deployment, atau dependensi pihak ketiga.

P1 = perlu diprioritaskan sebelum ujian penting; P2 = perlu diperbaiki karena dapat mengganggu integritas atau pemulihan pada kondisi tertentu.

## Temuan

### 1. P1 — Kegagalan membaca jawaban dianggap sebagai jawaban kosong saat regrade

Lokasi: `apps/api/src/grading/grading.service.ts:198`.

`regradeAttempt()` mengambil `data: saved` tanpa memeriksa `error`. Adapter database mengembalikan objek error, sehingga hasil baca yang gagal dapat diteruskan sebagai array kosong. Mesin penilaian kemudian menerima jawaban null dan total nol ditulis ke attempt.

Reproduksi: attempt bernilai 100, query `cbt_answers` dibuat gagal, lalu regrade selesai dengan `total_score = 0`. Jawaban asli tetap ada. Ini bukan sekadar tampilan nilai yang gagal dimuat.

Perbaikan: hentikan regrade sebelum memanggil scoring bila pembacaan gagal; simpan nilai terakhir dan antrekan retry yang dapat dipantau.

### 2. P1 — Pengeditan bank soal menimpa snapshot seluruh ujian, termasuk ujian historis

Lokasi: `apps/api/src/common/exam-question-snapshots.ts:122`, `apps/api/src/questions/questions.service.ts:178`.

`updateExamQuestionSnapshots()` memperbarui semua snapshot berdasarkan `question_id`, tanpa filter ujian aktif, status selesai, atau arsip. `save()` memanggilnya dan kemudian memicu penilaian ulang. Perubahan soal untuk penggunaan berikutnya dapat mengubah bobot/kunci dan hasil ujian lama. Guru yang berhak mengedit bank juga dapat memengaruhi ujian pemakai bank itu tanpa pemeriksaan otorisasi per ujian pada jalur ini.

Reproduksi: snapshot ujian yang sudah submitted dengan bobot 1 berubah menjadi 5 setelah bank diedit.

Perbaikan: pertahankan versi historis; koreksi ujian tertentu harus menjadi tindakan tersendiri dengan cakupan ujian, otorisasi, jejak audit, dan penilaian ulang yang eksplisit.

### 3. P1 — Regrade lama dapat menimpa sesi yang sudah direset, termasuk metadata pemulihan

Lokasi: `apps/api/src/grading/grading.service.ts:183–256`.

Regrade membaca attempt/jawaban, menunggu layanan scoring, lalu menulis berdasarkan ID saja. Tidak ada validasi ulang status, generasi sesi, atau waktu selesai. Pemilihan attempt terdampak juga tidak dibatasi pada attempt selesai. Metadata yang dibaca sebelum scoring ditulis ulang sesudahnya.

Reproduksi: reset disisipkan saat scoring berlangsung. Attempt tetap `in_progress`, tetapi totalnya kembali 100 dan flag `recovery_submit_only` yang dipasang reset hilang. Selain nilai salah, ini dapat menghilangkan pembatasan pemulihan khusus submit.

Perbaikan: gunakan versi/generasi attempt dan transaksi dengan row lock untuk penerapan hasil; batalkan hasil usang; gabungkan metadata terbaru, bukan salinan lama; jangan menilai ulang attempt aktif melalui jalur hasil final.

### 4. P1 — Nilai esai kuis dapat kembali ke nilai sebelum dinilai guru

Lokasi: `apps/api/src/teachers/teachers.service.ts:342`, `apps/api/src/grading/grading.service.ts:348`.

Penilaian esai memperbarui `total_score`, tetapi tidak memperbarui `metadata.base_score` atau menerapkan kembali peringkat kuis. Saat peserta lain submit atau pemicu skor relatif berikutnya berjalan, perhitungan menggunakan base score lama.

Reproduksi: kuis esai memiliki base score 0; guru memberi nilai penuh dan total menjadi 100; pemanggilan skor relatif berikutnya mengembalikan total ke 0.

Perbaikan: simpan base score baru secara atomik bersama hasil manual, lalu hitung skor relatif seluruh kuis menggunakan data terbaru.

### 5. P1 — Kegagalan menulis nilai per jawaban diabaikan dan dapat menghasilkan total yang tidak konsisten

Lokasi: `apps/api/src/grading/grading.service.ts:229–256`.

Regrade menulis setiap nilai jawaban dan total attempt secara terpisah, tanpa transaksi dan tanpa memeriksa `error` yang dikembalikan setiap update. Kegagalan sebagian dapat meninggalkan total baru dengan rincian nilai lama; fungsi tetap selesai tanpa error.

Reproduksi: update nilai jawaban dibuat gagal; skor jawaban tetap 1, total attempt menjadi 0, dan pemanggil menerima penyelesaian normal.

Perbaikan: periksa setiap hasil penulisan dan terapkan seluruh perubahan nilai dalam satu transaksi setelah memverifikasi versi attempt/soal.

### 6. P2 — Gagal membaca jawaban saat melanjutkan ujian ditampilkan sebagai tidak ada jawaban

Lokasi: `apps/api/src/students/exam-attempts.service.ts:394`, `apps/web/app/components/questions/ExamPage.tsx:619`.

`resume()` mengabaikan error pembacaan `cbt_answers` dan mengembalikan `started: true, answers: []`. Jika cache lokal tidak tersedia, siswa melihat soal kosong walaupun server memiliki jawabannya. Nomor revisi lokal juga tidak dipulihkan, sehingga edit berikutnya bisa bertabrakan dengan revisi server.

Reproduksi: terdapat satu jawaban tersimpan; pembacaannya gagal; resume tetap berhasil dengan array kosong.

Perbaikan: bedakan kegagalan baca dari nol jawaban; tampilkan status pemulihan dan retry sebelum membuka editor atau menulis ulang snapshot lokal. Reproduksi ini membuktikan respons kosong, bukan penghapusan baris jawaban di database.

### 7. P2 — Pembatasan perangkat tidak berlaku untuk pengambilan soal dan dapat disalin

Lokasi: `apps/api/src/students/exam-attempts.service.ts:86`, `apps/api/src/students/students.controller.ts:126`, `apps/web/lib/device-id.ts:15`.

Endpoint soal/polling memeriksa identitas akun dan attempt aktif, tetapi tidak memeriksa perangkat. Akun yang sama di perangkat kedua dapat mengambil soal selama attempt perangkat pertama aktif. Untuk jalur tulis, identitas perangkat adalah string yang disimpan di localStorage dan dikirim klien, sehingga menyalin string bersama akses akun dapat melewati pembandingan perangkat.

Reproduksi: pengambilan soal berhasil hanya dengan identitas akun pemilik, tanpa bukti perangkat yang terikat. Ini bukan akses tanpa login dan bukan bukti akses ke akun siswa lain.

Perbaikan: tegakkan sesi ujian pada seluruh endpoint dan server-side session lease. Untuk persyaratan anti-berbagi yang kuat, gunakan tantangan dengan kunci perangkat yang tidak mudah diekspor serta pengawasan; string fingerprint bukan bukti perangkat keras. Pengaman browser tetap memiliki keterbatasan jika pemilik akun sengaja berbagi akses.

### 8. P2 — Penilaian esai memeriksa status sebelum lock, sehingga dapat menulis setelah reset

Lokasi: `apps/api/src/teachers/teachers.service.ts:264–312`.

Status selesai diperiksa sebelum transaksi. Setelah mendapatkan row lock, status/generasi tidak dibaca ulang. Reset yang selesai di sela pemeriksaan dan pengambilan lock dapat disusul penulisan nilai guru ke attempt aktif.

Reproduksi: reset ditempatkan tepat sebelum transaksi grading; status akhir `in_progress` tetapi total diubah menjadi 100.

Perbaikan: verifikasi kembali status selesai dan generasi attempt setelah mendapatkan lock; tolak halaman penilaian yang berasal dari generasi lama.

### 9. P2 — Esai kosong pada auto-submit dapat selamanya menunggu penilaian tanpa baris untuk dinilai

Lokasi: `apps/api/src/grading/grading.service.ts:34`, `apps/api/src/grading/grading.service.ts:148`, `apps/api/src/teachers/teachers.service.ts:232`.

Jalur submit normal membuat baris esai kosong. Jalur penilaian dari jawaban tersimpan hanya memperbarui baris yang sudah ada. Esai yang belum pernah disimpan tetap tidak memiliki baris, tetapi pemeriksaan manual menandainya pending. Halaman guru hanya memuat baris jawaban yang ada dan endpoint nilai memerlukan ID baris tersebut.

Reproduksi: satu esai tanpa jawaban menghasilkan `hasEssay: true`, nol baris jawaban, dan daftar esai guru kosong.

Perbaikan: buat baris esai kosong secara idempoten ketika menutup attempt, atau terapkan kebijakan eksplisit esai kosong bernilai nol yang selesai dinilai.

### 10. P2 — Pemulihan penilaian tertunda bergantung pada halaman monitoring

Lokasi: `apps/api/src/proctor/exam-monitoring.service.ts:349`, `apps/api/src/grading/grading.service.ts:400`.

Dari penelusuran pemanggil di repository, `retryPendingAutoSubmissions()` hanya dipanggil oleh alur monitoring. Halaman hasil siswa dan retry submit yang sudah berstatus submitted tidak menjalankan penilaian ulang. Jika scoring gagal dan tidak ada monitoring yang memicu retry, jawaban tetap aman tetapi nilai dapat terus null setelah layanan pulih.

Bukti: penelusuran statis pemanggil; bukan pengamatan pada deployment. Scheduler eksternal di luar repository belum diverifikasi.

Perbaikan: worker terjadwal untuk antrean nilai null, dengan retry/backoff, metrik usia antrean, serta batas kegagalan yang tidak membuat pekerjaan baru tertahan di belakang pekerjaan lama.

## Risiko tambahan yang belum dikonfirmasi secara operasional

- Endpoint jawaban menerima array dan teks tanpa batas jumlah/panjang khusus DTO; batas badan request global 10 MB. Tidak ditemukan rate limiter pada jalur ujian dalam aplikasi yang diperiksa. Pembatasan di reverse proxy belum diperiksa. Perlu uji beban terkontrol untuk menilai risiko konsumsi memori, waktu transaksi, dan antrean koneksi saat request besar/berulang.
- Koreksi tipe/opsi ketika siswa sedang offline belum mempunyai rekonsiliasi jawaban lintas versi yang jelas. Jawaban lokal dengan format/ID lama dapat ditolak oleh versi snapshot baru. Perlu uji integrasi browser dan database dengan perubahan soal nyata.
- Pembekuan jawaban di browser bukan bukti kriptografis waktu pengerjaan. Implementasi sudah menolak unggahan terlambat tanpa commitment server atau pembukaan pemulihan oleh proktor; proktor tetap perlu menilai konteks pemulihan sebelum menyetujuinya.

## Yang sudah bekerja pada pengujian

- Pemilik attempt, relasi soal/opsi, dan batas waktu server diperiksa pada penyimpanan.
- Transaksi dan row lock melindungi autosave/bulk/submit; revisi lama ditolak.
- Jawaban dan status submit disimpan sebelum memanggil layanan penilaian.
- Submit intent diikat pada digest isi kiriman; payload berbeda tidak memperoleh kelonggaran setelah deadline.
- Retry submit memverifikasi isi dan revisi; cache lokal tidak dianggap selesai hanya karena status submitted.
- Payload siswa menyaring metadata kunci jawaban, dan pelepasan hasil/kunci diperiksa terpisah.
- Rumus penilaian otomatis yang tercakup pengujian Python lulus; temuan utama ada pada lifecycle data dan koordinasi antarpemanggil.

## Validasi dan batas cakupan

- 90 pengujian Node lulus: keamanan sesi siswa, integritas/resiliensi jawaban, deadline, frozen submission, worker pengiriman, grading, kategori scoring, dan retry snapshot.
- 167 pengujian Python pada `apps/scoring/tests` lulus. Ada peringatan penulisan cache pytest; tidak ada kegagalan test.
- 9 reproduksi temuan dengan fixture di memori berhasil: jalankan `node tools/audit-exam-findings-20261010.cjs` dari root repository. Skrip ini mengassert perilaku bermasalah saat ini, **bukan** regression test untuk perilaku yang benar; setelah perbaikan, ubah menjadi test yang mengharapkan pengaman bekerja.
- Runner Node dijalankan dengan `--experimental-test-isolation=none` karena pembuatan subprocess dibatasi lingkungan. Fixture tidak memodelkan locking/FK PostgreSQL secara lengkap; reproduksi race menyisipkan perubahan pada titik tunggu secara deterministik.
- Belum dilakukan pencocokan jawaban/nilai produksi, pemeriksaan migrasi pada database aktif, pengujian dua browser langsung, uji beban, audit jaringan/deployment, maupun audit dependensi/CVE.

Urutan perbaikan yang disarankan: kegagalan baca/tulis regrade dan perlindungan reset; isolasi snapshot historis; sinkronisasi base score manual; kemudian pemulihan resume/esai kosong, sesi perangkat, dan worker penilaian. Setelah itu, lakukan pengujian integrasi PostgreSQL serta browser dengan skenario offline, reload, deadline, dan reset.
