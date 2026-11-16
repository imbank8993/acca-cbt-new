# Laporan Analisis Hasil (PDF) — dasar riset dan susunan

Monitoring → tab **Hasil** → **Export → PDF Laporan Analisis** menghasilkan satu berkas A4
berisi analisis kelas secara umum lalu satu laporan per peserta. Perhitungan ada di
`apps/web/lib/assessment-report.ts` (murni, diuji di `apps/api/test/assessment-report.test.cjs`);
penyusunan PDF di `apps/web/lib/export-analysis-pdf.ts`.

## Susunan laporan

| Bagian | Isi | Dasar |
|---|---|---|
| Kop + identitas | Kop sekolah, nama ujian, mapel, tanggal, model penilaian | Standar pelaporan: tujuan, populasi dan waktu harus jelas (AERA/APA/NCME 2014, Bab 6) |
| I. Ringkasan kelas | Peserta terdaftar/selesai/dianalisis; rata-rata, SB, median, Q1–Q3, min–maks; histogram nilai; sebaran kategori capaian | Statistik deskriptif klasik (Crocker & Algina 1986) |
| Reliabilitas | KR-20 (semua butir dikotomus) atau Cronbach α (ada butir berskor parsial), SEM dalam skala nilai 0–100 | Kuder & Richardson 1937; Cronbach 1951; SEM wajib dilaporkan (AERA/APA/NCME 2014, Std. 2.13–2.14) |
| IRT (bila ujian memakai IRT) | Model, rerata/SB θ, skala 500 + 100θ, rata-rata galat baku θ, kurva informasi tes | Hambleton, Swaminathan & Rogers 1991; Lord 1980 |
| II. Penguasaan materi | % skor per materi (kisi-kisi) dan kategori capaian | Kriteria ketercapaian tujuan pembelajaran (KKTP) model interval, Kemendikbudristek 2022/2024 |
| III. Analisis butir | Tabel keputusan (p, kesukaran, r_it, D, keputusan), diikuti tabel parameter pendukung (daya beda, α bila butir dihapus, b/a/c IRT, jumlah kosong) | Kelley 1939; Ebel & Frisbie 1991; Crocker & Algina 1986 |
| Prioritas tindak lanjut | Temuan dan saran yang sama dikelompokkan, dengan nomor semua butir terkait | Ebel & Frisbie 1991 |
| Analisis pengecoh | % pemilih tiap opsi (semua, kelompok atas, kelompok bawah); pengecoh tak berfungsi (< 5%) dan pengecoh yang menarik kelompok atas | Haladyna & Downing 1993; Haladyna, Downing & Rodriguez 2002 |
| IV. Rekap peserta | Nilai, kategori, benar/salah/kosong, θ & skala IRT | — |
| Cara membaca | Glosarium singkat dan rujukan, sebelum bagian V agar laporan siswa menjadi blok halaman yang utuh untuk dicetak/dibagikan | Zenisky & Hambleton 2012 (glosarium & bahasa sederhana) |
| V. Laporan per peserta | Tiap siswa dimulai pada halaman baru dan berlanjut bila rincian panjang: nilai dan rentang ±SEM, selisih terhadap rata-rata kelas, skala IRT ± galat baku, penguasaan per materi (dibanding kelas), umpan balik (sudah dikuasai, perlu diperbaiki, langkah berikutnya), peta benar/salah per butir, daftar butir yang belum tepat beserta jawaban, kunci dan % benar di kelas | Umpan balik "feed up–feed back–feed forward" (Hattie & Timperley 2007); pedoman laporan skor (Zenisky & Hambleton 2012); pola respons tak lazim (Sato 1975) |


## Rumus dan batas

- Skor butir x = skor diperoleh ÷ skor maksimum butir (0–1). Kosong = 0; **belum dinilai
  dianggap data hilang** (tidak dihitung sebagai salah). Butir non-akademik (SJT, Likert, dsb.)
  dan butir berbobot 0 tidak dianalisis — sama dengan analisis materi yang sudah ada.
- **p** = rata-rata x. Kategori memakai lima pita aplikasi (≤ 0,10 sangat sulit; ≤ 0,30 sulit;
  ≤ 0,70 sedang; ≤ 0,90 mudah; > 0,90 sangat mudah).
- **r_it** = korelasi Pearson skor butir dengan skor total *tanpa butir itu* (point-biserial
  terkoreksi). < 0,20 perlu ditinjau; negatif → periksa kunci (Ebel & Frisbie 1991).
