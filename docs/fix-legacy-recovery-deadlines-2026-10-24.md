# Pemulihan salinan dari reset lama

## Masalah

Reset sebelum riwayat `superseded_deadlines` diperkenalkan mengganti batas waktu
tanpa menyimpan seluruh batas lama di metadata pengerjaan. Salinan jawaban yang
dikunci memakai batas lama kemudian ditolak sebagai "sesi yang sudah diganti",
meskipun pemulihan dibuka pada perangkat dan generasi pengerjaan yang sama.
Mengulang reset hanya menyimpan batas terbaru; riwayat yang sudah hilang tetap
tidak dikenali.

## Perubahan

Pemeriksaan pengumpulan dan konfirmasi jawaban tersimpan memakai pencocokan
batas waktu yang sama. Jika batas tidak ada di metadata, server memeriksa audit
`RESET_BY_PROCTOR` untuk pengerjaan tersebut. `previous_deadline` maupun
`recovery_until` dapat mengenali salinan lama.

Audit hanya berlaku jika waktu pencatatan dan waktu reset tidak mendahului
`started_at` generasi saat ini. Reset baru juga mencatat `attempt_started_at`;
jika tersedia, nilainya harus cocok. Audit ujian susulan dan event siswa tidak
digunakan untuk menerima batas lama. Dengan demikian, reset sebelum ujian
susulan tetap ditolak walaupun batas lamanya berada setelah waktu mulai susulan.

Pemeriksaan pengguna, perangkat, generasi, status, dan waktu pemulihan tetap
berlaku. Kegagalan membaca audit menghasilkan respons sementara (503), sehingga
klien dapat mencoba lagi. Riwayat dibaca tanpa migrasi atau perubahan massal
data siswa. Pengumpulan yang sudah selesai hanya dikonfirmasi jika isi salinan
cocok dengan jawaban yang tersimpan.

## Verifikasi

- Sebelum perubahan, tes reproduksi menolak salinan dengan batas lama yang sah.
- Setelah perubahan, 115 tes terkait pemulihan, pengumpulan, perpindahan
  perangkat, audit pengawasan, batas waktu, dan gangguan respons lulus.
- Pemeriksaan tipe backend dan pemeriksaan whitespace perubahan lulus.
- Pengujian memakai fixture terisolasi, bukan pengiriman dari browser siswa.

## Penggunaan

Setelah kode diterapkan ke server, proktor membuka pemulihan kirim saja ketika
siswa siap memakai perangkat/browser asal. Salinan asli dikirim ulang dalam
jendela tersebut. Jangan memakai ujian susulan untuk memulihkan salinan, karena
susulan memulai generasi baru. Perubahan ini tidak membuka pemulihan, mengubah
nilai, atau mengirim jawaban siswa secara otomatis.

## Konfirmasi terputus setelah jawaban tersimpan

Pengumpulan dapat sudah disimpan ketika responsnya hilang atau pemeriksaan
akhir sedang tidak tersedia. Klien kini mengulang satu kali menggunakan payload
terkunci yang persis sama, di dalam kunci pengiriman yang sama. Endpoint idempoten
membandingkan isi tersimpan; konfirmasi harus menyatakan `submissionVerified`
dan ID pengerjaan yang cocok. Status selesai atau jumlah jawaban saja tidak cukup.

Jika respons tetap tidak pasti, hasil diklasifikasikan sebagai konfirmasi
tertunda, dengan percobaan berkala yang sudah tersedia. Layar menyebut
"Pengumpulan belum dapat dikonfirmasi" dan menjelaskan bahwa jawaban mungkin
sudah tersimpan. Antrean latar belakang tidak mengeluarkan peringatan gagal untuk
respons sukses tanpa konfirmasi lengkap. Salinan lokal dipertahankan sampai
server mengonfirmasi. Perbedaan jawaban yang dinyatakan server serta penolakan
izin/sesi tetap memerlukan pemeriksaan, tanpa percobaan langsung berulang.

Tes menggunakan layanan backend asli dengan database fixture untuk kehilangan
respons setelah commit, timeout, respons 503, HTML, respons kosong, konfirmasi
tanpa identitas, dan identitas pengerjaan yang salah. Setelah koneksi pulih,
pengulangan mengonfirmasi jawaban yang sama tanpa menggandakan baris jawaban.
