# Audit lanjutan ujian — 10 Oktober 2026

Pemeriksaan ini menemukan celah tambahan setelah perbaikan sebelumnya. Tiga temuan pertama direproduksi dengan fixture lokal melalui `node tools/audit-missed-exam-bugs-20261010.cjs`. Skrip awal membuktikan bug; setelah perbaikan, skrip memeriksa perilaku yang benar. Tidak ada data produksi yang diakses atau diubah.

## 1. P1 — Hasil IRT lama masuk kembali setelah reset

Lokasi: `apps/api/src/grading/grading.service.ts`, `calculateIrt`, penulisan hasil sekitar baris 468.

Saat layanan scoring sedang menghitung, proktor dapat mereset peserta. Penulisan hasil hanya memakai ID pengerjaan, tanpa memeriksa status, waktu generasi pengerjaan, atau perubahan jawaban. Reproduksi menghasilkan peserta berstatus `in_progress` dengan `score_irt=750` dari pengerjaan sebelumnya. Perubahan penilaian esai selama kalkulasi juga dapat membuat hasil IRT kedaluwarsa.

Perbaikan yang diperlukan: validasi ulang seluruh input peserta di dalam transaksi dengan penguncian baris sebelum menyimpan hasil; tolak hasil bila generasi atau input berubah.

## 2. P1 — Penyimpanan IRT gagal tetapi API melaporkan berhasil

Lokasi: blok penulisan yang sama dalam `calculateIrt`.

Nilai ditulis satu per satu tanpa pemeriksaan `error` atau transaksi menyeluruh. Reproduksi memaksa kegagalan UPDATE: API tetap mengembalikan `count=1`, sedangkan nilai tetap kosong. Kegagalan di tengah kelompok peserta juga dapat meninggalkan hasil sebagian tersimpan.

Perbaikan yang diperlukan: simpan secara atomik, periksa semua hasil penulisan, dan jangan mengembalikan sukses jika penyimpanan gagal.

## 3. P1 — Penilaian tugas lama menimpa pengumpulan baru

Lokasi: `apps/api/src/proctor/exam-monitoring.service.ts`, `gradeAssignment`, sekitar baris 829–879.

Metode membaca metadata dan status, menunggu pemeriksaan akses serta jenis ujian, kemudian menulis dengan kondisi ID dan status selesai saja. Bila reset dan pengumpulan ulang terjadi pada jeda itu, status kembali `submitted`, sehingga nilai untuk pengumpulan lama diterima pada pengumpulan baru. Metadata juga diganti menggunakan salinan lama. Reproduksi menunjukkan nilai 90 masuk ke pengumpulan pengganti dan metadata pengumpulan baru hilang.

Perbaikan yang diperlukan: kunci pengerjaan, verifikasi generasi yang dibaca semula, lalu gabungkan metadata terbaru. Sertakan versi pengumpulan pada permintaan penilaian untuk menolak formulir guru yang sudah kedaluwarsa.

## 4. P2 — Reset menyisakan nilai dan komentar guru lama

Lokasi: `apps/api/src/proctoring/proctoring.service.ts`, reset sekitar baris 344–375 dan makeup sekitar baris 490–529; konsumennya `apps/api/src/proctor/exam-monitoring.service.ts` baris 808–809.

Reset mengosongkan `total_score` dan `score_irt`, tetapi mempertahankan `teacher_score`, `teacher_feedback`, `graded_at`, serta `detailed_scores`. Monitoring tugas langsung mengambil `teacherScore` dan `teacherFeedback` dari metadata tersebut. Karena itu, hasil penilaian pengumpulan lama dapat tetap ditampilkan setelah reset. Temuan ini berdasarkan alur baca/tulis kode; belum diuji melalui browser.

Perbaikan yang diperlukan: kosongkan hasil penilaian aktif pada reset/makeup dan simpan riwayat lama secara terpisah bila diperlukan untuk audit.

## Batas pemeriksaan

Audit ini memeriksa kode dan menggunakan simulasi terkontrol, bukan uji konkurensi PostgreSQL atau browser secara menyeluruh. Keempat temuan kemudian diperbaiki: IRT memvalidasi ulang input dan menyimpan dalam transaksi, penilaian tugas memeriksa generasi di bawah penguncian, dan reset/makeup membersihkan hasil lama. Skrip reproduksi telah diubah menjadi pemeriksaan regresi yang menuntut penolakan hasil kedaluwarsa. Hasil tes sebelumnya tidak mencakup seluruh skenario ini dan tidak menjamin tidak ada celah lain.
