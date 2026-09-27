# Tahap 39 — Jawaban lokal saat jaringan terputus

Diperbarui 28 September 2026. Tahap ini memastikan siswa tetap dapat menjawab ketika koneksi terputus setelah ujian berhasil dibuka.

## Temuan

IndexedDB dan sinkronisasi jawaban sebenarnya sudah tersedia, tetapi penulisan lokal dan request server berjalan berdekatan. Event jaringan pulih dapat membaca snapshot sebelum klik terakhir selesai ditulis. Ketika browser sudah menyatakan offline, autosave juga masih mencoba request HTTP dan baru masuk antrean setelah timeout.

Auto-submit yang menunggu koneksi belum membedakan sinkronisasi jawaban berhasil atau gagal. Pemulihan juga terlalu bergantung pada event `online`, padahal Wi-Fi dapat tetap dianggap tersambung ketika backend tidak dapat dijangkau.

## Perbaikan

Setiap perubahan jawaban dan tanda ragu sekarang menunggu penulisan snapshot lokal selesai sebelum mencoba server. Jika browser offline, tidak ada request HTTP yang sia-sia: soal langsung ditandai menunggu sinkronisasi dan siswa dapat lanjut ke soal lain.

Pembacaan snapshot menunggu seluruh antrean tulis attempt tersebut selesai. Saat koneksi pulih, seluruh snapshot dikirim massal. Auto-submit hanya dilanjutkan setelah server mengonfirmasi sinkronisasi jawaban. Selama submit masih menunggu, pemeriksaan diulang setiap 15 detik sehingga pemulihan tidak bergantung pada event browser saja.

Banner offline menampilkan jumlah jawaban yang sudah berada di perangkat. Snapshot baru dihapus setelah submit normal dikonfirmasi server. Jika waktu habis saat offline, layar menunggu koneksi dan mempertahankan snapshot untuk jalur pemulihan proktor.

## Kelanjutan pada Tahap 41

Tahap 41 menambahkan paket pemulihan IndexedDB untuk identitas, attempt, soal, deadline absolut, dan posisi terakhir. Reload atau browser yang tertutup kini dapat dipulihkan pada perangkat yang sama selama deadline belum lewat. Server tetap wajib memvalidasi ulang attempt yang sama sebelum jawaban atau submit dikirim.

## Verifikasi

Lima tes `OFFLINE-01` sampai `OFFLINE-05` memeriksa urutan lokal lebih dulu, jalur tanpa timeout HTTP, konsistensi antrean tulis, gerbang sinkronisasi sebelum submit, dan retry berkala.

Regresi lengkap menghasilkan 263 tes Node pada 39 berkas tanpa kegagalan. TypeScript API/frontend serta build produksi 92 halaman juga lulus.

## Berkas utama

- `apps/web/app/components/questions/ExamPage.tsx`
- `apps/web/lib/exam-durable-storage.ts`
- `apps/api/test/offline-local-first-stage39.test.cjs`
