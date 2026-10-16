# Screenshot indikasi pelanggaran

Fitur nonaktif secara bawaan. Pembuat ujian dapat memilih **Aktifkan Screenshot Pelanggaran**.
Pada folder PAS/PAT, pilihan saat membuat folder diterapkan pada ujian yang kemudian dibangkitkan dari folder tersebut.
Pilihan yang sama tersedia pada penyuntingan ujian biasa. Perubahan berlaku ketika halaman ujian siswa membaca konfigurasi terbaru.

## Sebelum dipakai

1. Terapkan migrasi `20261016_02_exam_screenshots.sql`, lalu jalankan versi aplikasi yang sesuai.
2. Konfigurasikan penyimpanan R2 yang sudah dipakai aplikasi.
3. Sebaiknya isi `SCREENSHOT_ENCRYPTION_KEY` dengan rahasia acak minimal 32 karakter sebelum gambar pertama disimpan.
   Jika kosong, kunci diturunkan dari `JWT_SECRET` dengan konteks tersendiri. Jangan mengganti kunci selama gambar lama masih dibutuhkan.
4. Gunakan HTTPS dan browser desktop yang mendukung berbagi layar. Perangkat/browser tanpa dukungan tersebut tidak dapat memulai ujian yang mewajibkan SS.

Siswa harus menyetujui berbagi **Seluruh Layar / Entire Screen**, bukan tab atau jendela.
Permintaan izin dibuka dari tombol siswa, bukan secara tersembunyi. Jika berbagi dihentikan, halaman meminta siswa membagikannya kembali;
waktu tetap berjalan, jawaban tetap tersimpan, dan penghentian dicatat tanpa menambah peringatan kecurangan.
Tidak ada audio atau video rekaman yang diunggah. Hanya frame tertentu saat kejadian yang dikirim.

## Ukuran dan masa simpan

- JPEG/WebP maksimal 200 KiB (204800 byte) sebelum enkripsi.
- Maksimal 10 gambar per attempt/peserta dalam satu ujian, termasuk setelah pemulihan atau susulan.
- Jeda minimal 30 detik. Kuota/jeda diperiksa ulang di server dengan lock, sehingga reload tidak mereset kuota.
- Gambar memiliki tenggat 7 hari sejak disimpan. Akses gambar ditolak setelah tenggat, walaupun penghapusan R2 sedang tertunda.
- Worker API berjalan saat startup dan setiap jam. Worker menghapus objek kedaluwarsa dan menyapu objek yatim pada prefix `exam-evidence/`.
  Jika API atau R2 sedang tidak tersedia, penghapusan fisik dicoba lagi pada putaran berikutnya. Log kejadian tidak dihapus.
- Sebagai lapisan tambahan, operator dapat memasang aturan lifecycle R2 **hanya** pada prefix `exam-evidence/`, hapus setelah 7 hari.
  Jangan menerapkan aturan ini ke seluruh bucket yang juga berisi soal dan lampiran.

Gambar dikompresi di browser. Jika gambar tidak dapat diperkecil, jaringan gagal, atau kuota telah tercapai, log kejadian tetap berjalan.
Screenshot merupakan bukti pendukung untuk ditinjau pengawas, bukan kesimpulan otomatis bahwa siswa curang.

## Privasi dan akses

Objek R2 dienkripsi AES-256-GCM sebelum diunggah dengan ekstensi `.bin`. Bucket publik sekalipun hanya menyajikan ciphertext.
URL penyimpanan umum tidak menyediakan bukti ini. Gambar asli hanya dibaca melalui endpoint khusus berautentikasi, dengan `private, no-store`.
Siswa tidak diberi akses membaca gambar. Hak pengawas mengikuti ruang/sesi PAS; pemilik bank soal mengikuti hak monitoring kelas;
Admin/Proktor mengikuti izin monitoring yang sudah ada. Buka **Monitoring → Jawaban & waktu ujian → Detail → Bukti Screenshot**.

Browser tetap menjadi batas kepercayaan: server memeriksa akun/perangkat, kejadian, ukuran, kuota dan masa simpan,
tetapi tidak dapat membuktikan bahwa klien yang dimodifikasi masih membagikan layar asli. Satu monitor yang dipilih yang tertangkap, bukan semua monitor.
