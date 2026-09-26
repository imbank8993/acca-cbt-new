# Tahap 22 — Konteks sekolah hanya dari sesi terverifikasi

Diperbarui 26 September 2026. Tahap ini menutup sisa kontrak multi-sekolah pada endpoint operasional setelah database dan backup dikunci untuk satu sekolah pada tahap 20–21.

## Masalah yang ditemukan

Browser masih mengirim `organizationId` melalui query string atau body pada fitur analitik, kelas guru, bank soal, PAS/PAT, konfigurasi ujian, dan dasbor proktor. Backend memang memeriksa kewenangan pengguna, tetapi pola tersebut masih memberi kesan bahwa browser boleh memilih sekolah. Risiko lanjutannya adalah endpoint baru dapat lupa memvalidasi ID itu, atau halaman dan server memakai ID yang berbeda.

Kontrak sesi juga masih mengizinkan `organizationId` bernilai `null`, padahal instalasi satu sekolah harus gagal tertutup saat sekolah utama belum tersedia.

## Perbaikan

### Backend

- Ditambahkan decorator `CurrentSchoolId` yang hanya membaca `organizationId` dari pengguna hasil verifikasi JWT.
- Endpoint analitik, guru, bank soal, PAS/PAT, konfigurasi ujian, dan proktor tidak lagi menerima `organizationId` dari query atau body.
- DTO pembuatan bank/folder/label, kelas, periode, konfigurasi ujian, ujian, dan tahun ajaran tidak lagi mempunyai properti pemilih sekolah.
- Controller menyisipkan ID sekolah sesi ke service secara internal.
- Kontrak `AuthUser.organizationId` sekarang wajib berupa string. Jika sesi tidak mempunyai sekolah, permintaan gagal dengan status layanan belum siap dan tidak berjalan tanpa scope.

### Frontend dan proxy

- Fungsi API browser tidak lagi menerima parameter sekolah untuk operasi yang scope-nya sudah diketahui dari sesi.
- Query string dan body tidak lagi memuat `organizationId`.
- Route proxy Next.js hanya meneruskan filter fungsional seperti `onlyPublished`, `activeYearOnly`, dan `limit`.
- Halaman Admin, Guru, Proktor, dan Pengawas diperbarui agar memakai kontrak baru.

Kolom `organization_id` di database tetap dipertahankan sebagai foreign key internal. Perubahan ini hanya menghapus kemampuan browser memilih scope, bukan menghapus pengikat data sekolah.

## Dampak keamanan dan konsistensi

Setelah perubahan ini terdapat satu rantai sumber identitas sekolah:

1. `JwtStrategy` memverifikasi pengguna dan menetapkan sekolah tunggal dari database.
2. `CurrentSchoolId` membaca nilai yang sudah diverifikasi itu.
3. Controller meneruskan nilai tersebut ke service.
4. Browser tidak dapat memilih, mengganti, atau menyelundupkan ID sekolah melalui URL maupun JSON.

Hal ini mengurangi risiko kebocoran lintas scope akibat endpoint baru yang lupa memeriksa parameter sekolah, serta mencegah ketidaksesuaian antara sekolah pada sesi dan sekolah pada payload.

## Verifikasi

Empat tes regresi baru memastikan:

1. seluruh controller terkait memakai `CurrentSchoolId` dan tidak menerima query `organizationId`;
2. DTO publik tidak menerima properti `organizationId`;
3. klien browser dan proxy tidak mengirim pemilih sekolah;
4. kontrak sesi hanya memiliki satu `organizationId` yang wajib dan decorator gagal tertutup bila nilainya tidak ada.

Hasil pemeriksaan:

- build shared dan backend: lulus;
- typecheck frontend: lulus;
- tes tahap 20 dan 22: 10 lulus, 0 gagal;
- seluruh tes regresi Node yang dijalankan serial: 147 lulus, 0 gagal;
- `git diff --check`: tidak menemukan kesalahan whitespace.

Saat typecheck akhir, tiga komponen editor media masih merujuk variabel lokal
`isOpen` yang sudah dipindahkan ke wrapper komponen. Pemeriksaan ganda pada
konten modal Audio, Grafik, dan Video dihapus; wrapper tetap menahan render saat
modal tertutup. Ini memperbaiki tiga error TypeScript tanpa mengubah perilaku
modal.

Runner `node --test` paralel tidak dapat membuat child process pada sandbox Windows ini (`spawn EPERM`). Semua berkas tes kemudian dijalankan satu per satu dengan Node dan lulus. Percobaan menjalankan semua berkas dalam satu proses tidak dipakai sebagai hasil karena dua tes ZIP bergantung pada isolasi modul.

## Batas verifikasi

Tahap ini belum menjalankan browser nyata atau database staging. Pengujian staging tetap perlu memastikan cookie/JWT produksi selalu membawa sekolah, pengguna lama mendapat sesi baru setelah deploy, dan semua alur halaman utama berhasil tanpa parameter sekolah pada jaringan browser.

## Berkas utama

- `apps/api/src/common/decorators/current-school-id.decorator.ts`
- controller dan DTO di modul `analytics`, `teachers`, `questions`, `pas`, `exam-configs`, dan `proctor`
- `apps/web/lib/api/*.ts`
- `apps/web/app/api/**/route.ts`
- `packages/shared/src/api.ts`
- `apps/api/test/single-school-transport-stage22.test.cjs`
