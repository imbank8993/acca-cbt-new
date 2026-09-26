# SOP pemulihan jawaban offline setelah waktu ujian

Diperbarui 26 September 2026. Prosedur ini digunakan ketika siswa tetap mengerjakan pada halaman yang sudah terbuka saat jaringan terputus, tetapi koneksi belum pulih sampai deadline server lewat.

## Prinsip keamanan

Jawaban yang baru datang setelah deadline tidak diterima otomatis. Browser tidak dapat membuktikan kapan jawaban lokal dibuat, sehingga hanya staf ujian yang berwenang dapat membuka masa pemulihan. Setiap pembukaan mencatat aktor, alasan, status dan deadline sebelumnya, jumlah jawaban server, waktu reset dari jam database, serta tenggat pemulihan.

Pemulihan tidak memindahkan jawaban antar-attempt atau antarsiswa. API tetap memeriksa pengguna login, pemilik attempt, perangkat yang diikat ulang, status `in_progress`, soal/opsi ujian, dan deadline pemulihan.

## Syarat sebelum pemulihan

1. Siswa mempertahankan browser, profil browser, dan perangkat yang menyimpan jawaban. Jangan menghapus data situs, memakai mode pembersihan otomatis, atau berpindah perangkat.
2. Proktor memastikan gangguan jaringan atau perangkat memang terjadi dan mencatat alasan konkret. Contoh: “Jaringan ruang 3 terputus pukul 10.05–10.22”.
3. Attempt sudah berstatus `submitted` atau `auto_submitted`. Attempt yang masih berjalan tidak di-reset.
4. Nama siswa, ujian, dan attempt pada monitoring harus cocok. Jangan memilih siswa hanya berdasarkan urutan baris.

## Langkah proktor

1. Buka monitoring ujian dan pilih siswa yang terdampak.
2. Pilih **Reset/Pulihkan ujian**.
3. Isi alasan pemulihan sepanjang 5–500 karakter. Alasan ini disimpan pada jejak audit dan tidak berasal dari siswa.
4. Periksa ringkasan konfirmasi, lalu lanjutkan. Bila deadline telah lewat, server memberikan masa pemulihan 15 menit berdasarkan jam database.
5. Catat jumlah jawaban yang sudah berada di server dan tenggat yang ditampilkan setelah reset.

Jika penulisan audit gagal, reset dibatalkan seluruhnya dan attempt tetap tertutup. Jangan meminta siswa melanjutkan sebelum layar proktor menyatakan pemulihan berhasil.

## Langkah siswa

1. Gunakan perangkat dan profil browser yang sama, lalu buka kembali ujian setelah proktor menyatakan reset berhasil.
2. Periksa banner pemulihan. Banner menampilkan tenggat, jumlah jawaban pada penyimpanan lokal, dan jumlah jawaban pada server.
3. Biarkan halaman tetap terbuka dan tersambung. Aplikasi mengirim ulang snapshot lokal melalui validasi jawaban biasa.
4. Tunggu sampai peringatan “jawaban belum tersimpan” hilang. Jumlah server pada banner diperbarui setelah bulk sync berhasil.
5. Tinjau jawaban, lalu submit sebelum tenggat pemulihan. Jangan menutup atau me-refresh halaman selama sinkronisasi.

## Verifikasi setelah pemulihan

Proktor memastikan attempt kembali berstatus final dan membandingkan:

- jumlah lokal yang terlihat pada awal pemulihan;
- jumlah jawaban server setelah sinkronisasi;
- jumlah jawaban pada review hasil;
- event `RESET_BY_PROCTOR` dan alasan pada log keamanan;
- waktu submit akhir terhadap `recovery_until`.

Perbedaan jumlah tidak selalu berarti kehilangan jawaban karena soal yang sengaja kosong tidak membuat baris. Namun, jumlah server yang lebih kecil daripada jumlah lokal setelah sinkronisasi tanpa peringatan harus diinvestigasi sebelum nilai diumumkan.

## Kondisi yang tidak dapat dipulihkan otomatis

- Data browser telah dihapus atau penyimpanan lokal ditolak browser.
- Siswa berpindah perangkat dan perangkat lama tidak tersedia.
- Cache lokal rusak atau tidak memuat jawaban.
- Tenggat pemulihan kembali habis sebelum sinkronisasi dan submit selesai.

Pada kondisi tersebut, jangan membuat jawaban pengganti secara manual tanpa kebijakan sekolah. Simpan bukti gangguan, log audit, dan keputusan akademik yang diambil.

## Catatan rollout

Endpoint reset sekarang mewajibkan field `reason`. Semua layar monitoring bawaan sudah mengirimkannya. Klien lama yang masih mengirim body kosong akan menerima validasi 400 dan harus diperbarui sebelum fitur ini digunakan di produksi.
