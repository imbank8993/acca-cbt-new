# Pilihan skor Menjodohkan

Pengaturan **Skor Menjodohkan** tersedia pada buat/edit ujian dan pengaturan
folder ASAS/ASAT/AM (bawaan folder serta timpaan per bank soal). Pengaturan ini
terpisah dari skor Benar-Salah/Kategorisasi dan dikunci setelah ada pengerjaan.

- `proportional`: pasangan tepat / seluruh pasangan × bobot soal.
- `official` (label UI **Utuh per soal**): mengikuti skema berjenjang yang sudah
  dipakai B/S: sampai 5 pasangan seluruhnya harus tepat; lebih dari 5 pasangan
  mendapat penuh bila seluruhnya tepat, setengah bila keliru 1–2, dan nol
  selebihnya. Ini nama mode internal, bukan klaim aturan universal ujian resmi.

Satu pasangan adalah satu baris premis. Jika premis memiliki beberapa target,
seluruh himpunan target harus cocok untuk memperoleh kredit pada baris itu.
Pasangan kosong dianggap salah. Tidak ada penalti negatif.

## Kompatibilitas

Aturan disimpan pada `cbt_exams.metadata.matching_scoring_rule`. Ujian tanpa
bidang tersebut tetap proporsional, termasuk saat dinilai ulang. Tidak diperlukan
migrasi data atau perubahan nilai siswa yang sudah ada. Pilihan pada folder
tidak mengubah aturan ujian yang sudah memiliki pengerjaan.

Saat memuat soal untuk penilaian/koreksi/IRT, aturan ujian ditempel pada salinan
soal sebagai `metadata.matching_scoring`; snapshot asli tidak ditulis ulang.

## IRT

Mode proporsional mempertahankan perilaku lama: satu baris premis menjadi satu
butir. Mode utuh menggunakan satu soal sebagai satu butir dikotomis; hanya
seluruh pasangan tepat yang dihitung benar pada IRT. Skor setengah tetap masuk
nilai klasik. Parameter tebakan butir menjodohkan utuh memakai 0 karena metadata
kunci tidak menentukan model tebakan (jumlah pengecoh, pemakaian ulang target,
atau kewajiban pasangan satu-ke-satu).
