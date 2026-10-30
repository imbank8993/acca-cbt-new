# Penskoran Benar-Salah dan Kategorisasi

Satu soal Benar-Salah (B/S) atau Kategorisasi kini dinilai sebagai **satu soal**,
bukan per pernyataan. Aturannya mengikuti Kepdirjen Pendis 781/2021 (Juknis
Penyusunan Soal HOTS di Madrasah) dan Desain Pengembangan Soal AKM 2020
(Pusat Asesmen dan Pembelajaran, Kemendikbud):

| Jumlah pernyataan | Semua benar | Salah 1–2 | Salah > 2 |
|---|---|---|---|
| ≤ 5 | skor penuh | 0 | 0 |
| > 5 | skor penuh | ½ skor | 0 |

- Pernyataan yang tidak dijawab dihitung salah.
- Kategorisasi: satu pernyataan benar bila kategori yang dipilih **persis** sama
  dengan kunci (pernyataan berkunci ganda harus dipilih lengkap, tanpa tambahan).
- `is_correct` bernilai benar hanya bila semua pernyataan benar; skor setengah
  tampil sebagai **Parsial** di hasil siswa.
- Sebelumnya skornya proporsional (benar ÷ jumlah pernyataan), sehingga menebak
  acak pada soal 4 pernyataan rata-rata sudah memberi 50% skor.

PG, PG Kompleks (MCMA), Menjodohkan, Isian, Urutan, dan Esai tidak berubah.

## Ujian lama tidak bergeser

Aturan disimpan per ujian di `cbt_exams.metadata.complex_scoring_rule`:

- tanpa penanda / `official` → aturan baru (bawaan untuk ujian baru);
- `proportional` → aturan lama.

Migrasi `20261030_01_complex_scoring_rule.sql` memberi penanda `proportional`
pada setiap ujian yang **sudah memiliki pengerjaan**, sehingga koreksi kunci,
suntingan bank soal, atau penilaian ulang tidak mengubah nilai yang sudah ada.
Ujian yang belum dikerjakan siapa pun (termasuk yang sudah dijadwalkan) memakai
aturan baru.

NestJS mencap aturan itu pada salinan soal beku (`metadata.complex_scoring`) di
`exam-question-snapshots.ts`, jadi semua jalur penilaian (submit, auto-submit,
monitoring, koreksi kunci, IRT) membawanya tanpa perubahan payload. Snapshot
tersimpan tidak ditulis ulang.

## Memilih aturan per folder ujian

Tab **Pengaturan Ujian** pada folder ASAS/ASAT/AM kini memiliki baris
**Skor Benar-Salah & Kategorisasi**:

- **Utuh per soal (juknis)**: bawaan, aturan di atas;
- **Proporsional per pernyataan**: aturan lama, misalnya untuk latihan.

Pilihan dapat diatur sebagai bawaan folder atau khusus per bank soal, disimpan
ke `cbt_exams.metadata.complex_scoring_rule`, dan ikut saat ujian dibangkitkan.
Seperti urutan dan mode aman, aturan ini **dikunci setelah ada siswa yang
mulai mengerjakan**; folder yang disimpan melaporkan ujian yang tidak diubah.

## IRT

Pada aturan baru satu soal B/S/Kategorisasi = **satu butir** dikotomus (benar
bila seluruh pernyataan benar), tidak lagi dipecah per pernyataan. Pemecahan
lama membuat soal 5 pernyataan berbobot lima kali soal PG dan melanggar asumsi
independensi lokal. Skor setengah tetap masuk nilai klasikal.

Parameter tebakan 3PL untuk butir ini: 0,5ⁿ (B/S) dan (1/k)ⁿ (Kategorisasi,
k = banyak kategori pada kunci, minimal 2), n = jumlah pernyataan. Ujian lama
(`proportional`) tetap dipecah per pernyataan seperti sebelumnya. Menjodohkan
tetap dipecah per pasangan.

Parameter tebakan (c) butir lain juga diperbaiki:

| Tipe | Sebelumnya | Sekarang |
|---|---|---|
| PG | 1/n | 1/n (tetap) |
| PG Kompleks | 1/n | 1/(2ⁿ − 1) |
| Isian singkat | 0,2 | 0 |
| Urutan | 1/n | 1/n! |

Ujian beraturan lama tetap memakai rumus lama, sehingga **Kalkulasi IRT** ulang
pada ujian tersebut memberi hasil yang sama.

## Penerapan

1. Jalankan migrasi `database/migrations/20261030_01_complex_scoring_rule.sql`
   **sebelum** layanan baru aktif.
2. Perbarui layanan Python scoring dan API bersama-sama.
3. Tidak ada penilaian ulang otomatis.

## Verifikasi

- `apps/scoring`: `pytest` (termasuk `tests/test_statement_scoring.py`; uji
  paritas TypeScript kini dijalankan pada aturan lama).
- `apps/api/test/complex-scoring-rule.test.cjs` serta audit Node yang menyentuh
  snapshot, penilaian, koreksi kunci, pembatalan soal, dan IRT.
