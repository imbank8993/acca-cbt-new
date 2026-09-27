# Tahap 30 — Integritas penugasan ruang PAS

Diperbarui 27 September 2026. Tahap ini melindungi penggantian pengawas dan pemindahan siswa antar-ruang dari kehilangan data, kelebihan kapasitas, pengguna tidak sah, duplikasi input, dan relasi periode yang tidak konsisten.

## Temuan

Penggantian daftar pengawas sebelumnya menghapus seluruh daftar lama lalu melakukan insert daftar baru sebagai operasi terpisah. Bila insert gagal, ruang kehilangan semua pengawas.

Pemindahan siswa mempunyai pola serupa: penugasan lama dalam periode dihapus lebih dulu, lalu penugasan ruang baru ditulis tanpa transaksi. Gangguan database pada operasi kedua dapat membuat siswa tidak mempunyai ruang.

Masalah lain yang ditemukan:

- kapasitas ruang hanya ditampilkan di UI dan tidak ditegakkan server;
- dua admin dapat membaca sisa kapasitas yang sama lalu sama-sama mengisinya;
- `roomId` belum dipastikan berasal dari `periodId` yang dikirim;
- ID pengguna ganda dapat dikirim dan dihitung lebih dari sekali;
- server belum memastikan siswa/pengawas adalah anggota aktif sekolah dengan peran yang tepat;
- UI baru memberi warna merah setelah ruang telanjur melebihi kapasitas;
- daftar calon pengawas tidak menampilkan Proktor dan Admin yang sah.

## Perbaikan pengawas

Penggantian pengawas sekarang berjalan dalam satu transaksi dengan advisory lock per ruang. Server membaca periode dan sekolah ruang, menghapus ID ganda, lalu memastikan seluruh pengguna adalah anggota aktif dengan salah satu peran Guru, Pengawas, Proktor, atau Admin.

Daftar lama baru dihapus setelah validasi selesai. Penghapusan dan insert daftar baru berada dalam transaksi yang sama. Jika insert gagal, rollback mengembalikan daftar lama.

Daftar calon pengawas di UI sekarang mencakup keempat peran tersebut.

## Perbaikan peserta dan kapasitas

Pemindahan siswa menggunakan advisory lock per periode. Seluruh perubahan ruang dalam periode yang sama diserialkan sehingga dua petugas tidak dapat menghabiskan sisa kapasitas yang sama secara bersamaan.

Server kemudian:

1. memastikan ruang berada pada periode yang dikirim;
2. memastikan seluruh pengguna adalah anggota aktif dengan peran Siswa;
3. membaca isi ruang terbaru;
4. tidak menghitung ulang siswa yang sudah berada di ruang tujuan;
5. menolak pemindahan yang melebihi kapasitas;
6. menghapus penugasan lama dan menulis ruang baru dalam transaksi yang sama.

Jika insert ruang baru gagal, siswa tetap berada di ruang lama.

UI Admin dan Proktor menampilkan jumlah terisi, kapasitas total, dan sisa tempat. Tombol penambahan dinonaktifkan dan pesan terlihat sebelum request dikirim bila pilihan melebihi sisa kapasitas. Server tetap menjadi pengaman utama karena kapasitas dapat berubah dari browser lain.

## Perlindungan database

Audit baca-saja pada `acca_db` sebelum migrasi menemukan:

- penugasan dengan periode ruang berbeda: 0;
- ruang melebihi kapasitas: 0;
- kapasitas kosong/tidak positif: 0;
- penugasan siswa dengan anggota/peran tidak sah: 0;
- penugasan pengawas dengan anggota/peran tidak sah: 0.

Migrasi `20260927_05_pas_room_integrity.sql` kemudian menambahkan:

- `capacity NOT NULL`;
- check constraint `capacity > 0`;
- indeks unik `(id, pas_period_id)` pada ruang;
- foreign key gabungan `(pas_room_id, pas_period_id)` dari peserta ke ruang.

Foreign key gabungan mencegah impor, restore, atau kode lain menempatkan siswa pada periode yang berbeda dari ruangnya. Constraint lama yang menjamin satu siswa per periode dan satu pengawas per ruang tetap dipertahankan.

Migrasi telah diterapkan permanen ke `acca_db`. Verifikasi melalui koneksi baru menemukan 2/2 constraint tersedia dan tervalidasi, 1/1 indeks tersedia, serta kolom kapasitas berstatus `NOT NULL`.

## Verifikasi

Sembilan tes `ROOM-01` sampai `ROOM-09` membuktikan:

- ID pengawas ganda disimpan sekali;
- kegagalan insert pengawas memulihkan daftar lama;
- siswa dapat dipindahkan atomik;
- siswa yang sudah berada di ruang tujuan tidak mengurangi kapasitas dua kali;
- kegagalan insert siswa memulihkan ruang lama;
- kapasitas ditegakkan sebelum pemindahan;
- ruang lintas periode ditolak;
- siswa/pengawas dengan peran salah ditolak;
- transaksi dan advisory lock tetap digunakan;
- UI Admin/Proktor menampilkan dan menegakkan sisa kapasitas;
- migrasi menjaga kapasitas dan kesamaan periode.

Hasil akhir:

- 9 tes Tahap 30: lulus;
- 195 tes regresi Node dalam 29 berkas: lulus;
- typecheck frontend: lulus;
- build shared dan backend: lulus;
- dry run 12 migrasi, 28 kolom, dan 28 indeks: lulus;
- migrasi Tahap 30: diterapkan permanen dan diverifikasi.

## Batas lanjutan

Validasi role dilakukan service karena bergantung pada beberapa tabel keanggotaan dan dapat berubah. Backup/restore administratif harus tetap melalui audit integritas setelah pemulihan.

Tahap berikutnya perlu menyatukan penghapusan jadwal atau konfigurasi dengan penghapusan ujian hasil generate. Saat ini operasi tersebut masih dapat berhenti setelah salah satu sisi terhapus.

## Berkas utama

- `apps/api/src/pas/pas-rooms.service.ts`
- `apps/api/src/pas/pas.service.ts`
- `apps/web/app/dashboard/admin/pas/RoomManagementModal.tsx`
- `apps/web/app/dashboard/proktor/pas/RoomManagementModal.tsx`
- `database/migrations/20260927_05_pas_room_integrity.sql`
- `apps/api/test/pas-room-integrity-stage30.test.cjs`
