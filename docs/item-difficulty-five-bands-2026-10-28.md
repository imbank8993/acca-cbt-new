# Lima kategori kesukaran berdasarkan indeks P

Filter Analisis memakai urutan tetap: Semua, Sangat Sulit, Sulit, Sedang,
Mudah, Sangat Mudah. Kategori ditentukan oleh P, bukan pemeringkatan soal
atau pembagian jumlah soal secara merata.

| Rentang P | Kategori |
| --- | --- |
| 0 ≤ P ≤ 0,10 | Sangat Sulit |
| 0,10 < P ≤ 0,30 | Sulit |
| 0,30 < P ≤ 0,70 | Sedang |
| 0,70 < P ≤ 0,90 | Mudah |
| 0,90 < P ≤ 1 | Sangat Mudah |

Rentang ini mengikuti konvensi interpretasi lima kategori yang dipakai dalam
[penelitian analisis butir di jurnal UNJ](https://journal.unj.ac.id/unj/index.php/jrpms/article/download/8593/5853/16602),
halaman 28. Istilah sukar/sangat sukar ditampilkan sebagai sulit/sangat sulit.
Ini bukan satu-satunya konvensi yang mungkin dan tidak mengasumsikan jumlah soal
tiap kategori atau distribusi normal tertentu. [University of Washington](https://www.washington.edu/assessment/scanning-scoring/scoring/reports/item-analysis/)
juga menekankan bahwa interpretasi statistik butir bergantung pada tes dan pesertanya.

Pada analisis ini, P dihitung sebagai jumlah respons benar dibagi jumlah respons
yang telah memiliki penilaian benar/salah. Respons belum ternilai tidak diperlakukan
sebagai salah. Respons kosong tetap dilaporkan terpisah; indeks ini menggambarkan
respons ternilai yang tersedia, bukan persentase benar dari seluruh peserta terdaftar.
Hasil masih sementara selama ujian dan koreksi berlangsung. Bila tidak ada respons
ternilai, kategori belum ditentukan dan soal hanya muncul saat filter Semua.

Kategori dihitung dari rasio hitungan asli, sebelum pembulatan angka untuk tampilan,
agar nilai di dekat batas tidak berpindah kategori. Backend Python, cadangan analisis
web, tabel/modal, dan Excel memakai batas yang sama. Parameter kesukaran IRT **b**
dan estimasi kemampuan **theta** berbeda dari indeks P ini dan tidak dikategorikan
menggunakan batas P.
