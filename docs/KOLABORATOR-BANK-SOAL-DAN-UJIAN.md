# Kolaborator bank soal dan ujian

Implementasi 23 Oktober 2026 untuk instalasi satu sekolah.

## Penggunaan

1. Buka bank soal atau daftar/monitoring ujian, lalu pilih **Kolaborator**.
2. Pilih Guru, Proktor, atau Admin aktif dan tentukan akses.
3. Opsional: tentukan batas tanggal. Untuk ujian, pembuat/Admin dapat mengizinkan reset, pemulihan, dan susulan secara terpisah.
4. Simpan akses. Penerima akan menemukan bank/ujian dalam daftarnya, termasuk yang masih draft. Bank soal juga memiliki filter **Dibagikan kepada saya**.
5. Pembuat/Admin dapat mengubah atau mencabut akses kapan saja. Permintaan server berikutnya memeriksa ulang izin, termasuk dari editor yang sudah terbuka.

## Tingkat izin

| Izin | Kewenangan |
| --- | --- |
| Pembaca | Membaca isi bank atau monitoring/hasil ujian yang dibagikan |
| Editor | Menyunting isi bank atau pengaturan/operasional ujian yang dibagikan |
| Pengelola | Hak editor dan mengatur kolaborator pembaca/editor |

Pengelola tidak dapat mengganti pembuat, mengangkat pengelola lain, atau memberikan hak reset. Hanya pembuat/Admin dapat memberikan atau mencabut hak pengelola. Menghapus bank/ujian dan menghapus permanen hasil uji coba tetap dibatasi pada pembuat/Admin sesuai aturan ujian yang sudah ada.

Akses bank dan ujian terpisah. Kolaborator bank tidak otomatis menjadi kolaborator ujian, dan kolaborator ujian tidak otomatis mendapat akses bank sumber. Pembaca bank dapat membaca materi soal beserta kuncinya; jangan berikan akses bank kepada peserta ujian. Izin pembaca ujian mencakup monitoring dan data hasil ujian yang dibagikan.

Pencabutan menghentikan izin kolaborasi, bukan izin lain yang masih dimiliki orang tersebut (misalnya Admin, pembuat bank sumber, atau pengawas ruang yang ditugaskan). Materi yang sudah dibaca atau diunduh sebelumnya tidak dapat ditarik kembali.

## Pergantian proktor

Nama pembuat asli tidak diganti dan data ujian tetap tersimpan. Admin dapat menunjuk pengelola baru untuk bank/ujian lama tanpa perlu login sebagai pembuat. Kolaborator tetap memerlukan keanggotaan aktif dan role staf Guru/Proktor/Admin; kehilangan role Proktor saja tidak menghapus grant apabila orang tersebut masih Guru aktif. Gunakan batas tanggal atau pencabutan eksplisit untuk mengakhiri tugas semester.

Fitur ini membagikan akses per bank/ujian. Pengelolaan massal seluruh folder/periode serta jabatan Proktor Utama khusus belum ditambahkan.

## Perlindungan dan penyimpanan

- Semua endpoint memakai identitas sesi terverifikasi; daftar, detail, dan perubahan diperiksa di server.
- Grant tidak di-cache. Grant kedaluwarsa atau dicabut tidak mengizinkan penyimpanan berikutnya.
- Perubahan grant dan audit disimpan dalam satu transaksi dengan lock per sumber daya.
- Detail bank dan ujian memeriksa versi `updated_at` yang dikirim form. Suntingan dengan versi lama ditolak. Soal mempertahankan pemeriksaan `expectedRevision` yang sudah ada.
- Snapshot dan aturan penguncian ujian yang sudah ada tetap berlaku.
- Backup memuat grant dan riwayat akses; restore memetakan UUID pengguna serta mempertahankan pencabutan/batas waktu.
- Ketiga tabel baru mengaktifkan RLS tanpa policy akses browser. Backend tetap memeriksa seluruh akses.

Migrasi: `20261023_02_resource_collaborators.sql` (sudah diterapkan). Pengujian migrasi tanpa perubahan permanen: `node tools/validate-collaboration-migration.cjs`.

Tes utama: `apps/api/test/collaboration-access.test.cjs`; regresi backup, monitoring, publikasi, penghapusan, arsip, dan snapshot ikut diperiksa.
