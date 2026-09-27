# Tahap 42 — PWA shell ujian offline

Diperbarui 28 September 2026. Tahap ini melengkapi cache data Tahap 41 dengan halaman dan aset aplikasi yang diperlukan untuk membuka kembali route ujian ketika host aplikasi sedang tidak dapat dijangkau.

## Temuan

IndexedDB sudah menyimpan soal, attempt, identitas, deadline, posisi, dan jawaban. Namun browser tetap membutuhkan dokumen HTML serta JavaScript/CSS Next.js untuk menjalankan kode pemulihan tersebut. Jika reload terjadi ketika host tidak dapat dijangkau dan cache HTTP biasa sudah dibuang, browser hanya menampilkan halaman gagal tersambung meskipun seluruh data ujian masih aman.

Service worker umum yang menyimpan seluruh dashboard juga tidak aman. Respons API, halaman hasil, identitas pengguna, atau halaman staf dapat tertinggal pada perangkat bersama. Cache login/redirect yang tersimpan sebagai halaman ujian juga dapat membuat recovery gagal atau menampilkan halaman yang salah.

## Perbaikan

Service worker `/exam-sw.js` didaftarkan pada produksi dari layout utama. Manifest PWA menyediakan identitas aplikasi dan mode tampilan standalone. Header service worker memaksa browser memeriksa versi terbaru dan memberi scope root secara eksplisit.

Cakupan cache dibatasi sebagai berikut:

- hanya navigasi `/dashboard/siswa/exam/{id}` yang memiliki fallback offline;
- `/api/*`, mutasi, halaman hasil, dashboard staf, dan route lain tidak pernah dicegat;
- HTML memakai strategi network-first dan cache hanya dipakai ketika request jaringan benar-benar gagal;
- respons redirect, respons non-HTML, origin lain, dan status gagal tidak boleh mengganti shell ujian;
- JavaScript, CSS, font, dan gambar same-origin hanya di-cache ketika client sedang membuka route ujian;
- cache memakai versi tersendiri dan versi lama dihapus saat worker baru aktif.

Setelah server memverifikasi pembukaan ujian dan IndexedDB berhasil menulis paket recovery, halaman meminta service worker menyimpan route ujian beserta chunk Next.js yang sudah dimuat. MessageChannel menunggu konfirmasi worker; jika persiapan gagal, siswa mendapat peringatan untuk tidak menutup browser ketika offline.

## Hubungan dengan keamanan Tahap 41

PWA hanya menyediakan program untuk menjalankan halaman. PWA tidak memberikan izin membuka soal. Setelah shell terbuka, Tahap 41 tetap mewajibkan kecocokan ujian, siswa, perangkat, attempt, dan deadline. Semua request keluar tetap ditahan sampai server memvalidasi attempt yang sama.

Cache shell dihapus setelah submit dikonfirmasi, server menolak attempt, server mengembalikan attempt berbeda, atau pengguna menekan Logout. Pada logout, penghapusan dilakukan melalui service worker dan Cache API langsung agar tetap bekerja ketika worker baru saja diperbarui.

## Batas operasional

Service worker aktif pada build produksi melalui HTTPS, atau pada `localhost` yang diperlakukan browser sebagai secure context. Mode development hanya mengaktifkannya bila `NEXT_PUBLIC_ENABLE_EXAM_PWA=true`, untuk mencegah chunk development lama mengganggu pekerjaan pengembang.

Gambar soal dari origin eksternal tidak dipaksa masuk cache. Gambar yang disajikan melalui `/_next/image` atau URL same-origin tersimpan saat halaman ujian memakainya. Sekolah harus menguji soal bergambar dan berkas media pada domain produksi yang sebenarnya.

Perangkat bersama wajib menggunakan tombol Logout setelah ujian. Menutup browser tanpa logout mempertahankan paket recovery sesuai tujuan fitur; orang yang memperoleh akses fisik ke profil browser yang sama juga dapat membuka shell lokal sampai deadline. Kebijakan perangkat dan pengawasan tetap diperlukan.

## Verifikasi

Enam tes `PWA-01` sampai `PWA-06` memeriksa fallback navigasi ujian, pengecualian API, penolakan redirect/login, pembatasan aset pada client ujian, pembersihan cache sepanjang lifecycle, registrasi produksi, manifest, dan header pembaruan worker.

Regresi lengkap setelah tahap ini menghasilkan 276 tes Node pada 41 berkas tanpa kegagalan. TypeScript frontend/backend, baseline lint, pemeriksaan diff, dan build produksi 92 halaman juga lulus.

## Berkas utama

- `apps/web/public/exam-sw.js`
- `apps/web/public/manifest.webmanifest`
- `apps/web/lib/exam-pwa.ts`
- `apps/web/app/components/ExamPwaRegistration.tsx`
- `apps/web/app/components/questions/ExamPage.tsx`
- `apps/web/app/components/Header.tsx`
- `apps/web/next.config.ts`
- `apps/api/test/pwa-exam-shell-stage42.test.cjs`
