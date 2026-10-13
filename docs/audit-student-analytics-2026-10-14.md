# Audit dashboard analitik siswa — 14 Oktober 2026

## Kesimpulan

Halaman sebelumnya belum sepenuhnya faktual. Ada perhitungan yang menganggap data belum tersedia sebagai nol, perbandingan peserta yang tidak setara, waktu pengiriman terlambat yang ikut dihitung, dan statistik soal yang bergantung pada baris jawaban serta versi bank soal saat ini. Bug tersebut diperbaiki pada kode workspace.

Audit database dijalankan dalam transaksi baca saja. Nilai siswa, metadata izin guru, dan status ujian tidak diubah.

## Temuan dan perbaikan

| Temuan | Dampak | Perbaikan |
| --- | --- | --- |
| `Number(total_score) || 0` | Nilai belum dihitung dianggap nol; nilai sementara ikut menjadi hasil final | Nilai null, tidak valid, manual tertunda, dan penskoran relatif tertunda dikeluarkan. Nilai nol yang sah tetap dihitung |
| Seluruh attempt selesai dihitung | Lebih dari satu pengerjaan pada ujian sama dapat memberi bobot berlebihan | Satu pengerjaan selesai terbaru per siswa per ujian; bila pengerjaan terbaru masih tertunda, hasil lama tidak dipakai menggantikannya |
| Peringkat atas seluruh pengguna | Ujian berbeda dan sekolah lain memengaruhi peringkat; agregat lintas sekolah terbaca | Hanya anggota aktif sekolah yang sama dan memiliki nilai final untuk kumpulan ujian yang persis sama |
| Rata-rata organisasi diberi label kelas | Angka tidak merepresentasikan kelas; peserta dengan banyak ujian memiliki bobot lebih besar | Label menjadi peserta ujian yang sama. Setiap peserta memiliki bobot sama dan siswa pemanggil tidak ikut dalam rata-rata pembanding |
| Seri peringkat mengikuti urutan baris | Nilai rata-rata sama mendapat peringkat berbeda | Peringkat kompetisi: 1 + jumlah peserta dengan rata-rata lebih tinggi. Toleransi numerik menghindari perbedaan semu akibat pecahan floating point |
| Persentil berbasis posisi peringkat | Nilai seri dan kelompok satu orang menghasilkan interpretasi keliru | Persentase peserta pembanding dengan rata-rata lebih rendah; bila tidak ada pembanding, tampil belum tersedia |
| Selisih diberi simbol persen | Selisih skor persentase dibaca sebagai perubahan relatif | Selisih ditampilkan dalam poin; perubahan relatif tidak dibagi ketika rata-rata pembanding nol |
| Waktu selesai dikurangi waktu mulai tanpa validasi | Pengiriman terlambat, data tanggal buruk, dan nilai negatif/Infinity memengaruhi waktu dan kecepatan | Waktu selesai dibatasi oleh pengumpulan dan batas sesi, termasuk sesi pemulihan proktor. Tanggal tidak valid ditandai belum tersedia |
| Hanya baris jawaban menjadi penyebut | Soal yang tidak dijawab tidak terhitung, sehingga akurasi terlalu tinggi | Statistik menggunakan seluruh soal pada snapshot ujian; soal objektif kosong dihitung tidak benar |
| Status benar null dianggap salah | Jawaban yang penilaiannya belum pasti memberi rekomendasi kelemahan palsu | Jawaban terisi dengan status penilaian tidak pasti dikeluarkan dan jumlahnya dijelaskan |
| Tipe kepribadian dihitung benar/salah | Penilaian kepribadian tercampur dengan kemampuan akademik | Tipe subjektif dipisahkan dari persentase benar/salah dan rekomendasi akademik |
| Kesulitan null dianggap sedang | Sistem menciptakan kategori kesulitan tanpa sumber | Soal hanya dikelompokkan ke kesulitan yang benar-benar tercatat |
| Menggunakan bank soal yang dapat diedit | Analisis lama dapat berubah setelah bank soal diedit | Memakai snapshot soal ujian. Analisis ujian legacy tanpa snapshot dinyatakan belum tersedia |
| Benar/salah terbaca ketika pembahasan tertutup | Agregat dapat membantu mengungkap jawaban sebelum pembahasan diizinkan | Analisis soal mengikuti izin kunci jawaban, akhir jadwal, dan sesi aktif; nilai keseluruhan tetap mengikuti izin nilai |
| Mata pelajaran hanya dari kolom ujian | Semua data yang diaudit masuk kategori Umum | Gunakan mata pelajaran bank soal jika kolom ujian belum terisi; data yang tetap tidak diketahui diberi label Belum ditentukan |
| Konsistensi mingguan dan waktu aktif berisi konstanta | Nilai nol dan Afternoon bukan hasil perhitungan | Bidang rekaan dihapus. Label waktu belajar diganti waktu pengerjaan ujian |
| Label huruf A–E memakai batas buatan | Dapat disangka predikat resmi sekolah | Predikat huruf dihapus; nilai aktual tetap ditampilkan |
| Kegagalan query berubah menjadi null/daftar kosong | Gangguan layanan disangka belum ada hasil | Backend mengembalikan kesalahan; frontend menampilkan alasan dan tombol coba lagi |
| Cache riwayat global tidak terikat pengguna | Potensi riwayat akun sebelumnya tampil saat sesi berubah | Halaman memakai state lokal, mengosongkan data saat memuat ulang, dan mengabaikan respons permintaan lama |
| Frontend memanggil tiga endpoint berulang | Data dapat berbeda waktu dan query yang sama diulang | Satu respons overview memuat analitik, riwayat, dan perbandingan untuk layar ini |

