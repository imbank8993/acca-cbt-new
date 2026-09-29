# Tahap 72 — Ketepatan isian singkat dan peringatan IRT

Diperbarui 29 September 2026. Tahap ini menutup dua risiko lanjutan pada mesin nilai: kredit parsial isian singkat yang terlalu longgar dan pemilihan hasil akhir IRT saat nilainya tepat 0,00.

## Isian singkat tidak lagi memakai substring

Aturan lama memberi setengah kredit jika jawaban siswa merupakan bagian dari kunci atau sebaliknya. Akibatnya satu huruf `a` dapat memperoleh setengah poin untuk kunci `Jakarta`. Aturan tersebut dihapus. Jawaban sekarang benar hanya jika sama setelah normalisasi atau tercantum secara eksplisit pada daftar variasi jawaban yang dibuat guru.

Perubahan berlaku untuk penilaian baru. Sebanyak 530 jawaban isian singkat dari 138 attempt selesai ditemukan pada database aktif; 13 di antaranya mempunyai skor parsial. Data historis itu tidak diubah karena skor parsial juga dapat sah untuk soal dengan beberapa bagian, misalnya satu dari dua isian benar. Ujian lama tanpa snapshot tetap tidak dapat di-regrade otomatis.

## Skor nol model IRT tetap sah

Pemilihan `score_irt` lama memakai rangkaian nilai truthy. Bila IRT 3PL yang dipilih menghasilkan tepat 0,00, aplikasi menganggapnya kosong dan dapat mengambil nilai 2PL, 1PL, atau klasikal. Pemilihan sekarang mengikuti model tertinggi yang memang dikonfigurasi dengan pemeriksaan eksplisit, sehingga nilai 0,00 tidak tertukar.

Ujian yang hanya berisi esai atau instrumen nonakademik sekarang ditolak dari kalkulasi IRT dengan pesan yang jelas. Sebelumnya nilai esai dapat disalin ke `score_irt` walaupun tidak ada satu pun butir objektif yang diestimasi.

## Peringatan ukuran sampel

Perhitungan masih dapat dijalankan untuk sekolah dengan peserta sedikit, tetapi respons sekarang membawa peringatan sesuai model: 1PL di bawah 100 peserta, 2PL di bawah 200, dan 3PL di bawah 500. Halaman monitoring Admin, Guru, serta Proktor menampilkan peringatan itu setelah kalkulasi. Nilai tidak dibatalkan diam-diam; pengguna mendapat konteks bahwa hasil perlu ditafsirkan hati-hati.

## Verifikasi

- 106 tes Python: lulus.
- Regresi baru membuktikan substring tidak mendapat kredit, variasi eksplisit tetap benar, skor IRT 3PL sebesar 0,00 tetap dipilih, dan peringatan sampel sesuai model.
- Build NestJS: lulus.
- Lint empat berkas frontend yang diubah: lulus.
- Uji HTTP ke layanan Python aktif: jawaban `a` terhadap kunci `Jakarta` menghasilkan 0 dari 10.
- Inventaris database dilakukan baca-saja; tidak ada nilai historis yang diubah.

Pemindaian lint frontend penuh juga menemukan 4 error dan 47 warning pada komponen modal bersama yang ditambahkan setelah baseline lint nol. Temuan tersebut tidak berada pada jalur penskoran Tahap 72 dan menjadi pekerjaan UI berikutnya.
