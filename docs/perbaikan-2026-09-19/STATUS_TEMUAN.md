# Status temuan audit

Diperbarui 20 September 2026. [Rincian perubahan dan pengujian](../PERBAIKAN_AUDIT_2026-09-19.md). Status selesai adalah implementasi lokal, belum validasi deployment. Tahap 4 masih berlangsung dan belum ditandai selesai.

| ID | Prioritas | Tahap | Status | Temuan |
|---|---|---|---|---|
| SEC-01 | P1 | 1 | Implementasi dan tes lokal selesai | Akses langsung ujian melewati penugasan peserta |
| SEC-02 | P1 | 1 | Implementasi dan tes lokal selesai | Metadata kunci jawaban ikut dikirim ke siswa |
| SEC-03 | P1 | — | Belum dikerjakan | Deadline dan pengikatan perangkat tidak ditegakkan saat menyimpan jawaban |
| SEC-04 | P1 | 1 | Implementasi dan tes lokal selesai | ID pengerjaan tidak dicocokkan dengan ID ujian saat submit |
| SEC-05 | P2 | 2 | Implementasi dan tes lokal selesai | Preferensi notifikasi dapat ditulis ke user_id pengguna lain |
| SEC-06 | P1 | 2 | Implementasi dan tes lokal selesai | Penghapusan berkas non-assignment tidak memeriksa pemilik |
| SEC-07 | P1 | 2 | Implementasi dan tes lokal selesai | Upsert soal dan opsi menerima ID resource asing |
| SEC-08 | P1 | 2 | Implementasi dan tes lokal selesai | Penilaian esai dapat menargetkan answer ID dari pengerjaan lain |
| SEC-09 | P1 | 2 | Implementasi dan tes lokal selesai | Siswa dapat memalsukan event reset proktor |
| SEC-10 | P1 | — | Belum dikerjakan | Terminasi ulang membuka kembali jendela susulan jawaban |
| SEC-11 | P2 | 2 | Implementasi dan tes lokal selesai | Impor soal memakai izin lebih longgar daripada editor bank |
| SEC-12 | P1 | — | Belum dikerjakan | Arsip backup diproses dan diunggah sebelum autentikasi/otorisasi final |
| SEC-13 | P1 | — | Belum dikerjakan | Ekspor backup melakukan fetch URL gambar tanpa pembatasan tujuan |
| SEC-14 | P1 | 1 | Parsial — menunggu penutupan SEC-10 | Kebijakan hasil ujian diterapkan tidak konsisten di API |
| BUG-01 | P1 | 2 | Implementasi dan tes lokal selesai | Unggah berhasil di server tetapi dianggap gagal oleh UI |
| BUG-02 | P1 | — | Belum dikerjakan | Restore ZIP bergambar merusak signature sebelum diverifikasi |
| BUG-03 | P1 | — | Belum dikerjakan | Submit dapat berhasil meski penyimpanan jawaban gagal |
| BUG-04 | P1 | — | Belum dikerjakan | Restore menghapus data sebelum validasi lengkap dan tanpa transaksi |
| BUG-05 | P1 | — | Belum dikerjakan | Cakupan backup tidak lengkap untuk fitur aplikasi sekarang |
| BUG-06 | P1 | 2 | Implementasi dan tes lokal selesai | Nilai esai tidak dibatasi dan status penilaian selesai terlalu dini |
| BUG-07 | P2 | 2 | Implementasi dan tes lokal selesai | Bobot opsi nol berubah menjadi satu |
| BUG-08 | P1 | — | Belum dikerjakan | Autosave jawaban rentan tertimpa request lama |
| BUG-09 | P1 | — | Belum dikerjakan | Kegagalan localStorage menghentikan autosave ke server |
| BUG-10 | P2 | — | Belum dikerjakan | Resume sesudah akhir global dapat menutup jalan pemulihan offline |
| BUG-11 | P1 | — | Belum dikerjakan | Pemeriksaan soal yang sudah dipakai tidak mengikuti relasi jawaban aktual |
| BUG-12 | P2 | — | Belum dikerjakan | Dukungan bank soal legacy tidak konsisten antarjalur |
| BUG-13 | P2 | 1 | Implementasi dan tes lokal selesai | Ujian public dapat diterbitkan tetapi tidak muncul di daftar siswa |
| BUG-14 | P2 | — | Belum dikerjakan | Hook React diletakkan setelah conditional return |
| BUG-15 | P1 | 3 | Implementasi dan tes lokal selesai | Regrade mengabaikan kontribusi nilai esai pada total |
| BUG-16 | P1 | 3 | Implementasi dan tes lokal selesai | Pilihan duplikat dapat memanipulasi skor |
| UX-01 | P2 | 4 | Implementasi dan tes lokal selesai | Dashboard pengawas menampilkan statistik dan kejadian contoh sebagai data aktif |
| UX-02 | P2 | — | Belum dikerjakan | Kegagalan API disamarkan menjadi daftar kosong |
| UX-03 | P2 | — | Belum dikerjakan | Fallback autentikasi dapat tetap menampilkan loading tanpa jalan keluar |
| UX-04 | P2 | 1 | Implementasi dan tes lokal selesai | Daftar hasil menyebut pengerjaan aktif sebagai selesai |
| UX-05 | P2 | — | Belum dikerjakan | Hitungan jawaban salah dapat negatif setelah penilaian esai |
| UX-06 | P2 | — | Belum dikerjakan | Waktu hasil dan jadwal menggunakan zona waktu berbeda |
| UX-07 | P2 | — | Belum dikerjakan | Navigasi kartu dan kontrol toggle tidak sepenuhnya dapat diakses dengan keyboard |
| UX-08 | P2 | — | Belum dikerjakan | Respons monitoring lama dapat menimpa ujian yang baru dipilih |
| UX-09 | P2 | — | Belum dikerjakan | Detail jadwal PAS tidak menjelaskan hasil pembuatan parsial |
| UX-10 | P2 | — | Belum dikerjakan | Notifikasi lama tidak memiliki jalur pagination yang jelas |
| UX-11 | P2 | — | Belum dikerjakan | Ekspor jawaban analitik kehilangan isi tipe soal kompleks |
| UX-12 | P2 | — | Belum dikerjakan | Indikator tren dapat menyatakan naik saat nilai menurun |
| QA-01 | P2 | — | Belum dikerjakan | Lint frontend belum menjadi pemeriksaan kualitas yang lulus |
| QA-02 | P2 | — | Belum dikerjakan | Pengujian yang tersedia belum mencakup integritas alur lintas layanan |
| QA-03 | P3 | — | Belum dikerjakan | Halaman role yang diduplikasi memperbesar risiko perbaikan tidak merata |
