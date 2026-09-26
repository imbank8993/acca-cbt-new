# Tahap 20 — Penguncian aplikasi ke satu sekolah

Diperbarui 26 September 2026. Aplikasi ini dipastikan hanya melayani satu sekolah. Kolom `organization_id` tetap dipertahankan sebagai foreign key internal karena dipakai untuk menghubungkan ujian, bank soal, kelas, anggota, konfigurasi, dan data hasil. Kemampuan memilih atau menyimpan sekolah kedua dihapus.

## Masalah yang ditemukan

Backend sebelumnya masih memiliki beberapa perilaku multi-sekolah:

- sesi pengguna membawa `organizationIds` berbentuk daftar;
- admin platform mendapatkan konteks semu `platform-admin`;
- beberapa daftar menerima nilai `organizationId=all` dan tidak memasang filter sekolah;
- saat membuat ujian, bank soal, kelas, atau konfigurasi, nilai `all` diselesaikan dengan memilih organisasi aktif pertama;
- sinkronisasi SSO mencari sekolah berdasarkan nama dan dapat membuat baris sekolah baru;
- tidak ada aturan database yang mencegah dua baris pada `cbt_organizations`.

Kombinasi tersebut berisiko membuat data ditulis ke sekolah yang salah apabila data lama, konfigurasi, atau parameter browser tidak sesuai.

## Perbaikan

### Satu sumber identitas sekolah

`SingleSchoolService` menjadi sumber identitas sekolah untuk autentikasi dan dasbor. Layanan membaca maksimal dua baris agar kondisi ganda terdeteksi. Nol baris hanya boleh dibuat pada alur bootstrap SSO; lebih dari satu baris menghasilkan respons 503 dan aplikasi gagal tertutup.

`assertSchoolId` menolak ID kosong, `all`, `platform-admin`, dan UUID lain. Pemeriksaan ini dilakukan sebelum pengecualian hak admin platform, sehingga admin tetap tidak dapat berpindah ke sekolah lain.

### Kontrak sesi tunggal

`AuthUser.organizationIds` diganti menjadi `organizationId`. Daftar konteks peran hanya berisi peran pada sekolah instalasi yang sama. Pergantian peran tetap tersedia bagi pengguna yang merangkap peran, tetapi tidak lagi berfungsi sebagai pergantian sekolah.

Sinkronisasi SSO memakai sekolah tunggal yang sama dan tidak lagi mencari atau membuat sekolah berdasarkan nama yang berubah.

### Query selalu dibatasi ke sekolah instalasi

Daftar bank soal, folder, label, ujian, kelas, dan anggota pembuat selalu memakai filter `organization_id`. Jalur khusus `all` dan logika “ambil organisasi aktif pertama” telah dihapus dari layanan bank soal, ujian, kelas, serta konfigurasi ujian.

DTO pembuatan bank soal, ujian, dan konfigurasi ujian sekarang mewajibkan UUID. Nilai teks `all` tidak lagi lolos validasi permintaan.

Teks antarmuka yang masih menampilkan istilah “Organisasi” pada dashboard, kelas, dan editor soal diubah menjadi “Sekolah”. Pemilihan peran bagi pengguna yang merangkap tugas tetap tersedia, namun pencocokan route lama berdasarkan ID atau nama sekolah dihapus.

### Pengaman database

Migrasi `20260926_03_single_school.sql` membuat unique expression index `cbt_organizations_singleton`. Karena semua baris mempunyai nilai indeks konstan yang sama, database hanya mengizinkan paling banyak satu sekolah.

Migrasi tidak menghapus sekolah secara otomatis. Jika data lama sudah memiliki lebih dari satu sekolah, migrasi berhenti dengan petunjuk untuk memeriksa dan menggabungkan data. Ini mencegah pemilihan sekolah yang salah atau penghapusan berantai melalui foreign key.

Validator migrasi dan audit read-only memeriksa index tersebut. Audit juga menjadikan jumlah sekolah selain tepat satu sebagai blocker rollout.

## Verifikasi lokal

Enam tes regresi baru memeriksa:

1. sekolah tunggal dikembalikan sebagai konteks tetap;
2. `all`, `platform-admin`, ID lain, dan ID kosong ditolak;
3. lebih dari satu sekolah membuat layanan gagal tertutup;
4. bootstrap membuat tepat satu sekolah dari konfigurasi;
5. migrasi singleton terdaftar dan layanan lama tidak lagi memiliki cabang `all`;
6. kontrak sesi hanya mempunyai satu `organizationId`.

Hasil verifikasi:

- build TypeScript shared dan backend lulus;
- typecheck frontend lulus;
- 141 tes Node lulus;
- 44 pemeriksaan impor/ekspor dan 13 pemeriksaan service lulus.

## Prosedur rollout

Sebelum memasang migrasi, jalankan audit read-only pada staging. Bila audit melaporkan lebih dari satu sekolah, jangan menghapus baris secara langsung karena foreign key dapat menghapus data sekolah secara berantai. Petakan seluruh `organization_id`, tentukan baris sekolah utama, pindahkan data dengan skrip yang ditinjau, lalu ulangi audit.

Setelah audit staging menunjukkan tepat satu sekolah, jalankan dry-run migrasi ketika tidak ada ujian aktif. Migrasi permanen baru dipasang setelah dry-run berhasil. Perubahan ini belum menjalankan migrasi atau menyentuh database sekolah dari lingkungan pengembangan lokal.

## Batas yang sengaja dipertahankan

Nama tabel `cbt_organizations`, `cbt_organization_members`, dan kolom `organization_id` tetap ada sebagai model relasional internal. Parameter ID juga masih muncul pada sebagian kontrak HTTP untuk kompatibilitas antarmuka saat ini, tetapi nilainya selalu divalidasi terhadap sekolah tunggal. Penghapusan parameter transport dapat dilakukan bertahap tanpa migrasi data dan tidak diperlukan untuk mencegah akses lintas sekolah.
