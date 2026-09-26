# Penyimpanan jawaban offline durable

Diperbarui 26 September 2026. Dokumen ini menjelaskan implementasi ANS-06 pada halaman pengerjaan ujian.

## Tujuan

Snapshot jawaban harus tetap dapat dipulihkan setelah reload atau crash browser ketika autosave belum mencapai server. Penyimpanan ini merupakan lapisan pemulihan, bukan pengganti autosave server dan bukan bukti waktu pembuatan jawaban.

## Arsitektur

IndexedDB `acca-cbt-exam` menjadi penyimpanan utama. Object store `answer-snapshots` menyimpan satu record per `attemptId` berisi peta jawaban, daftar tanda ragu, dan waktu update. Object store `settings` menyimpan ID perangkat browser agar kunci perangkat tetap stabil ketika `localStorage` ditolak.

Setiap perubahan juga dicerminkan ke kunci legacy `localStorage` `exam_answers_{attemptId}`. Salinan ini berfungsi sebagai fallback pada browser yang tidak mendukung atau memblokir IndexedDB. Cache dari versi aplikasi lama dibaca dan dimigrasikan ke IndexedDB secara best-effort ketika ujian dibuka.

Penulisan per attempt diserialisasi. Perubahan kedua menunggu transaksi perubahan pertama selesai sehingga transaksi lambat tidak dapat menimpa snapshot yang lebih baru. Penghapusan setelah submit juga masuk antrean yang sama agar write yang masih berjalan tidak membuat kembali cache setelah server mengonfirmasi submit.

## Pemeriksaan sebelum attempt dimulai

Halaman melakukan operasi tulis dan hapus nyata pada IndexedDB sebelum memanggil endpoint start. Pemeriksaan juga meminta storage persistence bila browser mendukungnya dan membaca estimasi kapasitas.

- IndexedDB sehat: ujian dapat dimulai.
- IndexedDB sehat tetapi persistence tidak dijamin: ujian dapat dimulai dengan peringatan agar mode privat dan pembersihan data situs tidak digunakan.
- Ruang tersisa kurang dari 5 MB: ujian dapat dimulai dengan peringatan ruang hampir penuh.
- IndexedDB gagal tetapi `localStorage` sehat: ujian memakai fallback dengan peringatan agar tab tidak ditutup atau di-reload saat offline.
- Keduanya gagal: attempt tidak dibuat dan siswa diminta memakai browser lain atau menonaktifkan mode privat.

Pemeriksaan dilakukan sebelum `startExamAttemptAction`, sehingga kegagalan storage tidak meninggalkan attempt aktif yang belum pernah menampilkan soal.

## Siklus data

1. Saat siswa memilih jawaban atau mengubah tanda ragu, state UI diperbarui dan snapshot masuk antrean IndexedDB.
2. Autosave server tetap berjalan terpisah. Kegagalan salah satu lapisan tidak dianggap keberhasilan lapisan lain.
3. Setelah reload, jawaban server dimuat lebih dulu lalu ditimpa snapshot lokal untuk mempertahankan perubahan terakhir yang mungkin belum tersinkron.
4. Saat koneksi pulih, snapshot dikirim melalui bulk sync yang memvalidasi pemilik, perangkat, status, deadline, soal, dan opsi.
5. Setelah submit sukses dikonfirmasi server, snapshot IndexedDB dan fallback `localStorage` dihapus. Snapshot dipertahankan bila server hanya menilai jawaban yang sudah tersimpan karena deadline telah lewat.

## Identitas perangkat

ID perangkat tetap berupa UUID acak per profil browser, bukan fingerprint perangkat keras. Nilainya kini disimpan dalam object store `settings` dan disalin ke `localStorage` bila tersedia. Transaksi readwrite membuat dua tab pertama yang dibuka bersamaan memilih nilai yang sama. Menghapus seluruh data situs tetap menghasilkan ID baru dan memerlukan reset proktor.

## Batas keamanan dan ketahanan

- IndexedDB berada pada origin dan profil browser yang sama; cache tidak berpindah perangkat atau browser.
- Pengguna atau kebijakan perangkat tetap dapat menghapus storage.
- Persistence API adalah permintaan kepada browser, bukan jaminan absolut pada kerusakan disk atau penghapusan manual.
- Snapshot lokal tidak dipercaya untuk melewati deadline. Pemulihan setelah deadline tetap mengikuti [SOP pemulihan jawaban offline](SOP-PEMULIHAN-JAWABAN-OFFLINE.md).
- Lampiran tugas yang sudah berupa URL masih memakai cache kompatibilitas terpisah; berkas mentah tidak disimpan di IndexedDB.

## Pengujian

Tes tahap 17 memeriksa serialisasi write, fallback ketika IndexedDB tidak tersedia, pemblokiran start ketika seluruh storage ditolak, urutan preflight sebelum start, migrasi cache lama, permintaan persistence, pemeriksaan kapasitas, cleanup setelah submit, dan persistence ID perangkat.
