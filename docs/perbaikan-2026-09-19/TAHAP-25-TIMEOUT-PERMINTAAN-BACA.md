# Tahap 25 — Timeout permintaan baca dan pemeriksaan sesi

Diperbarui 27 September 2026. Tahap ini menutup kondisi halaman loading tanpa akhir ketika jaringan, reverse proxy, atau server menerima koneksi tetapi tidak pernah menyelesaikan respons.

## Temuan

Helper `apiGet()` tidak memasang `AbortController` kecuali pemanggil memberi timeout sendiri. Seluruh daftar kelas, bank soal, ujian, monitoring, hasil, analitik, notifikasi, PAS, dan konfigurasi ujian memakai helper tersebut tanpa opsi timeout. Jika koneksi menggantung, promise tidak pernah selesai dan halaman terus menampilkan loading.

Pemeriksaan `/api/auth/me` juga memakai `fetch` langsung tanpa timeout. Karena sebagian besar halaman memeriksa sesi sebelum meminta data, timeout pada `apiGet()` saja belum cukup.

Pesan timeout lama berbunyi “Jawaban akan dicoba lagi” untuk semua jenis permintaan, sehingga menyesatkan ketika kegagalan terjadi pada dashboard atau daftar data.

## Perbaikan

- Semua `apiGet()` mempunyai timeout default 15 detik.
- Pemanggil data berat dapat memilih timeout lain melalui `ApiRequestOptions`.
- Pemeriksaan sesi mempunyai timeout 10 detik.
- Gangguan jaringan saat memeriksa sesi memakai identitas cache terakhir bila tersedia. Cache hanya mengatur tampilan; setiap permintaan tetap diverifikasi JWT dan role guard di backend.
- Respons HTTP 401/403 tetap menghasilkan sesi `null` dan tidak memakai cache lama.
- Pesan timeout dibuat umum: server tidak merespons dan pengguna diminta mencoba lagi.
- Timeout eksplisit autosave, bulk sync, submit, dan proctoring tetap dipertahankan.

## Batas perilaku

Abort di browser menghentikan penantian klien, tetapi tidak membuktikan server membatalkan pekerjaan yang sudah diterima. Karena itu tahap ini hanya memberi timeout default pada GET yang aman diulang. Mutasi non-idempoten tidak diberi timeout global baru; operasi seperti membuat ujian atau kelas perlu idempotency key sebelum retry otomatis dapat diterapkan dengan aman.

## Verifikasi

Enam tes `NET-01` sampai `NET-06` membuktikan abort GET, timeout default, pesan umum, override untuk baca berat, timeout pemeriksaan sesi, dan fallback cache. Tes ketahanan jawaban tahap 13 tetap lulus.

Hasil:

- typecheck frontend: lulus;
- tes tahap 25: 6 lulus, 0 gagal;
- tes ketahanan jawaban: 4 lulus, 0 gagal.

## Berkas utama

- `apps/web/lib/api/client.ts`
- `apps/web/lib/session.ts`
- `apps/api/test/read-timeout-stage25.test.cjs`
