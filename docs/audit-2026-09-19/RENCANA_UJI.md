# Rencana uji, bukti reproduksi, dan kriteria penerimaan

Tanggal: 19 September 2026. Mengacu pada [laporan audit lengkap](../AUDIT_LENGKAP_2026-09-19.md) dan [matriks 51 halaman](MATRIKS_HALAMAN.md).

## Status pengujian saat audit

| Pemeriksaan | Hasil aktual | Catatan |
|---|---|---|
| TypeScript apps/web, tanpa emit/incremental | Exit 0 | Tidak menjalankan aplikasi di browser |
| TypeScript apps/api, tanpa emit/incremental | Exit 0 | Tidak mengakses database |
| Pytest scoring yang sudah ada | 78 passed | Tidak berarti seluruh input manipulatif ditolak |
| ESLint apps/web | Exit 1; 1.367 error, 653 warning | Tidak memakai --fix; source tetap utuh |
| verify-findings.cjs | 12/12 reproduced | Layanan asli dengan DB/storage mock; satu kasus HMAC berupa reproduksi algoritma |
| verify-scoring.py | 2/2 reproduced | Memanggil fungsi scoring Python asli tanpa jaringan |

Percobaan awal menjalankan ESLint dari root tidak menemukan konfigurasi, kemudian diulang dari apps/web dan menghasilkan laporan di atas. Percobaan awal Python menggunakan path virtualenv root yang tidak ada; pengujian berhasil setelah memakai virtualenv apps/scoring. Kegagalan lokasi alat ini tidak dihitung sebagai bug aplikasi.

Build produksi, lint backend terpisah, browser autentikasi, E2E, uji beban, schema database nyata, pemindaian advisory dependensi, dan pentest jaringan **belum dilakukan**. Skrip lint API yang memakai --fix tidak dijalankan karena audit tidak mengubah source.

## Menjalankan ulang pemeriksaan lokal

