# Tahap 74 — Batas Pelanggaran dan Audit Keamanan Ujian

Tanggal penyelesaian: 30 September 2026

## Tujuan

Pembuat ujian dapat mengaktifkan Mode Aman, menentukan jumlah pelanggaran yang menutup ujian secara otomatis, atau memilih **Tanpa batas**. Pada pilihan tanpa batas seluruh peristiwa tetap dicatat, tetapi sistem tidak menyelesaikan ujian karena jumlah pelanggaran.

## Perilaku akhir

### Pengaturan per ujian

- `is_safe_mode = false`: pemantauan pada halaman siswa tidak diaktifkan dan batas otomatis tidak berlaku.
- `is_safe_mode = true` dan `max_violations = 1..100`: attempt ditutup otomatis ketika hitungan server mencapai batas.
- `is_safe_mode = true` dan `max_violations = null`: semua pelanggaran dicatat tanpa penyelesaian otomatis.
- Ujian lama yang belum mempunyai `max_violations` tetap menggunakan batas lama, yaitu 3.
- Ujian baru menggunakan batas awal 3, tetapi pembuat ujian dapat mengubahnya.

Nilai disimpan dalam `cbt_exams.metadata`, sehingga tahap ini tidak memerlukan perubahan struktur database atau migrasi SQL.

### Penegakan oleh server

Batas tidak lagi hanya diperiksa oleh JavaScript siswa. Setelah satu event diterima, server:

1. memastikan event berasal dari pemilik attempt;
2. memastikan jenis event termasuk daftar yang diizinkan;
3. mendeduplikasi event berdasarkan `client_event_id`;
4. menghitung ulang jumlah pelanggaran dari log database sejak reset terakhir;
5. membaca pengaturan Mode Aman dan batas ujian;
6. menutup attempt secara idempoten bila batas tercapai;
7. menilai jawaban yang sudah tersimpan.

Karena keputusan dilakukan di server, mengubah nilai hitungan atau batas pada browser tidak dapat mencegah penutupan setelah event sampai ke server.

### Gangguan jaringan

Event keamanan tetap masuk antrean lokal saat jaringan terputus. Ketika koneksi pulih, halaman mengirim jawaban terlebih dahulu lalu mengirim event keamanan secara berurutan. Ini mengurangi risiko jawaban terbaru tertinggal ketika event berikutnya mencapai batas dan server menutup ujian.

Jika server sebenarnya sudah menutup attempt tetapi respons hilang, pengiriman ulang `client_event_id` yang sama diakui sebagai duplikat yang berhasil. Event tidak ditulis dua kali dan antrean lokal dapat dibersihkan.

### Peristiwa yang direkam

| Kode | Tampilan | Dihitung ke batas |
|---|---|---|
| `tab_switch` | Berpindah tab atau aplikasi | Ya |
| `window_blur` / `blur` | Jendela ujian kehilangan fokus | Ya |
| `exit_fullscreen` | Keluar dari layar penuh | Ya |
| `restricted_shortcut` | Menekan pintasan keyboard terlarang | Ya |
| `copy_paste_attempt` | Mencoba menyalin atau menempel | Ya |
| `right_click_attempt` | Mencoba membuka menu klik kanan | Ya |
| `tab_close` | Menutup atau meninggalkan tab ujian | Tidak |

`tab_close` tetap disimpan pada audit trail, tetapi tidak menaikkan batas. Event ini juga dapat muncul karena browser crash, tab tertutup, atau pemulihan sesi; menghitungnya sebagai peringatan tersembunyi dapat menutup ujian tanpa peringatan yang dipahami siswa.

Event administratif seperti reset pengawas, terminasi, pergantian perangkat yang diblokir, dan sinkronisasi jawaban terlambat juga tersimpan tetapi tidak dihitung sebagai pelanggaran siswa.

### Tampilan pengawasan

- Kartu pemantauan menggunakan batas ujian yang dipilih dan menampilkan `∞` untuk mode tanpa batas.
- Pelanggaran terbaru menampilkan nama yang mudah dipahami dan waktu kejadian.
- Detail attempt menampilkan label Indonesia, kode event asli, waktu hingga detik, serta durasi bila tersedia.
- Ringkasan API membedakan pindah tab, menutup tab, keluar layar penuh, pintasan terlarang, salin/tempel, klik kanan, dan event lain.

## Berkas utama

- `apps/api/src/proctor/dto/proctor.dto.ts`
- `apps/api/src/proctor/exam-admin.service.ts`
- `apps/api/src/proctoring/proctoring.service.ts`
- `apps/api/src/proctor/exam-monitoring.service.ts`
- `apps/web/components/exams/CreateExamModal.tsx`
- `apps/web/app/components/questions/ExamPage.tsx`
- `apps/web/app/components/questions/ExamViewer.tsx`
- `apps/web/lib/security-violations.ts`
- `apps/api/test/configurable-security-stage74.test.cjs`

## Verifikasi otomatis

- 4 pengujian khusus Tahap 74 lulus: batas server, tanpa batas, Mode Aman nonaktif, kompatibilitas ujian lama, dan keberadaan kontrol form.
- 5 pengujian regresi pengawasan offline Tahap 18 lulus.
- TypeScript API lulus.
- TypeScript web lulus.
- Build NestJS lulus.
- Build produksi web lulus dan memproses 92 halaman.
- ESLint web penuh lulus tanpa error dan warning.

## Batas kemampuan browser

Pemantauan browser memberi bukti perilaku halaman, bukan jaminan pengawasan fisik. Aplikasi web tidak dapat memastikan siswa tidak memakai telepon lain, kamera, mesin virtual, ekstensi khusus, atau perangkat kedua. Screenshot dan perekaman layar juga tidak dapat diblokir secara konsisten pada semua sistem operasi. Audit trail harus dipakai bersama tata tertib, pengawasan ruang, dan pemeriksaan proktor untuk ujian berisiko tinggi.

## Pemeriksaan manual yang tetap diperlukan

1. Buat ujian dengan batas 2, lakukan dua pelanggaran, dan pastikan attempt menjadi `auto_submitted` serta jawaban tersimpan dinilai.
2. Buat ujian tanpa batas, lakukan lebih dari tiga pelanggaran, dan pastikan ujian tetap berjalan sementara semua event tampil pada audit trail.
3. Putuskan jaringan, jawab beberapa soal, lakukan pelanggaran, sambungkan jaringan, dan pastikan jawaban terkirim sebelum attempt ditutup.
4. Reset attempt melalui pengawas dan pastikan hitungan baru dimulai setelah event reset.
5. Uji Chrome dan Edge pada perangkat sekolah karena perilaku fullscreen/fokus dapat berbeda menurut sistem operasi.
