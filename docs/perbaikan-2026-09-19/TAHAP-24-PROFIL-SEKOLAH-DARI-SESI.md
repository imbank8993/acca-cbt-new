# Tahap 24 — Profil sekolah operasional dari sesi

Diperbarui 27 September 2026. Tahap ini menghapus permintaan profil sekolah yang masih menjadi gerbang pemuatan halaman setelah scope sekolah dipindahkan ke sesi.

## Temuan

Sebanyak 25 halaman Admin, Proktor, Guru, dan Pengawas memanggil `getProctorOrganization()` atau `getGuruOrganization()` sebelum meminta data utamanya. Bank soal, ujian, kelas, monitoring, penilaian, analitik, dan PAS hanya dimuat bila endpoint profil sekolah mengembalikan objek.

Pola ini menimbulkan dua masalah:

1. kegagalan endpoint informasi sekolah membuat halaman kosong atau mengarahkan pengguna ke login, walaupun sesi dan endpoint data utama masih sah;
2. endpoint Guru mencari keanggotaan organisasi lagi, sehingga pengguna yang mendapat peran dari metadata SSO dapat menerima `null` meskipun backend telah menetapkan sekolah tunggal pada sesi.

## Perbaikan

- `AuthUser` sekarang membawa `organizationName` bersama `organizationId`.
- `SingleSchoolService` tetap menjadi sumber data sekolah; `CbtRolesService` memasukkan ID dan nama sekolah ke konteks sesi yang diverifikasi.
- Login biasa, login SSO, dan validasi JWT menghasilkan kontrak sekolah yang sama.
- Helper `getProctorOrganization()` dan `getGuruOrganization()` membaca cache `/auth/me` melalui `getSessionUser()`, tanpa permintaan jaringan tambahan.
- Endpoint `/proctor/organization` dan `/teachers/organization`, route proxy Next.js, serta query service yang redundan dihapus.

Nama sekolah hanya dipakai untuk tampilan. Otorisasi tetap memakai `organizationId` yang ditentukan backend dan tidak menerima pemilih sekolah dari browser.

## Dampak

- Pemuatan halaman tidak lagi bergantung pada endpoint profil sekolah kedua.
- Akun berbasis metadata SSO tidak lagi gagal karena tidak mempunyai baris keanggotaan yang dicari endpoint Guru lama.
- Permintaan jaringan awal berkurang pada seluruh halaman staf.
- Nama sekolah tetap tersedia tanpa menghidupkan kembali model multi-sekolah.

## Verifikasi

Empat tes `SCHOOL-PROFILE-01` sampai `SCHOOL-PROFILE-04` memeriksa kontrak sesi, penghapusan endpoint, pemakaian cache sesi di frontend, dan penghapusan query service lama.

Hasil:

- build shared/backend: lulus;
- typecheck frontend: lulus;
- tes khusus tahap 24: 4 lulus, 0 gagal.

## Berkas utama

- `packages/shared/src/api.ts`
- `apps/api/src/auth/cbt-roles.service.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/jwt.strategy.ts`
- `apps/web/lib/api/proctor.ts`
- `apps/web/lib/api/teachers.ts`
- `apps/api/test/single-school-session-profile-stage24.test.cjs`
