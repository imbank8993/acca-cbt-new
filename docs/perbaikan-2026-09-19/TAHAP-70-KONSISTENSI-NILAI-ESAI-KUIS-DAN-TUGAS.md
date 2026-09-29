# Tahap 70 — Konsistensi nilai esai, kuis, dan tugas

Diperbarui 29 September 2026. Tahap ini melanjutkan audit kondisi tepi setelah mesin nilai utama dan IRT dinyatakan sehat.

## Temuan dan perbaikan

### SCORE-QUIZ-01 — Auto-submit tidak ikut penilaian relatif

Penilaian relatif sebelumnya hanya membaca attempt berstatus `submitted`. Attempt yang ditutup karena waktu habis atau terminasi berstatus `auto_submitted`, sehingga tidak pernah ikut peringkat kecepatan. Kedua status selesai sekarang dihitung. Nilai dasar auto-submit yang belum memiliki `metadata.base_score` diambil dari `total_score`, lalu disimpan agar penghitungan ulang tidak mengurangi nilai berulang kali.

Semua jalur auto-submit—waktu habis saat siswa membuka ulang, penutupan monitoring, dan terminasi proktor—sekarang memicu penghitungan relatif bila ujian bertipe kuis. Penyimpanan nilai relatif seluruh peserta juga dilakukan dalam satu transaksi supaya kegagalan di tengah tidak meninggalkan sebagian peserta dengan rumus lama.

### SCORE-QUIZ-02 — Durasi sama mendapat penalti berbeda

Urutan hasil query database tidak dijamin. Dua peserta dengan skor dasar dan durasi detik yang sama sebelumnya bisa mendapat penalti 0 dan 0,01 hanya karena urutan baris. Peserta dengan durasi sama sekarang mendapat penalti sama; `attempt_id` hanya dipakai sebagai urutan deterministik, bukan pembeda nilai.

### SCORE-ESSAY-01 — Koreksi esai dapat tersimpan sebagian

Validasi permintaan memang dilakukan sebelum penulisan, tetapi beberapa update jawaban dan update total attempt sebelumnya merupakan operasi terpisah. Gangguan database setelah jawaban pertama dapat menyimpan sebagian nilai tanpa memperbarui total. Seluruh koreksi jawaban, pembacaan ulang, perhitungan total, dan update attempt sekarang berada dalam satu transaksi. Attempt dikunci `FOR UPDATE` agar dua guru/proktor yang menilai bersamaan tidak menghasilkan total dari data usang.

### SCORE-ASSIGN-01 — Pertahanan service nilai tugas belum lengkap

DTO HTTP telah membatasi nilai 0–100, tetapi service masih dapat dipanggil dari jalur internal dengan `NaN`, string, nilai negatif, atau nilai di atas 100. Service juga belum memastikan attempt benar-benar milik ujian bertipe `assignment` dan sudah dikumpulkan. Ketiga pemeriksaan sekarang ditegakkan kembali di service. Update memakai syarat status selesai dan harus benar-benar mengubah satu attempt sebelum melaporkan sukses.

## Kondisi database aktif

- Belum ada attempt kuis selesai, sehingga tidak ada nilai auto-submit kuis lama yang perlu dipulihkan.
- Belum ada nilai tugas manual tersimpan, sehingga tidak ada nilai di luar rentang atau tugas belum selesai yang perlu diperbaiki.
- Tahap ini tidak membutuhkan migrasi atau perubahan data.

## Verifikasi

- 102 tes Python: lulus.
- 44 regresi backend terpilih: lulus.
- Regresi mencakup auto-submit kuis, penyimpanan base score, durasi seri, rollback koreksi esai, validasi nilai tugas, jenis ujian, dan status pengumpulan.
- Build NestJS: lulus.

## Risiko yang masih memerlukan desain lanjutan

Bank soal dan kunci jawaban masih menjadi data hidup. Jika kunci diubah setelah ujian selesai, penilaian ulang memakai keadaan bank saat ini. Audit Tahap 69 sudah membuktikan 67 attempt pretest historis akan berubah sampai 10,43 poin bila dinilai ulang sekarang. Solusi yang aman adalah snapshot versi soal, opsi, kunci, bobot, dan aturan penskoran saat ujian dipublikasikan atau attempt dimulai. Nilai historis tidak boleh dinilai ulang massal sebelum snapshot atau kebijakan akademiknya ditetapkan.
