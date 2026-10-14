# Notifikasi ujian dan pengumpulan pada batas waktu

## Temuan

- Status koneksi memakai banner fixed di atas layar dengan lapisan lebih tinggi dari halaman ujian; pesan panjang dapat menutupi header.
- Peringatan aktivitas memakai dialog layar penuh meskipun siswa cukup menerima informasi.
- Blur jendela setelah lima detik dihitung sebagai pelanggaran, padahal notifikasi baterai atau dialog sistem dapat menyebabkan blur tanpa menyembunyikan halaman.
- Snapshot beku yang dikirim setelah deadline selalu memerlukan pemulihan, termasuk ketika isi dan versi seluruh jawaban sudah sama persis dengan autosave server.
- Pembukaan ulang sesi pengumpulan yang terkunci sebelum deadline tidak selalu memulihkan snapshot; kesalahan pengumpulan ditampilkan sebagai kesalahan pembukaan ujian.
- Pada pemulihan tanpa konten soal, filter berdasarkan daftar soal kosong dapat mengganti draft lokal dengan jawaban server. Pembersihan cache setelah pengumpulan sukses juga dapat mengubah alur menjadi pengiriman ulang jika penyimpanan gagal.

## Perubahan

- Status koneksi/penyimpanan menjadi informasi kecil di alur header, dengan detail yang dapat dibuka. Peringatan aktivitas tidak memblokir soal dan menutup otomatis setelah delapan detik di halaman utama.
- Blur saat halaman masih terlihat dicatat sebagai `focus_interruption`, tanpa menaikkan warning_count/tab_switch_count. Hilangnya fullscreen bersama fokus juga dicatat sebagai gangguan; siswa tetap harus kembali ke fullscreen. Halaman tersembunyi, keluar fullscreen ketika halaman tetap fokus, dan pintasan terlarang tetap diawasi. Tidak ada klaim bahwa browser dapat mengenali sumber dialog OS secara pasti.
- Backend mengakui snapshot setelah expiry hanya jika data server sudah memuat isi, revisi, lampiran, pengguna, perangkat, dan generasi sesi yang cocok. Tidak ada penulisan jawaban terlambat. Penutupan expiry diperiksa ulang sebelum tanda terima diberikan; terminasi disipliner tidak memperoleh jalur ini.
- Snapshot pengumpulan dipertahankan saat reload dan pemulihan tanpa soal. Pengumpulan yang belum terverifikasi memiliki layar pemeriksaan dan tombol kirim ulang, tanpa membuka kembali waktu pengerjaan.
- Gangguan jaringan saat submit tetap dicoba ulang menggunakan snapshot yang sama. Kegagalan membersihkan cache tidak membatalkan pengumpulan yang telah dikonfirmasi server.

## Batas praktis

Jawaban yang benar-benar belum sampai di server setelah deadline tetap memerlukan pemulihan oleh proktor. Laporan peserta belum dianalisis per identitas karena permintaan tidak menyertakan daftar peserta/sesi. Perubahan kode tidak mengubah data atau nilai peserta yang sudah ada.