- **D** = p kelompok atas − p kelompok bawah, masing-masing 27% peserta (Kelley 1939);
  ≥ 0,40 sangat baik, 0,30–0,39 baik, 0,20–0,29 cukup, < 0,20 jelek, < 0 dibuang.
- **α** = k/(k−1) · (1 − Σσ²ᵢ / σ²ₓ) dengan varians populasi; hanya peserta yang semua butirnya
  sudah dinilai. Untuk butir dikotomus α identik dengan KR-20. Tafsiran: ≥ 0,90 sangat tinggi,
  ≥ 0,80 tinggi, ≥ 0,70 memadai untuk tes kelas, ≥ 0,60 cukup, < 0,60 rendah (Nunnally & Bernstein 1994).
- **SEM** = SB · √(1 − α), ditampilkan pada skala nilai 0–100; nilai siswa dilaporkan dengan
  rentang ±1 SEM (≈ 68%).
- **Informasi IRT**: Iᵢ(θ) = D²a² · (Q/P) · ((P − c)/(1 − c))², P = c + (1 − c)/(1 + e^(−Da(θ − b))).
  Parameter yang disimpan Kalkulasi IRT adalah model tertinggi yang dipakai (3PL > 2PL > 1PL);
  1PL memakai D = 1, a = 1, c = 0; 2PL/3PL memakai D = 1,7 (sesuai `apps/scoring`).
  θ diestimasi EAP dengan prior N(0,1), jadi galat baku ≈ 1/√(I(θ) + 1).
- **Kategori capaian** (nilai 0–100 dan % per materi), model interval KKTP:
  0–40 perlu bimbingan, 41–65 remedial di bagian tertentu, 66–85 tuntas, 86–100 pengayaan.
- **Pengecoh tak berfungsi**: dipilih < 5% peserta. **Pengecoh bermasalah**: dipilih lebih banyak
  oleh kelompok atas daripada kelompok bawah.
- **Soal mudah yang terlewat**: butir dengan p kelas ≥ 0,75 yang dijawab salah/kosong oleh siswa —
  penanda kekeliruan ceroboh atau celah konsep spesifik (gagasan caution index Sato).
- Statistik butir/reliabilitas memerlukan cukup peserta; di bawah 10 peserta laporan memberi peringatan
  bahwa angkanya belum stabil.

## Rujukan

- AERA, APA, & NCME. (2014). *Standards for Educational and Psychological Testing*. Washington, DC: AERA.
- Crocker, L., & Algina, J. (1986). *Introduction to Classical and Modern Test Theory*. Holt, Rinehart & Winston.
- Cronbach, L. J. (1951). Coefficient alpha and the internal structure of tests. *Psychometrika, 16*, 297–334.
- Ebel, R. L., & Frisbie, D. A. (1991). *Essentials of Educational Measurement* (5th ed.). Prentice Hall.
- Haladyna, T. M., & Downing, S. M. (1993). How many options is enough for a multiple-choice test item? *Educational and Psychological Measurement, 53*, 999–1010.
- Haladyna, T. M., Downing, S. M., & Rodriguez, M. C. (2002). A review of multiple-choice item-writing guidelines. *Applied Measurement in Education, 15*, 309–334.
- Hambleton, R. K., Swaminathan, H., & Rogers, H. J. (1991). *Fundamentals of Item Response Theory*. Sage.
- Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*, 81–112.
- Kelley, T. L. (1939). The selection of upper and lower groups for the validation of test items. *Journal of Educational Psychology, 30*, 17–24.
- Kemendikbudristek. (2022; rev. 2024). *Panduan Pembelajaran dan Asesmen*. Jakarta: BSKAP.
- Kuder, G. F., & Richardson, M. W. (1937). The theory of the estimation of test reliability. *Psychometrika, 2*, 151–160.
- Lord, F. M. (1980). *Applications of Item Response Theory to Practical Testing Problems*. Erlbaum.
- Nunnally, J. C., & Bernstein, I. H. (1994). *Psychometric Theory* (3rd ed.). McGraw-Hill.
- Sato, T. (1975). *The Construction and Interpretation of S-P Tables*. Tokyo: Meiji Tosho.
- Zenisky, A. L., & Hambleton, R. K. (2012). Developing test score reports that work. *Educational Measurement: Issues and Practice, 31*(2), 21–26.
