# Konflik salinan pada pengumpulan satu tab

## Bug yang direproduksi

`ExamPage.restoreAssignment` mengisi `{ fileUrls: [], textSubmission: '' }` ketika memuat ujian biasa tanpa lampiran. Snapshot autosave ikut menyimpan nilai kosong ini. Pengumpulan ujian biasa hanya mengirim jawaban dan tidak membawa `assignmentData`. Pemeriksaan `canFreezeSnapshot` menganggap objek dua bidang tersebut sebagai data tugas yang tidak boleh dibuang dan menolak pengumpulan walaupun jawaban serta revisinya identik.

Bug ini tidak memerlukan dua tab. Dua pengujian regresi gagal dengan pesan “Salinan jawaban berbeda dari kiriman di tab lain” sebelum perbaikan: pengumpulan ujian biasa dengan lampiran kosong dan pengulangan kiriman yang sudah dikunci dengan bidang lampiran kosong.

## Perbaikan

- Perbandingan snapshot menganggap bidang lampiran yang kosong sebagai tidak ada lampiran. Teks, berkas, dan tautan yang benar-benar terisi tetap diperiksa.
- Pemulihan halaman tidak lagi membuat data tugas semu untuk ujian biasa.
- Kiriman yang sudah dikunci tetap dipakai persis seperti yang sebelumnya disimpan; perbaikan tidak menulis ulang payload lama atau mengganti jawaban dengan salinan lain.
- Konflik nyata tetap menghentikan pengiriman dan menyimpan cadangan terpisah.
- Pesan tidak lagi menyatakan konflik berasal dari tab lain. Judul untuk konflik ini menjadi “Pengumpulan Perlu Diperiksa”.

## Laporan saat waktu habis

Timer halaman memanggil `handleSubmitExam(undefined, { isAuto: true })`, yaitu handler pengumpulan yang sama dengan tombol selesai. Karena itu bug lampiran kosong juga dapat terjadi tepat saat waktu habis, tanpa siswa menekan tombol atau membuka tab lain. Penutupan waktu merupakan perilaku yang diharapkan; pesan konflik palsu merupakan bug pemeriksaan snapshot.

Pengujian tambahan menjalankan callback timer serta handler halaman asli bersama penyimpanan lokal: koneksi normal, offline lalu tersambung, dan respons pengumpulan hilang lalu dicoba ulang. Pada offline/kegagalan jaringan, salinan terkunci harus tetap ada hingga server mengonfirmasi; pengulangan mengirim jawaban yang sama.

Verifikasi: seluruh 67 pengujian penyimpanan lokal, pengumpulan terkunci, worker pengiriman, ketahanan jawaban, dan integritas jawaban lulus; pemeriksaan tipe frontend lulus.

## Kasus siswa yang dilaporkan

Audit baca saja menemukan jawaban dan nilai akhir sudah tersimpan. Sesi ditutup otomatis setelah waktu personal habis. Beberapa laporan browser menyebut server tidak terjangkau dan jawaban menunggu sinkronisasi. Laporan pending merupakan keadaan pada saat heartbeat, bukan bukti bahwa jawaban akhirnya hilang; server mencatat penyimpanan jawaban sesudah heartbeat terakhir.

Cadangan lokal siswa belum diperiksa langsung. Bug di atas cocok dengan alur ujian biasa yang dijalaninya, tetapi isi salinan yang menimbulkan konflik pada perangkatnya belum dapat dipastikan dari database saja.

Jika cadangan browser memuat jawaban terakhir yang belum sesuai server, gunakan tindakan proktor **PULIHKAN**, dengan alasan gangguan pengumpulan dan jendela waktu singkat. Siswa menggunakan perangkat/browser asal untuk mengirim jawaban tersimpan setelah aplikasi memakai perbaikan. Tindakan ini perlu pemeriksaan cadangan terlebih dahulu; tidak perlu membuka pengerjaan baru untuk mengatasi pesan palsu. Pilihan Susulan menghapus jawaban dan nilai lama, sehingga bukan tindakan pemulihan pengiriman.

Perbaikan tidak mengubah nilai atau status siswa secara otomatis, tidak menghapus cache siswa, dan tidak menjalankan deployment/restart layanan.
