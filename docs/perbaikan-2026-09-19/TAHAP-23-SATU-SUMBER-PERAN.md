# Tahap 23 — Satu sumber peran untuk satu sekolah

Diperbarui 27 September 2026. Tahap ini memeriksa sisa model “peran per organisasi” pada navigasi dashboard setelah browser berhenti mengirim `organizationId` di tahap 22.

## Temuan

Layout memanggil `/auth/me`, lalu memanggil `/auth/role-contexts` untuk menghitung peran sekali lagi. Kedua jalur memakai aturan berbeda:

- `/auth/me` menerima peran dari keanggotaan, metadata SSO, admin platform, alamat superadmin, dan riwayat attempt siswa;
- `/auth/role-contexts` hanya membaca sebagian keanggotaan dan admin platform.

Akibatnya, pengguna yang sah dari metadata SSO atau riwayat attempt dapat mendapat sesi yang benar tetapi dianggap tidak mempunyai konteks peran oleh layout. Respons kedua juga masih mengulang `orgId` dan `orgName` untuk setiap peran, walaupun instalasi hanya mempunyai satu sekolah.

## Perbaikan

- Endpoint NestJS `/auth/role-contexts`, proxy Next.js, dan fungsi kliennya dihapus.
- Layout membentuk daftar peran langsung dari `user.resolved` hasil `/auth/me`.
- `UserRoleContext` sekarang hanya berisi `role`; `orgId` dan `orgName` dihapus.
- Sidebar tidak lagi menerima properti `availableRoles` atau callback pemilih organisasi yang tidak digunakan.
- Saat pengguna membuka jalur peran yang memang diizinkan, layout memakai peran jalur itu untuk menu aktif. Ini mencegah menu Admin tetap tampil ketika pengguna berperan ganda sedang berada pada halaman Guru atau Proktor.
- Prop `orgId` yang sudah tidak dipakai di modal impor soal, pengelola stimulus/instruksi/dimensi/kisi-kisi, dan pengelolaan ruang PAS dihapus.
- Halaman detail PAS tidak lagi meminta data sekolah hanya untuk membuka modal ruang.

## Dampak

Autentikasi, otorisasi backend, dan navigasi sekarang memakai hasil resolusi peran yang sama. Tidak ada query peran kedua yang dapat berbeda hasilnya, satu permintaan jaringan dashboard dihilangkan, dan tipe UI tidak lagi memodelkan pasangan peran-sekolah.

Informasi nama/logo sekolah tetap tersedia melalui endpoint profil untuk keperluan tampilan. Informasi tersebut bukan pemilih scope dan tidak dipakai untuk otorisasi.

## Verifikasi

Empat tes regresi `SCHOOL-ROLE-01` sampai `SCHOOL-ROLE-04` menjaga penghapusan endpoint, bentuk konteks UI, pemakaian peran sesi oleh layout, serta penghapusan prop `orgId` yang tidak dipakai.

Hasil:

- build shared/backend: lulus;
- typecheck frontend: lulus;
- tes khusus tahap 23: 4 lulus, 0 gagal.

Cache tipe route Next.js lama sempat masih merujuk endpoint yang telah dihapus. Tipe route produksi dibuat ulang dan cache tipe mode pengembangan yang basi dibersihkan; tidak ada berkas sumber pengguna yang dihapus.

## Berkas utama

- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/web/lib/rbac.ts`
- `apps/web/app/dashboard/layout.tsx`
- `apps/web/app/components/Sidebar.tsx`
- `apps/api/test/single-school-role-context-stage23.test.cjs`