Prasyarat: dependensi repositori dan virtualenv scoring sudah terpasang. Jalankan dari root repositori kecuali dinyatakan lain. Tidak perlu mengisi kredensial database atau storage untuk skrip reproduksi.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/api/tsconfig.json
node docs/audit-2026-09-19/verify-findings.cjs
& '.\apps\scoring\.venv\Scripts\python.exe' docs/audit-2026-09-19/verify-scoring.py
```

Dari direktori `apps/scoring`, jalankan tes yang sudah ada:

```powershell
& '.\.venv\Scripts\python.exe' -m pytest tests -q -p no:cacheprovider
```

Dari direktori `apps/web`, jalankan lint tanpa perbaikan otomatis:

```powershell
node ../../node_modules/eslint/bin/eslint.js . --format json --output-file ../../docs/audit-2026-09-19/eslint-web.json
```

Untuk meregenerasi inventaris/dokumen dari root:

```powershell
node docs/audit-2026-09-19/inventory.cjs
node docs/audit-2026-09-19/build-report.cjs
```

Generator laporan mempertahankan baseline dan narasi audit awal. Setelah source diperbaiki, lakukan audit ulang dan ubah status temuan secara sengaja; jangan menganggap regenerasi nomor baris sebagai validasi perbaikan. Skrip reproduksi **mengharapkan perilaku bug saat ini**. Setelah perbaikan, assertion tersebut seharusnya gagal dan perlu diubah menjadi tes regresi untuk perilaku yang benar. Jangan memasukkannya ke CI sebagai indikator bahwa produk sehat.

## Bukti sintetis yang sudah dijalankan

| Skenario | Memakai apa | Observasi | Batas |
|---|---|---|---|
| SEC-01/02 | getQuestions asli + mock DB | Metadata answer utuh; tidak ada query membership/attempt | Tidak membuktikan query terhadap data produksi |
| SEC-03 | saveAnswer asli + mock attempt expired | Upsert jawaban tetap dipanggil | Tidak menilai finalisasi background deployment |
| SEC-04 | resolveAttemptForSubmit asli + mock DB | exam-A diterima dalam konteks exam-B | Menguji resolver, bukan seluruh HTTP submit |
| SEC-05 | updatePreferences asli + mock DB | user_id body menimpa ID terautentikasi | Tidak mengubah preferensi pengguna nyata |
| SEC-06 | StorageController asli + mock storage | Key questions pihak lain dikirim ke deleteObject | Tidak menghapus berkas sungguhan |
| SEC-07 | QuestionsService asli + mock authz/DB | ID soal asing di-upsert setelah hanya bank tujuan diotorisasi | Tidak membuktikan efek FK atau transaksi deployment |
| SEC-08/BUG-06 | submitEssayGrades asli + mock DB | ID jawaban asing dan nilai 999 diterima; status manual selesai | Query scope/range terbukti; penyimpanan fisik tidak dicoba |
| SEC-09 | logViolation asli + mock DB | RESET_BY_PROCTOR dari siswa diterima | Tidak menguji UI anti-cheat/browser |
| BUG-01 | uploadToHosting asli + fetch mock | HTTP 200 dengan bentuk respons Nest dianggap gagal | Tidak mengunggah file ke cloud |
| BUG-02 | crypto HMAC atas payload sintetis | Penggantian src mengubah signature yang diharapkan | Reproduksi algoritma, bukan memanggil route Next/JSZip/R2 |
| BUG-03 | persistAnswers asli + mock error DB | Fungsi tetap resolve meski write gagal | Kehilangan data end-to-end perlu fault injection staging |
| BUG-07 | replaceOptions asli + mock DB | weight 0 berubah menjadi 1 | Tidak menjalankan editor browser |
| BUG-16a | calculate_single_answer_score asli | Kunci a,b; jawaban a,a mendapat 10/10 | Memvalidasi mesin scoring, bukan middleware deployment |
| BUG-16b | calculate_single_answer_score asli | Opsi checklist bobot 2 berulang tiga kali mendapat 6 | Sama |

Dua belas baris pertama sampai BUG-07 memuat satu skenario gabungan SEC-01/02 dan satu SEC-08/BUG-06; totalnya **12 skenario TypeScript/algoritma + 2 skenario Python = 14**. Banyaknya ID temuan tidak sama dengan banyaknya skenario reproduksi. Angka 15 pada pembaruan sementara percakapan dikoreksi setelah pencocokan dengan berkas bukti; angka final yang digunakan laporan adalah 14.

## Lingkungan staging yang diperlukan

Gunakan database dan bucket sekali pakai yang terpisah dari sekolah. Siapkan organisasi A/B, admin/proktor, guru A/B, pengawas, siswa A/B, kelas A/B, peserta individual, dan bank soal dengan kepemilikan berbeda. Isi tidak memuat data pribadi asli. Siapkan semua tipe soal, nilai esai manual, metadata psikometri, gambar/lampiran, jadwal PAS, serta ujian private/public.

Untuk setiap ujian, buat state draft, published-belum-mulai, in_progress, submitted, auto_submitted, melewati personal deadline, dan melewati global deadline. Uji show_results true/false secara independen dari state pengerjaan. Gunakan waktu server yang dapat dikendalikan dalam tes.

Catat respons HTTP, actor, ID resource, keputusan izin, jumlah baris sebelum/sesudah, revision jawaban, nilai akhir, dan log audit. Simpan token/kredensial di fasilitas rahasia tes; jangan memasukkannya ke laporan atau commit.

## Paket regresi prioritas pertama

| Paket | ID | Skenario wajib | Hasil yang diharapkan |
|---|---|---|---|
| Kelayakan peserta | SEC-01, BUG-13 | Target kelas, peserta individual, public, pengguna asing, organisasi lain, draft, sebelum mulai | Kebijakan identik di daftar/detail/soal/start; akses tidak sah tanpa data bocor |
| Kerahasiaan kunci/hasil | SEC-02, SEC-14 | Setiap tipe soal, attempt aktif/selesai, show_results false/true | Hanya field rendering sampai kebijakan rilis terpenuhi |
| Deadline/state | SEC-03–04, SEC-10, BUG-10 | Personal/global deadline, attempt exam mismatch, terminate dua kali, submit/terminate bersamaan | Status final idempoten, jam selesai tidak diperbarui sembarang, konteks ujian selalu cocok |
| Otorisasi resource | SEC-05–08, SEC-11 | User/soal/opsi/answer/key storage asing, guru bank lain, organisasi lain | 403/404 tanpa penulisan parsial; pemilik yang berhak tetap berhasil |
| Log pengawasan | SEC-09 | Event siswa sah, RESET_BY_PROCTOR, event administratif lain, payload asing | Event server/proktor tidak dapat dipalsukan siswa; actor tercatat |
| Pengumpulan tahan gagal | BUG-03, BUG-08–09 | Request A/B terbalik, storage penuh, DB error tiap langkah, timeout sesudah commit, retry | Jawaban terbaru tersimpan; tidak ada sukses palsu atau duplikasi/kehilangan data |
| Penilaian | BUG-06–07, BUG-15–16 | Skor nol/negatif/terlalu besar, partial grading, edit kunci, duplicate IDs, ID asing | Rentang valid, manual tetap utuh, pending akurat, skor tidak termanipulasi |
| Kontrak storage | BUG-01, SEC-06 | Upload/delete sukses, 413 non-JSON, 500, MIME/ekstensi, pemilik asing | UI sesuai status nyata; tidak ada penghapusan tanpa izin |
| Backup aman | SEC-12–13, BUG-02, BUG-04–05 | ZIP gambar, signature rusak, role siswa, ukuran berlebih, canary URL terisolasi, error restore tengah jalan | Validasi sebelum efek samping; tidak ada SSRF, partial restore, atau kehilangan relasi |
| Historis soal | BUG-11–12 | Soal pernah dijawab lalu diedit/dihapus, sumber bank legacy | Bukti historis utuh; rendering dan grading memakai sumber soal yang sama |

## Matriks UI/UX

Jalankan skenario berikut untuk seluruh role yang relevan, termasuk halaman admin/proktor/guru yang berbagi pola implementasi. Gunakan daftar 51 halaman sebagai daftar centang; status awal seluruh pemeriksaan browser ini adalah **belum dijalankan**.

| Dimensi | Kasus |
|---|---|
| State data | Loading awal, sukses, kosong, 401, 403, 500, request menggantung, offline, retry |
| Konsistensi konteks | Ganti ujian A→B ketika A lambat, ganti role, navigasi back/forward, buka dua tab |
| Pengerjaan | Klik/ketik cepat, reload, close/reopen, melewati waktu, submit ulang, koneksi pulih |
| Hasil/analitik | Aktif vs selesai, show_results, esai positif, tren 0–6 data, ekspor seluruh tipe soal |
| Waktu | UTC instant sama pada daftar/detail, zona sekolah/browser berbeda, mendekati tengah malam |
| Keyboard | Tab order, Enter/Space, fokus terlihat, link kartu, seluruh toggle, Escape modal, fokus kembali |
| Pembaca layar | Nama kontrol, role/state toggle, judul dialog, pesan error dan live status simpan |
| Tampilan | Lebar 360/390/768/1366 piksel, zoom 200%, teks panjang, soal/tabel/gambar besar |
| Operasi massal | Generate PAS parsial, impor parsial, nilai parsial, notifikasi >50, penjelasan cakupan aksi |
| Dashboard pengawas | Tidak ada data contoh yang disajikan sebagai aktivitas nyata |

Ukuran layar di atas adalah rencana pengujian, bukan hasil screenshot. Kontras warna harus diukur atas tampilan yang dirender, bukan dinilai dari nama kelas warna saja.

## Kriteria penutupan audit

1. Tiap temuan memiliki pemilik, keputusan perbaikan/risiko diterima, tautan perubahan, dan bukti pengujian. ID dipertahankan agar histori dapat ditelusuri.
2. Kasus P1 yang relevan terhadap penggunaan nyata mempunyai tes regresi dan sudah diuji pada integrasi staging, tidak hanya mock.
3. Restore dibuktikan pulih penuh pada fixture yang mencakup seluruh entitas yang dijanjikan; diuji juga rollback ketika gagal.
4. Build, lint yang menjadi gate, TypeScript, unit/integration, dan matriks browser selesai dengan pengecualian yang dicatat.
5. Deployment memiliki konfigurasi rahasia/batas request/izin storage yang diverifikasi, serta tidak menggunakan data contoh sebagai status operasional.

Laporan ini adalah baseline untuk perbaikan dan audit ulang. Penyelesaian dokumentasi tidak berarti temuan sudah diperbaiki.