## Fakta database saat audit

- 634 pengerjaan selesai: 586 `submitted`, 48 `auto_submitted`.
- 567 pengerjaan diizinkan menampilkan nilai; 67 masih disembunyikan guru.
- Pada seluruh pengerjaan selesai, nilai tersedia dan berada pada rentang 0–100; tidak ada penilaian manual tertunda.
- 634 pengerjaan terkait ujian yang kolom mata pelajarannya belum terisi. Mata pelajaran dapat dibaca dari bank soal.
- 24 pengerjaan selesai lebih dari dua menit sesudah batas waktu personal. Selisih tersebut tidak seluruhnya merupakan waktu pengerjaan.
- 75 snapshot soal pada 5 ujian. Data legacy lainnya tidak memiliki sumber historis yang cukup untuk analisis soal yang pasti.
- Semua 12 ujian yang memiliki pengerjaan selesai belum mengaktifkan metadata izin pembahasan. Karena itu, analisis soal pada data saat audit dinyatakan belum tersedia, bukan diberikan persentase nol.
- Ratusan baris jawaban memiliki status benar null. Status ini tidak boleh dianggap salah secara otomatis jika jawaban sudah terisi.

## Definisi angka setelah perbaikan

- Rata-rata: rata-rata `total_score` final 0–100 yang izinnya sudah dibuka, satu pengerjaan selesai terbaru per ujian, dibulatkan dua desimal saat penyajian. Nilai nol yang sah tetap menjadi anggota rata-rata.
- Peringkat: peringkat kompetisi terhadap peserta aktif sekolah yang memiliki nilai final pada seluruh ujian dalam himpunan yang sama dengan siswa.
- Persentil: proporsi peserta pembanding dengan rata-rata lebih rendah; peserta seri tidak termasuk “lebih rendah”.
- Perbandingan: rata-rata per peserta pada himpunan ujian yang sama, kemudian rata-rata antarpeserta pembanding. Siswa pemanggil tidak termasuk pembanding.
- Akurasi soal: proporsi seluruh soal objektif snapshot yang benar; soal kosong ikut penyebut; penilaian belum pasti dan tipe subjektif tidak diperlakukan sebagai salah.
- Tren: perbandingan rata-rata paruh awal dan paruh akhir secara kronologis. Perubahan lebih dari +5 poin adalah naik, kurang dari −5 adalah turun, sisanya stabil. Ini indikator deskriptif, bukan uji signifikansi statistik.
- Kelebihan/area pengembangan: ringkasan tipe soal dengan sedikitnya 5 soal yang status penilaiannya pasti. Ambang deskriptif: setidaknya 70% untuk kelebihan, di bawah 60% untuk latihan tambahan.
- Kecepatan: jumlah soal yang memiliki jawaban per menit pengerjaan; hanya tersedia jika seluruh ujian memiliki data soal autentik, durasi valid, dan tidak ada penilaian akademik yang belum pasti.

## Keamanan

Identitas siswa tetap berasal dari token JWT. Endpoint tidak menerima identitas target dari browser. Pembacaan hasil sendiri dipersempit ke sekolah dengan keanggotaan aktif; perbandingan hanya memakai peserta aktif sekolah yang sama dan ID ujian yang telah diizinkan. Respons memuat angka agregat dan riwayat milik pemanggil; tidak memuat identitas pembanding, jawaban mentah, kunci, payload pengumpulan, maupun konfigurasi ujian.

Izin nilai dan pembahasan tidak diubah. Penolakan izin dan kegagalan database dibedakan; kegagalan pemeriksaan pembahasan tidak menjadi keputusan izin palsu. Batas riwayat dinormalisasi ke bilangan bulat maksimal 100 pada controller dan service.

## Verifikasi

- Pemeriksaan tipe frontend dan backend serta lint frontend lulus. Seluruh 78 pengujian terkait hasil, analitik, dan keamanan kunci/media lulus.
- Pengujian mencakup nilai nol/null/provisional, batas skor, duplikasi pengerjaan, pecahan skor, seri, pembanding parsial, peserta sekolah lain, keanggotaan tidak aktif, izin pembahasan, soal kosong, snapshot legacy, status penilaian tidak pasti, durasi pemulihan, tanggal invalid, pembagian nol, dan kegagalan database.
- `tools/audit-student-analytics.cjs` membandingkan service beserta adapter PostgreSQL terhadap SQL pembanding dalam transaksi `REPEATABLE READ READ ONLY`.
- Verifikasi database pertama: 140 siswa, 567 pengerjaan final yang diizinkan, 138 perbandingan, 206 kelompok mata pelajaran; nol selisih pada rata-rata, nilai tertinggi/terendah, durasi total, peringkat, persentil, rata-rata pembanding, dan jumlah riwayat.
- Laporan ini tidak menyatakan seluruh bank soal atau proses penskoran eksternal telah diaudit ulang. Lingkupnya adalah fakta dan perhitungan yang ditampilkan halaman analitik siswa.
- Perubahan ada pada workspace; tidak melakukan deployment, restart layanan, ataupun mengubah data ujian. Tampilan belum diverifikasi dalam sesi browser siswa.

## Berkas

- `apps/api/src/analytics/student-analytics.service.ts`
- `apps/api/src/analytics/student-analytics.controller.ts`
- `apps/web/app/dashboard/siswa/analytics/page.tsx`
- `apps/web/lib/api/student-analytics.ts`
- `apps/api/test/student-analytics-integrity.test.cjs`
- `tools/audit-student-analytics.cjs`
