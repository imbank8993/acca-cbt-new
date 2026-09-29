# Tahap 66 — Sinkronisasi profil dan anggota kelas

Diperbarui 29 September 2026. Tahap ini memperbaiki kegagalan sinkronisasi kelas yang terlihat sebagai dua galat berurutan pada `cbt_profiles` dan `cbt_class_members`.

## Gejala

Saat daftar kelas dibaca, backend menyelaraskan siswa dari data induk. Implementasi lama melakukan upsert seluruh profil siswa, termasuk profil yang sudah ada. Bila nama siswa pada data induk berbeda dari `full_name` profil CBT, trigger keamanan menolak perubahan karena nama dan nomor identitas dikunci setelah profil dibuat.

Satu pernyataan upsert massal bersifat atomik. Penolakan pada satu profil membatalkan pembuatan seluruh profil baru dalam kelompok tersebut. Implementasi lama mengabaikan hasil galat lalu tetap menyisipkan anggota kelas. Anggota yang profilnya belum jadi kemudian ditolak oleh foreign key `cbt_class_members.user_id -> cbt_profiles.id`. Inilah penyebab dua galat muncul berurutan.

## Perbaikan

- Sinkronisasi membaca ID profil CBT yang sudah ada.
- Profil lama tidak lagi ditulis ulang, sehingga nama dan nomor identitas terkunci tetap utuh.
- Hanya profil yang belum ada yang dibuat.
- Pembuatan profil memakai konflik `id` dengan `DO NOTHING`, sehingga dua request bersamaan aman tanpa memperbarui identitas.
- Setiap galat pembacaan dan penulisan diperiksa. Penyimpanan anggota kelas tidak dijalankan bila profil baru gagal dibuat.
- Penyimpanan anggota memakai constraint unik `(class_id, user_id)` secara idempoten, sehingga dua request sinkronisasi bersamaan tidak menghasilkan galat duplikat.

## Database aktif

Pemeriksaan read-only pada PostgreSQL aktif mengonfirmasi:

- primary key `cbt_profiles(id)`;
- foreign key `cbt_class_members.user_id -> cbt_profiles(id)`;
- foreign key `cbt_class_members.class_id -> cbt_classes(id)`;
- unique constraint `cbt_class_members(class_id, user_id)`.

Struktur yang diperlukan sudah tersedia. Tahap ini tidak membutuhkan migrasi SQL.

Audit sebelum pemulihan menemukan 602 pasangan siswa–kelas aktif, dengan 59 profil belum ada dan 81 keanggotaan belum tersimpan. Pemulihan idempoten dijalankan dalam satu transaksi: 59 profil dibuat dan 81 keanggotaan ditambahkan. Audit sesudah commit menghasilkan 0 profil hilang dan 0 keanggotaan hilang. Sebanyak 543 perbedaan nama profil terhadap data pendaftaran tetap dipertahankan sesuai aturan penguncian identitas.

## Verifikasi

- Regresi profil lama tidak ditimpa: lulus.
- Regresi profil baru tetap dibuat dan menjadi anggota kelas: lulus.
- Regresi anggota kelas tidak ditulis bila pembuatan profil gagal: lulus.
- TypeScript backend tanpa incremental cache: lulus.
- Build shared package dan NestJS backend: lulus.
- Pemeriksaan constraint database aktif: lulus.
- Pemulihan dan audit ulang 602 pasangan siswa–kelas pada database aktif: lulus.
- 19 pemeriksaan sinkronisasi kelas, keamanan kelas, jadwal massal PAS, dan katalog mata pelajaran: lulus.

Lint backend belum dapat dijalankan karena workspace backend masih memakai konfigurasi ESLint lama, sedangkan executable yang terpasang adalah ESLint 9 dan memerlukan `eslint.config.*`. TypeScript dan build backend tetap menjadi pemeriksaan kompilasi untuk perubahan ini.

## Dampak operasional

Setelah proses backend memuat ulang perubahan, membuka daftar kelas atau halaman penjadwalan dapat menjalankan sinkronisasi kembali. Profil yang belum ada akan dibuat, lalu keanggotaan kelas yang sebelumnya gagal akan dilengkapi. Nama profil lama tidak diubah otomatis; perubahan identitas tetap harus melalui jalur administrasi yang memang diberi hak melewati penguncian.
