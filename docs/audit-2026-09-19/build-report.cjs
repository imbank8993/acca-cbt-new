// Generates the audit documentation from explicitly reviewed findings.
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const root = path.resolve(dir, '../..');
const findings = [];
const api = 'apps/api/src/';
const web = 'apps/web/';
const attempt = api+'students/exam-attempts.service.ts';
const students = api+'students/students.service.ts';
const examPage = web+'app/components/questions/ExamPage.tsx';
const backup = api+'backup/backup.service.ts';
const proctoring = api+'proctoring/proctoring.service.ts';
const teachers = api+'teachers/teachers.service.ts';
const question = api+'questions/questions.service.ts';
const grading = api+'grading/grading.service.ts';
const pygrade = 'apps/scoring/app/services/grading.py';
const proktor = web+'app/dashboard/proktor/';
const siswa = web+'app/dashboard/siswa/';
function ref(file, needle) {
  const lines = fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/);
  const i=lines.findIndex(l=>l.includes(needle));
  if(i<0) throw new Error(`Missing source anchor: ${file} :: ${needle}`);
  return {file,line:i+1,needle};
}
function f(id,priority,title,evidence,refs,cause,scenario,impact,fix,accept) {
  findings.push({id,priority,title,evidence,refs,cause,scenario,impact,fix,accept});
}
f('SEC-01','P1','Akses langsung ujian melewati penugasan peserta','R',
  [ref(attempt,'async getQuestions'),ref(attempt,'async start'),ref(students,'async getExamForAttempt')],
  'Daftar ujian memfilter target/partisipan, tetapi getQuestions dan start tidak menerapkan pemeriksaan kelayakan peserta yang sama. getQuestions hanya mensyaratkan published; detail ujian juga tidak menegakkan kebijakan publikasi/target yang setara. Guard JWT membuktikan identitas, bukan hak mengikuti ujian tertentu.',
  'Gunakan akun siswa A dan ID ujian published yang hanya ditugaskan kepada kelas B. Panggil layanan detail/soal/start secara langsung, tanpa melalui daftar jadwal. Mock getQuestions membuktikan tidak ada query keanggotaan atau attempt.',
  'Siswa yang mengetahui ID ujian dapat melihat soal atau membuat pengerjaan di luar penugasannya. Jangkauan lintas organisasi bergantung data dan konfigurasi deployment; tidak diuji di produksi.',
  'Buat satu assertExamEligibility yang memeriksa organisasi aktif, target kelas/peserta, kebijakan public, status publikasi, dan waktu. Terapkan pada seluruh endpoint siswa termasuk detail, soal, dan start.',
  'Siswa di luar target mendapat 403 pada semua jalur; siswa yang sah tetap dapat mengerjakan. Public mengikuti kebijakan eksplisit, bukan menjadi bypass organisasi.');
f('SEC-02','P1','Metadata kunci jawaban ikut dikirim ke siswa','R',
  [ref(attempt,'async getQuestions'),ref(pygrade,'elif qtype == "mcq_complex"')],
  'Proyeksi soal mengirim metadata soal dan opsi, termasuk data yang dipakai mesin penilaian: jawaban/variasi isian, correct_order, pasangan matching, kategori benar, serta bobot. Menghilangkan is_correct saja tidak menyembunyikan seluruh kunci.',
  'Buat soal isian dengan metadata.blanks[].answer, lalu baca respons soal menggunakan akun siswa. Reproduksi sintetis menerima nilai answer secara utuh.',
  'Kunci dapat dibaca lewat respons jaringan sebelum menjawab. Terhubung dengan SEC-01, kebocoran tidak terbatas peserta yang seharusnya mengikuti ujian.',
  'Pisahkan DTO rendering siswa dari DTO penilaian. Gunakan allowlist per tipe soal, pisahkan label kandidat dari pemetaan jawaban benar, dan simpan bobot/kunci hanya pada server.',
  'Uji semua tipe soal: siswa mendapat seluruh data untuk merender, tanpa jawaban benar, pemetaan benar, atau bobot penilaian; tampilan soal tetap berfungsi.');
f('SEC-03','P1','Deadline dan pengikatan perangkat tidak ditegakkan saat menyimpan jawaban','R',
  [ref(attempt,'private async assertOwnedAndRunning'),ref(attempt,'async submit('),ref(attempt,'async start')],
  'assertOwnedAndRunning hanya memeriksa pemilik dan status in_progress. Save/submit tidak selalu memeriksa personal_end_time serta batas akhir ujian. Penutupan karena waktu bergantung jalur resume/monitoring. Device ID yang kosong dapat melewati perbandingan perangkat; save/submit tidak mengikat perangkat secara konsisten.',
  'Dengan attempt in_progress yang personal_end_time-nya sudah lewat, kirim save tanpa menjalankan resume atau monitoring. Layanan menerima penulisan dalam mock.',
  'Timer browser dapat dilewati dan jawaban diterima setelah waktu habis selama status belum diperbarui server. Perangkat berbeda juga tidak selalu terhalang.',
  'Tegakkan deadline efektif dan status secara atomik di server pada setiap mutasi. Bedakan grace period pemulihan yang sah dari jawaban baru. Gunakan token sesi pengerjaan yang diterbitkan server jika pengikatan perangkat diperlukan.',
  'Save dan submit setelah deadline mengikuti kebijakan yang sama tanpa bergantung browser/proktor. Uji kondisi tepat pada batas waktu dan balapan finalisasi.');
f('SEC-04','P1','ID pengerjaan tidak dicocokkan dengan ID ujian saat submit','R',
  [ref(attempt,'private async resolveAttemptForSubmit'),ref(attempt,'async submit(')],
  'Saat clientAttemptId tersedia, resolveAttemptForSubmit memeriksa pemilik tetapi tidak mencocokkan exam_id dengan examId pada rute. Penilaian menggunakan ujian dari rute sementara penyimpanan memakai ID pengerjaan yang diberikan.',
  'Siswa mempunyai attempt A untuk ujian A. Kirim submit ke ujian B dengan attempt A. Mock membuktikan resolver menerima pasangan yang berbeda.',
  'Hasil pengerjaan milik siswa sendiri dapat tercampur antarujian; nilai atau jawaban dapat dicatat ke attempt yang salah. Ini bukan bukti mengambil alih attempt siswa lain.',
  'Pilih attempt dengan id, user_id, dan exam_id sekaligus; ambil konteks penilaian dari attempt yang sudah tervalidasi. Periksa juga jalur alreadySubmitted.',
  'Pasangan ujian/attempt yang tidak cocok selalu ditolak sebelum penilaian atau penulisan.');
f('SEC-05','P2','Preferensi notifikasi dapat ditulis ke user_id pengguna lain','R',
  [ref(api+'notifications/notifications.service.ts','async updatePreferences')],
  'Objek upsert menyusun user_id dari identitas sebelum menyebarkan preferences. Body bertipe Record tidak memberi allowlist DTO yang mencegah user_id menimpa identitas.',
  'Kirim preferences sintetis berisi user_id korban. Mock menunjukkan baris upsert memakai ID korban.',
  'Pengguna login dapat mengubah preferensi notifikasi orang lain jika mengetahui ID-nya, termasuk mematikan pemberitahuan.',
  'Gunakan DTO field preferensi yang eksplisit, tolak field ekstra, dan tetapkan user_id server setelah pemetaan allowlist.',
  'Body berisi user_id/id/field asing ditolak atau diabaikan; target selalu pengguna terautentikasi.');
f('SEC-06','P1','Penghapusan berkas non-assignment tidak memeriksa pemilik','R',
  [ref(api+'storage/storage.controller.ts','async remove'),ref(api+'storage/storage.service.ts','objectKeyFromUrl')],
  'Pemeriksaan pemilik hanya diterapkan untuk prefix assignments/. Key di prefix lain diteruskan ke deleteObject bagi pengguna yang sudah login. Penerimaan host r2.dev juga perlu dibatasi pada host storage yang benar-benar dikonfigurasi.',
  'Gunakan siswa biasa dengan URL gambar questions milik pihak lain. Mock menunjukkan deleteObject dipanggil tanpa pemeriksaan bank/pemilik.',
  'Gambar soal atau aset lain yang URL-nya diketahui berpotensi dihapus. Bukti tidak melakukan penghapusan R2 sungguhan.',
  'Simpan hubungan objek dengan pemilik/organisasi/resource. Otorisasi penghapusan terhadap resource untuk seluruh prefix dan cocokkan origin storage secara tepat.',
  'Siswa tidak dapat menghapus gambar bank soal atau aset pengguna lain; pemilik/staf yang berhak tetap dapat menghapus aset yang diizinkan.');
f('SEC-07','P1','Upsert soal dan opsi menerima ID resource asing','R',
  [ref(question,'async save'),ref(question,'private async replaceOptions')],
  'save memeriksa akses bank tujuan dari DTO, kemudian upsert memakai dto.id tanpa memeriksa kepemilikan soal yang sudah ada. Pola serupa pada ID opsi perlu membatasi opsi ke soal induknya.',
  'Guru yang berhak pada bank A mengirim ID soal existing dari bank B dengan bankId A. Mock membuktikan upsert menerima ID asing setelah hanya bank tujuan diperiksa.',
  'Soal pihak lain dapat tertimpa atau dipindahkan; opsi dan nilai ujian yang bergantung pada soal ikut berisiko.',
  'Pisahkan create dan update. Untuk update, muat resource asal dan periksa izin pada asal serta tujuan; opsi existing harus milik questionId yang sama. Lakukan perubahan sebagai transaksi.',
  'ID soal/opsi lintas bank, pemilik, dan organisasi ditolak tanpa mengubah resource mana pun.');
f('SEC-08','P1','Penilaian esai dapat menargetkan answer ID dari pengerjaan lain','R',
  [ref(teachers,'async submitEssayGrades')],
  'Otorisasi dilakukan terhadap attempt yang dipilih, tetapi update setiap nilai hanya memakai id jawaban. Tidak ada pengikatan answer ke attempt tersebut dan ke tipe soal esai.',
  'Guru yang boleh menilai attempt A memasukkan ID jawaban milik attempt B ke map grades. Mock mencatat update ID asing.',
  'Guru dapat mengubah nilai jawaban di luar pengerjaan yang diizinkan. Ini terpisah dari validasi rentang nilai pada BUG-06.',
  'Ambil semua jawaban yang diminta dengan attempt_id dan tipe esai, verifikasi jumlah serta kepemilikannya, lalu update dengan kondisi id + attempt_id dalam transaksi.',
  'Answer ID asing/non-esai ditolak seluruhnya sebelum ada nilai berubah; nilai esai sah tetap tersimpan.');
f('SEC-09','P1','Siswa dapat memalsukan event reset proktor','R',
  [ref(api+'proctoring/proctoring.controller.ts','class LogViolationDto'),ref(proctoring,'async logViolation')],
  'eventType pada log pelanggaran hanya divalidasi sebagai string. Layanan menerima RESET_BY_PROCTOR dari pemilik attempt, padahal event tersebut dipakai sebagai batas waktu reset penghitungan pelanggaran.',
  'Kirim eventType RESET_BY_PROCTOR melalui jalur log siswa. Mock menunjukkan event disimpan dan dipakai sebagai batas hitungan.',
  'Integritas log pengawasan dan hitungan pelanggaran rusak; riwayat dapat tampak seolah proktor melakukan reset. Pengawasan browser tetap bukan jaminan anti-kecurangan mutlak.',
  'Pisahkan event server/proktor dari allowlist event siswa. Catat actor dan asal event di server serta tegakkan transisi/hitungan di server.',
  'Siswa tidak dapat menulis event administratif atau mereset hitungan; reset sah mencatat identitas proktor.');
f('SEC-10','P1','Terminasi ulang membuka kembali jendela susulan jawaban','S',
  [ref(proctoring,'async forceTerminate'),ref(attempt,'async syncLateAnswers')],
  'forceTerminate mengizinkan pemilik attempt dan menulis status auto_submitted serta finished_at baru tanpa kondisi status sebelumnya. syncLateAnswers memakai finished_at untuk batas enam jam, menerima jawaban kosong/lebih lengkap, dan hanya membandingkan perangkat jika kedua nilai tidak kosong.',
  'Pada staging, submit attempt, panggil forceTerminate milik sendiri, lalu susulkan jawaban baru pada bagian yang sebelumnya kosong. Ulangi terminasi setelah jendela susulan berlalu untuk menguji pembaruan batas waktunya.',
  'Jawaban dapat diubah setelah pengumpulan dengan menyamarkannya sebagai pemulihan offline. Tidak ada bukti server bahwa jawaban susulan memang dibuat sebelum deadline.',
  'Terapkan state machine dan compare-and-set; terminasi harus idempoten dan tidak mengubah finished_at yang sudah final. Batasi pemulihan dengan kebijakan/audit proktor atau bukti checkpoint server yang dapat diverifikasi.',
  'Attempt submitted tidak dapat diubah menjadi auto_submitted oleh siswa; terminasi ulang tidak memperpanjang jendela; susulan yang tidak sah ditolak.');
f('SEC-11','P2','Impor soal memakai izin lebih longgar daripada editor bank','S',
  [ref(api+'imports/imports.service.ts','async assertCanImport'),ref(question,'async save')],
  'assertCanImport memeriksa status staf pada organisasi resource dengan assertStaffByRecord, sedangkan editor bank memakai assertBankAccess. Guru dapat lolos impor pada bank guru lain dalam organisasi yang sama meskipun tidak berhak mengedit melalui jalur normal.',
  'Guru A mencoba bulk import ke bank milik guru B yang tidak dibagikan. Bandingkan izin endpoint import dengan endpoint save soal biasa.',
  'Kebijakan kepemilikan bank menjadi tidak konsisten dan konten bank pihak lain dapat ditambah melalui impor.',
  'Gunakan kebijakan assertBankAccess yang sama untuk preview/permission dan eksekusi impor; bila akses bersama memang diinginkan, nyatakan kebijakannya secara eksplisit.',
  'Semua jalur create/edit/import menghasilkan keputusan izin yang identik untuk bank yang sama.');
f('SEC-12','P1','Arsip backup diproses dan diunggah sebelum autentikasi/otorisasi final','S',
  [ref(web+'app/api/backup/import/route.ts','export async function POST'),ref(web+'app/api/backup/import/route.ts','async function readArchive')],
  'Rute memeriksa keberadaan token, kemudian membuka ZIP, mendekompresi dan mengunggah objek sebelum validasi signature serta panggilan Nest yang memeriksa izin. Tidak ada batas ukuran terkompresi/hasil dekompresi/jumlah entry dalam kode jalur ini.',
  'Di staging dengan storage terisolasi, gunakan siswa yang tidak berhak memulihkan backup dan ZIP kecil valid secara struktur tetapi signature salah; amati apakah storage sudah ditulis sebelum respons penolakan. Batas reverse proxy deployment belum diverifikasi.',
  'Pengguna tanpa hak restore dapat menghabiskan memori, waktu proses, dan kuota storage; hasil gagal dapat meninggalkan objek yatim.',
  'Validasi identitas dan izin organisasi sebelum membaca payload berat. Verifikasi manifest asli sebelum upload; batasi ukuran, rasio dekompresi, jumlah entry, ekstensi, serta lakukan rollback objek pada kegagalan.',
  'Pemanggil tanpa hak atau signature salah menghasilkan nol penulisan storage; arsip melewati limit ditolak dini tanpa konsumsi memori tidak terkendali.');
f('SEC-13','P1','Ekspor backup melakukan fetch URL gambar tanpa pembatasan tujuan','S',
  [ref(web+'app/api/backup/export/route.ts','await fetch(url)')],
  'URL gambar dari HTML tersimpan diambil oleh server menggunakan fetch. Tidak ada allowlist origin, validasi alamat privat/loopback, pemeriksaan redirect, batas byte, atau timeout khusus pada jalur ini.',
  'Pada lingkungan uji terisolasi, simpan HTML soal dengan src menuju server canary internal, lalu ekspor sebagai proktor. Pastikan tidak menguji alamat internal produksi.',
  'Potensi SSRF: request dari server dapat menjangkau layanan internal dan respons ikut dalam arsip. Eksploitabilitas bergantung siapa yang dapat menyimpan URL, egress jaringan, dan perilaku respons; belum diuji melalui jaringan.',
  'Batasi gambar pada storage yang dikelola aplikasi dan ambil objek berdasarkan key. Bila URL eksternal wajib, validasi DNS/IP dan setiap redirect, tolak jaringan privat, serta batasi waktu dan ukuran.',
  'Loopback, private IP, redirect ke internal, DNS rebinding, dan respons berlebih ditolak; gambar storage sah tetap ikut backup.');
f('SEC-14','P1','Kebijakan hasil ujian diterapkan tidak konsisten di API','S',
  [ref(students,'async listResults'),ref(students,'async getAttemptDetails'),ref(api+'analytics/exam-review.service.ts','if (!record.exams?.show_results)'),ref(api+'analytics/student-analytics.service.ts','const FINISHED_STATUSES')],
  'listResults/analitik siswa mengirim skor walau show_results false; penyembunyian di UI tidak melindungi respons API. Endpoint review/detail memeriksa pemilik dan show_results, tetapi tidak mensyaratkan status attempt selesai sebelum menyediakan jawaban/kunci.',
  'Uji siswa pemilik attempt dengan show_results false dan periksa respons skor. Lalu nyalakan show_results pada ujian yang masih in_progress dan panggil review/detail secara langsung.',
  'Nilai yang belum dirilis dapat terlihat. Dengan show_results aktif, siswa berpotensi membaca kunci saat masih mengerjakan; tingkat risiko tertinggi berasal dari cabang kedua.',
  'Terapkan kebijakan release hasil server-side yang mencakup status attempt, waktu rilis ujian, dan show_results, pada daftar, detail, review, analitik, serta ekspor siswa.',
  'Tidak ada skor/kunci pada respons sebelum kebijakan rilis terpenuhi; role staf tetap mengikuti otorisasi yang sesuai.');

f('BUG-01','P1','Unggah berhasil di server tetapi dianggap gagal oleh UI','R',
  [ref(api+'storage/storage.controller.ts','async upload'),ref(web+'lib/uploader.ts','!result?.success'),ref(web+'app/api/storage/upload/route.ts','export async function POST')],
  'Nest mengembalikan url/key/provider tanpa success, proxy storage meneruskannya, sementara uploader mengharuskan result.success. Jalur delete memakai kontrak serupa.',
  'Berikan respons HTTP 200 berbentuk respons controller kepada uploadToHosting. Reproduksi menghasilkan pesan Gagal mengunggah (HTTP 200).',
  'Gambar/lampiran sudah berada di storage tetapi pengguna melihat kegagalan; percobaan ulang membuat objek yatim dan menghambat penyuntingan soal/tugas.',
  'Standarkan DTO respons upload/delete dan proxy; gunakan status HTTP serta bentuk payload yang konsisten.',
  'Tes kontrak controller → proxy → uploader pada sukses dan gagal. Sukses menampilkan URL, gagal hanya untuk kegagalan nyata.');
f('BUG-02','P1','Restore ZIP bergambar merusak signature sebelum diverifikasi','R',
  [ref(web+'app/api/backup/import/route.ts','async function readArchive'),ref(web+'app/api/backup/import/route.ts',".update(JSON.stringify(payload))")],
  'readArchive mengganti URL gambar dalam manifest dengan URL upload baru sebelum POST menghitung HMAC. Ekspor menandatangani payload dengan path arsip, sehingga payload setelah penggantian berbeda.',
  'Gunakan manifest bertanda tangan yang memuat src gambar arsip. Ganti URL seperti readArchive lalu hitung HMAC; verifikasi gagal. Ini reproduksi algoritma, bukan round-trip storage.',
  'Backup ZIP dengan gambar yang berhasil dipulihkan ditolak sebagai rusak dan berkas upload tertinggal. Backup tanpa penggantian URL dapat lolos.',
  'Verifikasi signature atas manifest asli dahulu, baru buat salinan payload untuk pemetaan URL. Pisahkan integritas arsip dari transformasi restore.',
  'Round-trip backup dengan gambar mempertahankan isi/relasi dan lolos integritas; perubahan satu byte pada manifest tetap ditolak sebelum upload.');
f('BUG-03','P1','Submit dapat berhasil meski penyimpanan jawaban gagal','R',
  [ref(attempt,'async submit('),ref(attempt,'private async persistAnswers')],
  'Status/nilai attempt diperbarui sebelum seluruh jawaban selesai dipersist. persistAnswers hanya mencatat error database dan tidak melempar kegagalan. Retry dapat masuk alreadySubmitted; UI membersihkan salinan lokal setelah sukses.',
  'Mock database mengembalikan error penulisan jawaban. persistAnswers tetap resolve. Pada staging lanjutkan dengan fault injection saat submit dan periksa status, respons, jawaban, serta cache lokal.',
  'Pengumpulan tampak selesai tetapi bukti jawaban hilang atau tidak cocok dengan nilai; salinan lokal yang masih berguna dapat terhapus.',
  'Gunakan transaksi jawaban/status/nilai atau tahap finalisasi yang dapat diulang dengan aman. Propagasikan kegagalan dan bersihkan cache hanya setelah server mengonfirmasi persist lengkap.',
  'Setiap error penulisan menghasilkan retry yang aman tanpa status final palsu; submit identik tetap idempoten.');
f('BUG-04','P1','Restore menghapus data sebelum validasi lengkap dan tanpa transaksi','S',
  [ref(backup,'async import'),ref(backup,'private async wipe'),ref(backup,'private async insert')],
  'Import hanya memeriksa keberadaan payload.data sebelum wipe. Penghapusan dan banyak insert dilakukan bertahap tanpa transaksi keseluruhan; beberapa hasil delete tidak diperiksa.',
  'Pada database sekali pakai, gunakan backup bertanda tangan dengan relasi invalid atau paksa insert gagal setelah wipe. Bandingkan seluruh data sebelum dan setelah kegagalan.',
  'Restore gagal dapat meninggalkan organisasi kosong atau sebagian terpulihkan. Efek FK/cascade sebenarnya harus diuji pada schema deployment, bukan ditebak dari schema.prisma.',
  'Validasi schema/version dan referential integrity sebelum mutasi; gunakan staging tables/transaksi yang sesuai serta backup pra-restore dan pemeriksaan setiap error.',
  'Kegagalan di tahap mana pun mempertahankan data awal atau rollback lengkap; tidak ada respons sukses untuk restore parsial.');
f('BUG-05','P1','Cakupan backup tidak lengkap untuk fitur aplikasi sekarang','S',
  [ref(backup,'async export'),ref(backup,'async import'),ref(backup,'private async byOrganization')],
  'Daftar ekspor/impor tidak mencakup target/peserta ujian yang digunakan jalur siswa, konfigurasi/jadwal PAS, dan sejumlah relasi/metadata terpisah seperti dimensi serta log keamanan. Error baca dapat diubah menjadi array kosong. Remapping identitas hanya berfokus user_id, tidak seluruh foreign key pembuat seperti created_by.',
  'Buat fixture dengan target kelas, peserta individual, jadwal PAS, dimensi, dan pembuat yang UUID-nya berbeda di tujuan; export–restore lalu bandingkan entitas dan alur aksesnya.',
  'Berkas yang terlihat sebagai backup lengkap dapat kehilangan kemampuan menampilkan ujian, konfigurasi, atau atribusi pembuat. Data yang tidak dicakup dapat terhapus oleh cascade atau menjadi stale; efek tepatnya bergantung schema nyata.',
  'Tetapkan manifest cakupan/version eksplisit dan daftar seluruh relasi; gagalkan ekspor pada error baca. Petakan semua referensi pengguna dan uji round-trip dengan checksum/count per entitas.',
  'Seluruh fitur yang dijanjikan UI pulih dengan relasi valid. Data yang sengaja tidak dicadangkan dinyatakan jelas dan tidak diklaim sebagai backup lengkap.');
f('BUG-06','P1','Nilai esai tidak dibatasi dan status penilaian selesai terlalu dini','R',
  [ref(teachers,'async submitEssayGrades'),ref(api+'teachers/dto/teachers.dto.ts','class SubmitGradesDto')],
  'Map grades tidak memvalidasi angka finite/rentang terhadap skor maksimum per soal. Layanan menyetel needs_manual_grading false setelah permintaan, termasuk penilaian parsial. Rumus maksimum juga perlu disamakan dengan penilaian akademik yang mengecualikan tipe psikometri.',
  'Kirim nilai 999 pada esai berskor maksimum kecil; mock menerimanya. Uji terpisah map kosong atau hanya satu dari beberapa esai.',
  'Nilai dapat melebihi batas dan pekerjaan yang belum dinilai terlihat tuntas. Ini berbeda dari IDOR pada SEC-08.',
  'Validasi tipe/rentang setiap skor, tentukan kelengkapan dari seluruh esai di database, dan gunakan aturan agregasi yang sama untuk submit, manual grading, serta regrade.',
  'NaN/negatif/di atas maksimum ditolak; penilaian parsial tetap pending; ujian campuran menghasilkan skor akademik konsisten.');
f('BUG-07','P2','Bobot opsi nol berubah menjadi satu','R',
  [ref(question,'option.weight || 1')],
  'replaceOptions memakai operator || untuk default bobot. Angka nol yang sah dianggap kosong, berbeda dari jalur impor yang memakai pemeriksaan nullish.',
  'Simpan opsi berbobot 0 melalui editor. Mock menangkap weight 1 dalam data upsert.',
  'Skor psikometri atau soal berbobot berubah tanpa persetujuan pembuat; hasil editor dan impor tidak konsisten.',
  'Gunakan ?? setelah validasi angka serta tetapkan apakah bobot negatif memang diperbolehkan oleh desain.',
  'Bobot 0, 1, dan bobot lain dipertahankan identik melalui create/edit/import/reload.');
f('BUG-08','P1','Autosave jawaban rentan tertimpa request lama','S',
  [ref(examPage,'const handleAnswerSelect'),ref(examPage,'inFlight')],
  'Perubahan jawaban mengirim request yang dapat berjalan bersamaan tanpa revision per soal. Pelacakan in-flight memakai Set ID soal sehingga penyelesaian request pertama dapat menghapus tanda ketika request kedua masih berjalan. Tidak ada jaminan server menerapkan jawaban terbaru.',
  'Di staging beri delay pada simpan A, ubah cepat menjadi B, biarkan B selesai dahulu lalu A. Periksa database dan status simpan sebelum terminasi otomatis.',
  'UI dapat menunjukkan B tersimpan tetapi server memegang A. Jalur penutupan yang menilai jawaban server dapat menghasilkan nilai salah.',
  'Gunakan antrean per soal atau revision monoton yang ditegakkan server; status simpan harus terkait revision terbaru dan jumlah request sebenarnya.',
  'Pada urutan respons terbalik, reload/terminasi selalu memakai jawaban terakhir yang diakui server; indikator pending tidak hilang terlalu cepat.');
f('BUG-09','P1','Kegagalan localStorage menghentikan autosave ke server','S',
  [ref(examPage,'const handleAnswerSelect'),ref(examPage,'localStorage.setItem')],
  'Penulisan localStorage dalam handler jawaban dilakukan sebelum jalur simpan server tanpa perlindungan error yang memadai. QuotaExceededError atau storage yang dinonaktifkan dapat memutus handler setelah state UI berubah.',
  'Mock localStorage.setItem agar melempar, lalu pilih jawaban. Periksa apakah save server tetap dikirim dan pengguna mendapat peringatan.',
  'Jawaban tampak dipilih tetapi tidak tersimpan ke server, dan mekanisme retry dapat tidak mencatat kegagalan itu.',
  'Pisahkan kegagalan cache lokal dari autosave jaringan; tangkap error storage dan tampilkan status kemampuan pemulihan offline.',
  'Storage penuh/dinonaktifkan tidak menghalangi penyimpanan server dan tidak menghasilkan indikator tersimpan palsu.');
f('BUG-10','P2','Resume sesudah akhir global dapat menutup jalan pemulihan offline','S',
  [ref(attempt,'async start'),ref(attempt,'async syncLateAnswers')],
  'Cabang start saat end_time global sudah lewat dapat mengembalikan expiredAttemptId tanpa memfinalisasi attempt in_progress. syncLateAnswers hanya menerima status auto_submitted. Finalisasi dari pembacaan monitoring belum tentu pernah terjadi.',
  'Siswa offline sampai melewati end_time, tab ditutup, lalu dibuka kembali tanpa proktor membuka monitoring. Attempt masih in_progress dan salinan lokal belum tersinkron.',
  'Jawaban offline yang seharusnya dapat dipulihkan tertolak karena state server tidak memenuhi prasyarat jalur recovery.',
  'Satukan finalisasi deadline pada layanan yang idempoten sebelum mengembalikan informasi expired; selaraskan recovery dengan kebijakan keamanan SEC-10.',
  'Reload setelah deadline memiliki hasil sama dengan/ tanpa monitoring aktif dan tidak kehilangan jawaban sah yang diizinkan kebijakan recovery.');
f('BUG-11','P1','Pemeriksaan soal yang sudah dipakai tidak mengikuti relasi jawaban aktual','S',
  [ref(question,'cbt_exam_attempt_questions'),ref(api+'analytics/exam-review.service.ts','cbt_exam_attempt_questions')],
  'Jalur hapus memeriksa tabel snapshot cbt_exam_attempt_questions, sementara alur saat ini memakai bank soal dan cbt_answers; tidak ditemukan penulisan snapshot pada source yang diaudit. Soal yang sudah dijawab dapat dianggap belum dipakai lalu dihapus secara fisik.',
  'Pada staging dengan schema nyata, jawab sebuah soal lalu hapus dari bank. Periksa query snapshot, cbt_answers, opsi, dan review historis.',
  'Bergantung FK, penghapusan bisa gagal atau menghapus/memutus bukti jawaban dan review historis. Jangan mengasumsikan cascade tertentu tanpa memeriksa database.',
  'Lindungi soal berdasarkan referensi aktual dan gunakan versioned snapshot/soft deletion yang konsisten dengan semua query render dan grading.',
  'Mengubah/menghapus bank tidak menghilangkan bukti soal dan jawaban ujian yang telah berlangsung.');
f('BUG-12','P2','Dukungan bank soal legacy tidak konsisten antarjalur','S',
  [ref(grading,".from('cbt_exam_question_sources')"),ref(attempt,'async getQuestions'),ref(examPage,'question_bank_id')],
  'Grading memiliki fallback cbt_exam_question_sources dengan limit satu, sedangkan pengambilan soal dan halaman siswa bergantung question_bank_id langsung. Data legacy/multi-source tidak diperlakukan seragam.',
  'Gunakan fixture ujian tanpa question_bank_id tetapi dengan question_sources yang valid. Bandingkan tampilan siswa dengan penilaian backend.',
  'Ujian legacy dapat dinilai tetapi tidak dapat dibuka atau hanya memakai bank pertama. Relevansi operasional bergantung keberadaan data legacy; belum diverifikasi terhadap database.',
  'Putuskan dukungan multi-bank/legacy secara eksplisit: migrasikan dan tolak state lama, atau gunakan satu resolver sumber yang konsisten di seluruh jalur.',
  'Semua ujian yang dianggap valid oleh backend dapat dirender dan dinilai dengan himpunan soal yang identik.');
f('BUG-13','P2','Ujian public dapat diterbitkan tetapi tidak muncul di daftar siswa','S',
  [ref(proktor+'exams/page.tsx','const canPublish = isAssigned || isPublic'),ref(students,'async listExams')],
  'UI mengizinkan publish ketika metadata.is_public aktif meski tanpa target, tetapi listExams membentuk daftar dari target kelas dan peserta individual tanpa memasukkan kebijakan public.',
  'Terbitkan ujian public tanpa target kelas/peserta, lalu buka jadwal siswa di organisasi yang sama.',
  'Pembuat mengira ujian tersedia umum tetapi siswa tidak dapat menemukannya. Perbaikannya harus diselaraskan dengan pembatasan akses langsung SEC-01.',
  'Definisikan public untuk organisasi atau publik internet, lalu terapkan aturan yang sama pada daftar, detail, start, dan UI penerbitan.',
  'Ujian public tampil hanya untuk audiens yang dimaksud; ujian private tetap mengikuti penugasan.');
f('BUG-14','P2','Hook React diletakkan setelah conditional return','S',
  [ref(web+'app/components/questions/ExamViewer.tsx','const [studentDocUrl'),ref(web+'app/components/questions/forms/QuestionForms.tsx','if (!info) return null;')],
  'ExamViewer mengembalikan tampilan kosong sebelum hook state dokumen/video, dan QuestionForms berhenti ketika tipe tidak dikenali sebelum rangkaian useCallback. ESLint melaporkan total 24 pelanggaran rules-of-hooks pada pola ini.',
  'Render komponen lalu transisikan questions dari kosong ke berisi tanpa remount; pada form transisikan tipe tidak dikenali menjadi valid. Verifikasi di browser/test komponen.',
  'Jika transisi tersebut terjadi pada instance yang sama, React dapat gagal karena jumlah/urutan hook berubah. Belum dibuktikan lewat browser untuk setiap pemanggil.',
  'Pindahkan seluruh hook sebelum conditional return atau pisahkan komponen untuk state kosong dan state valid.',
  'Transisi kosong/berisi/tipe invalid tidak menimbulkan error hook; lint rules-of-hooks bersih.');
f('BUG-15','P1','Regrade dapat menimpa nilai esai yang sudah dinilai manual','S',
  [ref(grading,'async regradeAttempt'),ref(pygrade,'if qtype in ESSAY_TYPES:')],
  'regradeAttempt mengirim esai ke scoring yang mengembalikan score 0 dan is_correct null, lalu menulis kembali setiap item ke cbt_answers dan total scaled_score. Nilai manual sebelumnya tidak ikut dimuat/dipertahankan dan status manual tidak diperbarui selaras.',
  'Nilai esai secara manual, lalu ubah kunci salah satu soal yang memicu regrade ujian tersebut. Bandingkan skor esai, total, dan needs_manual_grading sebelum/sesudah.',
  'Nilai manual dapat terhapus menjadi nol, sementara pengerjaan masih tampak sudah selesai dinilai.',
  'Pisahkan komponen skor otomatis dan manual; regrade otomatis tidak boleh menimpa nilai manual. Agregasikan ulang keduanya menggunakan denominator akademik yang sama.',
  'Edit kunci soal objektif mengubah hanya skor yang terkait dan menjaga nilai/feedback esai serta status grading yang benar.');
f('BUG-16','P1','Pilihan duplikat dapat memanipulasi skor','R',
  [ref(pygrade,'elif qtype == "mcq_complex"'),ref(pygrade,'elif qtype == "checklist"')],
  'MCQ kompleks membandingkan panjang array dan membership tanpa keunikan; checklist menjumlahkan bobot setiap kemunculan ID. Parser tidak menghapus duplikat. Pola membership serupa pada matching/kategorisasi juga perlu diuji.',
  'Reproduksi mesin penilaian asli: kunci [a,b] dengan jawaban [a,a] mendapat 10/10; checklist satu opsi bobot 2 dikirim tiga kali menghasilkan dimensi 6.',
  'Siswa yang memodifikasi payload dapat memperoleh skor tidak sesuai jawaban atau menaikkan hasil psikometri. UI pilihan biasa bukan pembatas keamanan.',
  'Validasi jawaban per tipe: ID harus unik, berasal dari soal, jumlah/ranking valid. Untuk himpunan jawaban gunakan kesetaraan set setelah validasi, bukan panjang+membership saja.',
  'Duplikat/ID asing ditolak atau dinormalisasi secara konsisten; a,a tidak pernah menggantikan a,b dan checklist tidak menggandakan bobot.');

f('UX-01','P2','Dashboard pengawas menampilkan statistik dan kejadian contoh sebagai data aktif','S',
  [ref(web+'app/dashboard/pengawas/page.tsx',"value: '42'"),ref(web+'app/dashboard/pengawas/monitoring/page.tsx','export default')],
  'Angka siswa aktif, kesehatan sistem, dan aktivitas Budi/Siti ditulis statis. Halaman monitoring pengawas masih berupa placeholder, sementara tampilan dashboard memberi kesan data operasional.',
  'Masuk sebagai pengawas pada dua kondisi database berbeda; kode tetap menghasilkan angka dan kejadian yang sama.',
  'Petugas dapat menyimpulkan keadaan ujian dari data contoh dan melewatkan kejadian nyata.',
  'Hubungkan ke API dengan izin pengawas yang sesuai, atau beri label demonstrasi/belum tersedia yang jelas dan hilangkan indikator live palsu.',
  'Tidak ada angka/nama kejadian contoh pada layar produksi; data memiliki waktu pembaruan serta status gagal/kosong.');
f('UX-02','P2','Kegagalan API disamarkan menjadi daftar kosong','S',
  [ref(web+'lib/api/students.ts','getStudentResultsAction'),ref(siswa+'results/page.tsx','export default')],
  'Sejumlah helper daftar mengembalikan [] saat request gagal. Halaman tidak dapat membedakan belum ada ujian/hasil dari gangguan API atau sesi.',
  'Paksa respons 500 atau putuskan jaringan saat memuat jadwal/hasil/kelas, lalu lihat empty state.',
  'Siswa mengira ujian/hasil hilang dan tidak mendapat tindakan retry atau login yang tepat.',
  'Gunakan hasil bertipe data/error dan state loading/error/empty yang berbeda; pertahankan data terakhir dengan penanda stale bila sesuai.',
  '401, 403, offline, 500, dan data kosong memberikan pesan serta tindakan yang berbeda dan dapat diakses.');
f('UX-03','P2','Fallback autentikasi dapat tetap menampilkan loading tanpa jalan keluar','S',
  [ref(web+'app/dashboard/layout.tsx','const safetyTimer'),ref(web+'app/dashboard/layout.tsx','activeRoleCtx')],
  'Safety timer dapat menyetel authChecked saat pemuatan sesi belum menghasilkan konteks role; rendering tetap bergantung activeRoleCtx. Cabang catch juga dapat menyisakan state ini.',
  'Buat getSessionUser menggantung atau gagal sebelum role tersedia, tunggu melewati timer keselamatan.',
  'Pengguna terjebak pada layar memuat, tanpa retry atau penjelasan kegagalan.',
  'Gunakan state autentikasi eksplisit (loading/authenticated/unauthenticated/error), timeout request yang nyata, dan aksi retry/login.',
  'Setiap kegagalan atau timeout berakhir pada tampilan yang dapat ditindaklanjuti; tidak ada spinner tanpa batas.');
f('UX-04','P2','Daftar hasil menyebut pengerjaan aktif sebagai selesai','S',
  [ref(students,'async listResults'),ref(siswa+'results/page.tsx','SELESAI')],
  'listResults tidak membatasi status selesai, sedangkan UI memakai label SELESAI dan jumlah hasil sebagai total ujian selesai.',
  'Mulai ujian tanpa submit lalu buka halaman hasil dari sesi lain atau setelah keluar dari pengerjaan.',
  'Status dan ringkasan progres menyesatkan; agregasi yang memakai data ini dapat memasukkan pengerjaan belum selesai.',
  'Filter status final di backend untuk hasil atau tampilkan status aktual serta pisahkan pengerjaan berjalan.',
  'Attempt in_progress tidak pernah diberi label selesai; hitungan dan rerata mengikuti definisi yang sama.');
f('UX-05','P2','Hitungan jawaban salah dapat negatif setelah penilaian esai','S',
  [ref(proktor+'monitoring/[attemptId]/page.tsx','const wrong = total - correct')],
  'Statistik memakai total - correct - jumlah_esai. Esai berskor positif dapat ditandai is_correct true sehingga terhitung dalam correct sekaligus dikurangi sebagai esai.',
  'Gunakan pengerjaan berisi satu esai yang sudah mendapat skor positif: total 1, correct 1, essays 1 menghasilkan wrong -1.',
  'Ringkasan monitoring admin/proktor/guru membingungkan dan tidak sesuai distribusi jawaban.',
  'Hitung benar/salah hanya pada tipe objektif dan pisahkan kategori esai dinilai/belum dinilai; jangan hanya clamp angka negatif.',
  'Kategori statistik saling lepas dan jumlahnya sesuai total untuk ujian objektif, esai, serta campuran.');
f('UX-06','P2','Waktu hasil dan jadwal menggunakan zona waktu berbeda','S',
  [ref(siswa+'results/page.tsx','getUTCHours'),ref(siswa+'schedule/page.tsx','WIB')],
  'Halaman hasil memakai UTC sedangkan jadwal menggunakan konvensi WIB. Konteks proyek menyebut sekolah di Gowa, sehingga zona yang dimaksud perlu diputuskan secara eksplisit; lokasi saja tidak membuktikan pilihan WIB salah.',
  'Bandingkan timestamp yang sama pada jadwal, hasil, detail, dan penilaian serta perangkat dengan zona berbeda.',
  'Jam tampil bergeser antarhalaman dan dapat membingungkan batas pengerjaan atau waktu pengumpulan.',
  'Gunakan formatter bersama dengan zona waktu sekolah yang dikonfigurasi, tampilkan label zona, dan simpan waktu server sebagai instant UTC.',
  'Instant sama tampil konsisten pada semua halaman dan zona browser; tanggal dekat tengah malam juga benar.');
f('UX-07','P2','Navigasi kartu dan kontrol toggle tidak sepenuhnya dapat diakses dengan keyboard','S',
  [ref(siswa+'results/page.tsx','onClick='),ref(web+'app/dashboard/notifications/settings/page.tsx','onClick=')],
  'Kartu hasil interaktif menggunakan div/motion.div tanpa semantik link/button atau keyboard setara. Toggle notifikasi perlu nama aksesibel, state aria-checked, dan semantik switch; tampilan visual saja tidak menyampaikan status kepada pembaca layar.',
  'Navigasikan hasil hanya dengan Tab/Enter/Space dan baca label toggle dengan pembaca layar. Inventaris menandai kandidat clickable div untuk pemeriksaan lanjutan, bukan semuanya otomatis dianggap cacat.',
  'Pengguna keyboard atau pembaca layar dapat gagal membuka hasil atau mengetahui status pengaturan.',
  'Gunakan link/button native, label programatis, fokus terlihat, serta role/state switch yang sesuai. Audit modal bersama untuk fokus, Escape, dan pengembalian fokus.',
  'Seluruh aksi utama dapat dijalankan tanpa mouse dan status toggle diumumkan dengan benar; modal diuji manual di staging.');
f('UX-08','P2','Respons monitoring lama dapat menimpa ujian yang baru dipilih','S',
  [ref(proktor+'monitoring/page.tsx','const loadExamData'),ref(proktor+'monitoring/page.tsx','setAttempts(attData)')],
  'loadExamData menulis state ketika respons selesai tanpa memastikan examId masih aktif. Beralih cepat A ke B memungkinkan respons A terlambat menimpa data B. Jalur liveAlerts memiliki penanganan tersendiri dan bukan dasar temuan ini.',
  'Perlambat request ujian A, pilih B, lalu biarkan A selesai terakhir.',
  'Nama ujian terpilih dapat tidak cocok dengan peserta/statistik yang ditampilkan; petugas berisiko bertindak atas baris yang tidak dimaksud.',
  'Gunakan abort/request generation atau cache keyed by examId; validasi konteks lagi sebelum aksi reset/terminate.',
  'Respons stale diabaikan dan semua baris/aksi selalu terikat ujian yang terlihat.');
f('UX-09','P2','Detail jadwal PAS tidak menjelaskan hasil pembuatan parsial','S',
  [ref(proktor+'exams/pas/[id]/page.tsx','result.created'),ref(api+'pas/pas-schedules.service.ts','return { created, skipped }')],
  'API mengembalikan created dan skipped, tetapi halaman detail PAS admin/proktor hanya memberitakan created. Halaman daftar ujian sudah menampilkan skipped; masalah dibatasi pada detail PAS.',
  'Pilih beberapa jadwal dengan salah satunya invalid/terlewati, jalankan generate di detail PAS.',
  'Operator tidak mengetahui jadwal mana yang gagal atau alasan kegagalan dan sulit melanjutkan pekerjaan yang tersisa.',
  'Tampilkan ringkasan sukses/terlewati/gagal per jadwal, simpan item yang belum selesai, dan sediakan retry yang aman.',
  'Jumlah dan identitas seluruh hasil cocok dengan pilihan awal; tidak ada kegagalan parsial yang tersembunyi.');
f('UX-10','P2','Notifikasi lama tidak memiliki jalur pagination yang jelas','S',
  [ref(api+'notifications/notifications.service.ts','query.limit(limit)'),ref(web+'app/dashboard/notifications/page.tsx','getUserNotifications')],
  'Halaman meminta batch 50 notifikasi terbaru dan filter UI berjalan atas data yang dimuat, sedangkan unreadCount/markAllRead menjangkau seluruh data pengguna. Tidak tersedia pemuatan halaman lama pada layar ini.',
  'Buat lebih dari 50 notifikasi dengan notifikasi lama belum dibaca; bandingkan badge, filter unread, dan aksi tandai semua.',
  'Badge dapat menyatakan ada notifikasi yang tidak dapat dijangkau melalui daftar; tandai semua dapat mengubah item yang belum pernah terlihat.',
  'Tambahkan pagination/cursor dan filter server-side; jelaskan scope tandai semua atau sediakan opsi untuk yang terlihat saja.',
  'Seluruh notifikasi dapat diakses, hitungan sesuai filter/scope, dan aksi massal mempunyai cakupan yang dipahami pengguna.');
f('UX-11','P2','Ekspor jawaban analitik kehilangan isi tipe soal kompleks','S',
  [ref(web+'app/dashboard/guru/analytics/exam/[id]/page.tsx','ans.selected_option_id')],
  'Ekspor memperlakukan esai sebagai teks dan tipe lainnya melalui selected_option_id tunggal. Jawaban kompleks yang tersimpan di essay_answer sebagai JSON tidak diterjemahkan ke keluaran yang tepat.',
  'Ekspor hasil yang berisi MCQ kompleks, matching, ranking, atau checklist dengan jawaban valid.',
  'Kolom laporan dapat berisi tanda kosong walau siswa sudah menjawab, sehingga audit nilai lewat spreadsheet menyesatkan.',
  'Gunakan serializer jawaban per tipe yang sama dengan review, dengan label terbaca dan representasi mentah opsional untuk audit.',
  'Jawaban semua tipe soal dapat ditelusuri dari ekspor ke jawaban tersimpan tanpa kehilangan informasi.');
f('UX-12','P2','Indikator tren dapat menyatakan naik saat nilai menurun','S',
  [ref(api+'analytics/student-analytics.service.ts','function calculateTrend')],
  'Untuk dua atau tiga skor, slice(0,-3) kosong sehingga olderAvg menjadi nol. recentAvg positif dibanding nol menghasilkan up meskipun skor terakhir turun.',
  'Dengan riwayat kronologis [90,60], perhitungan menghasilkan recentAvg 75 dan olderAvg 0, lalu up.',
  'Analitik memberikan umpan balik belajar yang berlawanan dengan perubahan nilai aktual.',
  'Gunakan dua jendela yang sama-sama berisi data atau tampilkan belum cukup data. Definisikan urutan waktu dan ambang tren secara konsisten.',
  'Uji 0/1/2/3/4/6 skor, tren naik/turun/stabil, dan urutan riwayat; tidak membandingkan dengan kelompok kosong.');

f('QA-01','P2','Lint frontend belum menjadi pemeriksaan kualitas yang lulus','T',
  [ref(web+'eslint.config.mjs','export default')],
  'Pemeriksaan ESLint frontend menghasilkan 1.367 error dan 653 warning. Ini mencakup 24 rules-of-hooks, 34 immutability, 41 set-state-in-effect, 9 refs, serta banyak any/unused; jumlah diagnostik bukan jumlah bug unik.',
  'Jalankan ESLint dari apps/web sesuai perintah pada lampiran pengujian. Hasil mentah disertakan.',
  'Pelanggaran yang memengaruhi perilaku mudah tenggelam di antara utang lint; lulus TypeScript belum membuktikan hook/state benar.',
  'Prioritaskan rules-of-hooks, immutability, refs dan purity; kelompokkan per akar masalah. Tetapkan baseline sementara yang tidak mengizinkan pelanggaran baru, lalu kurangi bertahap.',
  'Pemeriksaan CI membedakan baseline lama dari regresi baru dan seluruh pelanggaran yang dapat menyebabkan kegagalan runtime sudah diselesaikan.');
f('QA-02','P2','Pengujian yang tersedia belum mencakup integritas alur lintas layanan','T',
  [ref('apps/scoring/pyproject.toml','[project]')],
  '78 tes scoring yang dijalankan lulus, tetapi reproduksi BUG-16 juga berhasil. Pemeriksaan TypeScript tidak memvalidasi kontrak HTTP, otorisasi per resource, transaksi submit, ataupun backup round-trip.',
  'Bandingkan tes yang ada dengan matriks kasus pada RENCANA_UJI.md. Reproduksi audit sengaja membuktikan cacat, bukan tes regresi yang menyatakan sistem benar.',
  'Kesamaan perilaku grading lama/baru dan kompilasi bersih dapat memberikan rasa aman meskipun integritas nilai serta kontrol akses masih bermasalah.',
  'Tambahkan tes negatif multiaktor, kontrak antarservice, fault injection submit/restore, dan kasus adversarial parser sebelum menambah snapshot kosmetik.',
  'Kasus prioritas P1 pada rencana uji mempunyai tes regresi yang gagal sebelum perbaikan dan lulus sesudahnya.');
f('QA-03','P3','Halaman role yang diduplikasi memperbesar risiko perbaikan tidak merata','S',
  [ref(proktor+'questions/[bankId]/page.tsx','handleExportTemplate'),ref(web+'app/dashboard/admin/questions/[bankId]/page.tsx','handleExportTemplate')],
  'Banyak halaman admin/proktor/guru membawa implementasi serupa yang terpisah. Salah satu jejak kode mati adalah handleExportTemplate yang menunjuk template_soal.docx tanpa pemanggil yang ditemukan; ini tidak dihitung sebagai tombol rusak yang terbukti dapat diklik.',
  'Bandingkan implementasi ujian, bank soal, monitoring dan statistik antarrole saat menerapkan perbaikan.',
  'Bug dapat bertahan di salah satu role meskipun role lain sudah diperbaiki; kode mati dan helper lama menyulitkan penelusuran.',
  'Satukan komponen dan layanan alur yang sama dengan kebijakan role eksplisit; bersihkan kode mati setelah memastikan tidak ada pemanggil dinamis.',
  'Perbaikan bersama diverifikasi untuk semua role dan izin tetap berada di backend, bukan hanya props UI.');

fs.writeFileSync(path.join(dir,'findings.json'),JSON.stringify(findings,null,2)+'\n');
// Move only the audit-generated lint file, never user source files.
const oldLint=path.join(root,'docs/audit-eslint-web.json');
const newLint=path.join(dir,'eslint-web.json');
if(fs.existsSync(oldLint) && !fs.existsSync(newLint)) fs.renameSync(oldLint,newLint);
const lint=JSON.parse(fs.readFileSync(newLint,'utf8'));
const lintSummary={errors:lint.reduce((n,x)=>n+x.errorCount,0),warnings:lint.reduce((n,x)=>n+x.warningCount,0),rules:{}};
for(const file of lint) for(const m of file.messages) {
  const key=m.ruleId||'(configuration/parser)';
  lintSummary.rules[key]=(lintSummary.rules[key]||0)+1;
}
fs.writeFileSync(path.join(dir,'eslint-summary.json'),JSON.stringify(lintSummary,null,2)+'\n');
const inventory=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'),'utf8'));
const pages=inventory.filter(x=>x.file.endsWith('/page.tsx'));
const tsReproductions=JSON.parse(fs.readFileSync(path.join(dir,'verification-results.json'),'utf8'));
const pyReproductions=JSON.parse(fs.readFileSync(path.join(dir,'verification-scoring.json'),'utf8'));
const reproductionCount=tsReproductions.length+pyReproductions.length;
const priorityCounts=Object.fromEntries(['P1','P2','P3'].map(p=>[p,findings.filter(f=>f.priority===p).length]));
const link=(r,prefix='../')=>`[${r.file}](${prefix}${r.file}) baris ${r.line}`;
const report=`# Audit kode, keamanan, dan UI/UX ACCA CBT

Tanggal: 19 September 2026. Baseline Git: \`a8861683c7612920a511859f1d1f009ec4d49f17\`.

## Kesimpulan dan urutan penanganan

Ditemukan **${findings.length} catatan temuan**: ${priorityCounts.P1} P1, ${priorityCounts.P2} P2, dan ${priorityCounts.P3} P3. Catatan ini menggabungkan bug, celah kontrol akses, cacat UI/UX, serta tiga temuan kualitas; bukan ${findings.length} eksploit yang semuanya sudah dibuktikan di produksi. **${reproductionCount} skenario reproduksi sintetis berhasil menunjukkan cacat saat ini**. Dua skenario memakai mesin penilaian Python asli; ${tsReproductions.length} lainnya memakai layanan asli dengan dependensi mock atau reproduksi algoritma.

Prioritas pertama adalah menjaga **kerahasiaan soal/kunci, integritas nilai, dan jawaban siswa**: SEC-01–04, SEC-06–10, SEC-14, BUG-03, BUG-08–09, BUG-15–16. Selanjutnya amankan dan uji **backup/restore** (SEC-12–13, BUG-02, BUG-04–05) sebelum mengandalkannya sebagai satu-satunya pemulihan. Perbaiki kontrak upload (BUG-01) dan alur penilaian manual (BUG-06) bersamaan dengan pengujian ujung-ke-ujung. Urutan dalam setiap kelompok mengikuti dependensi, bukan hanya nomor temuan.

Tidak ada kode aplikasi yang diubah oleh audit ini. Tidak dilakukan penghapusan objek storage, pengiriman payload ke layanan produksi, maupun pembacaan/mutasi database sekolah. Skrip bukti memakai data sintetis dan tidak memerlukan kredensial.

## Ruang lingkup dan batas kesimpulan

Inventaris mencakup **${inventory.length} berkas sumber / ${inventory.reduce((n,x)=>n+x.lines,0).toLocaleString('id-ID')} baris**, termasuk **${pages.length} halaman / ${pages.reduce((n,x)=>n+x.lines,0).toLocaleString('id-ID')} baris halaman**. Baris dihitung dengan pemisahan newline sehingga newline terakhir dapat menambah satu baris kosong. Sumber yang diinventarisasi: app/components/lib frontend, API Nest, scoring FastAPI, dan shared package. File konfigurasi yang relevan juga diperiksa secara terarah. Dependensi, build output, dan semua aset biner tidak dimasukkan dalam angka sumber.

Setiap halaman dicatat dalam [matriks halaman](audit-2026-09-19/MATRIKS_HALAMAN.md). Penelusuran dilakukan dari halaman ke helper API/controller/service serta penyimpanan dan scoring, dengan perhatian mendalam pada alur berisiko dan komponen bersama. **Inventaris seluruh baris tidak sama dengan verifikasi manual setiap baris atau semua kombinasi runtime.** Halaman salinan antarrole ditelusuri melalui struktur, pencarian pola, dan implementasi representatif; tidak diklaim telah diuji visual satu per satu. Tidak adanya temuan khusus pada halaman bukan sertifikasi bahwa halaman aman.

Lingkungan browser autentikasi, screenshot/responsivitas aktual, pembaca layar, database/FK deployment, reverse proxy, konfigurasi R2, rate limit eksternal, dan pemindaian advisory dependensi belum diuji. Layanan menggunakan database bersama menurut README, sehingga audit tidak mencoba migrasi/reset atau restore nyata. Schema Prisma tanpa model tidak digunakan sebagai bukti bahwa FK tidak ada. Tidak ada klaim CVE, kompromi produksi, atau XSS yang sudah dieksploitasi. Build produksi, uji beban, dan uji integrasi jaringan belum dijalankan.

## Hasil pemeriksaan

| Pemeriksaan | Hasil | Makna/batas |
|---|---|---|
| TypeScript frontend tanpa emit | Lulus | Konsistensi tipe, bukan validasi perilaku/otorisasi |
| TypeScript API tanpa emit | Lulus | Sama; banyak any membatasi jangkauan |
| Pytest scoring | 78 lulus | Tes yang ada lulus; tidak mencakup semua input adversarial |
| ESLint frontend | ${lintSummary.errors} error, ${lintSummary.warnings} warning | Gagal; diagnostik tidak dihitung sebagai bug unik |
| Reproduksi TypeScript/algoritma | ${tsReproductions.filter(x=>x.reproduced).length}/${tsReproductions.length} cacat tereproduksi | Mock DB/storage, tidak mengukur enforcement deployment |
| Reproduksi grading Python | 2/2 cacat tereproduksi | Fungsi scoring asli, data sintetis |

Perintah, bukti, dan batas reproduksi tercantum pada [rencana uji](audit-2026-09-19/RENCANA_UJI.md). Hasil mesin tersedia pada [verification-results.json](audit-2026-09-19/verification-results.json), [verification-scoring.json](audit-2026-09-19/verification-scoring.json), serta [ringkasan lint](audit-2026-09-19/eslint-summary.json). Hasil positif skrip reproduksi berarti **bug masih ada**, bukan aplikasi lulus keamanan.

## Cara membaca prioritas dan bukti

- **P1 — tinggi:** berpotensi merusak integritas ujian/nilai, membocorkan kunci, menghilangkan data, atau membuka akses lintas resource. Disarankan ditangani sebelum ujian nyata yang bergantung pada alur tersebut. Tidak diberi P0 karena dampak produksi/eksploit luas tanpa prasyarat belum diverifikasi.
- **P2 — sedang:** fungsi, informasi, aksesibilitas, atau pembatasan lokal tidak konsisten; tetap membutuhkan perbaikan terencana.
- **P3 — rendah:** utang pemeliharaan yang memperbesar kemungkinan regresi.
- **R:** cacat direproduksi dengan data sintetis; cakupan mock/algoritma dijelaskan per temuan.
- **S:** bukti langsung dari alur kode; skenario runtime yang ditulis adalah rencana validasi staging, bukan klaim sudah dijalankan.
- **T:** hasil pemeriksaan alat/tes. Ketergantungan pada konfigurasi atau data deployment dijelaskan dalam temuan.

## Indeks temuan

| ID | Prioritas | Bukti | Temuan |
|---|---|---|---|
${findings.map(x=>`| [${x.id}](#${x.id.toLowerCase()}) | ${x.priority} | ${x.evidence} | ${x.title} |`).join('\n')}

## Rincian temuan

${findings.map(x=>`<a id="${x.id.toLowerCase()}"></a>\n\n### ${x.id} — ${x.title}\n\n**Prioritas:** ${x.priority}. **Bukti:** ${x.evidence}. **Lokasi:** ${x.refs.map(r=>link(r)).join('; ')}.\n\n**Penyebab:** ${x.cause}\n\n**Skenario/verifikasi:** ${x.scenario}\n\n**Dampak:** ${x.impact}\n\n**Perbaikan yang disarankan:** ${x.fix}\n\n**Kriteria selesai:** ${x.accept}`).join('\n\n')}

## Hal yang perlu diverifikasi sebelum kesimpulan tambahan

1. Periksa rate limit login/API di reverse proxy dan layanan auth; tidak terlihat throttling lokal bukan bukti bahwa deployment tidak memilikinya.
2. Pastikan BACKUP_SECRET_KEY wajib disediakan. Kode memiliki fallback konstan; keberadaan fallback tidak membuktikan deployment memakainya. Gagalkan startup/operasi bila konfigurasi penting kosong.
3. Periksa kebijakan cookie, issuer/audience JWT, siklus sesi/logout, CORS/CSRF, security headers, dan batas request terhadap konfigurasi nyata. Jangan menyimpulkan token dapat dipalsukan hanya dari payload yang dapat dibaca.
4. Uji format jawaban malformed untuk setiap tipe (angka/null/objek bersarang/array besar), serta dampaknya pada satu batch scoring. BUG-16 baru membuktikan dua kasus duplikasi.
5. Audit semua penggunaan HTML kaya, sanitizer, SVG, PDF, dan URL eksternal secara end-to-end. Origin terpisah dan sandbox browser dapat mengubah dampak; tidak ada klaim stored XSS terkonfirmasi dalam laporan ini.
6. Verifikasi FK, indeks unik, transaksi, dan isolasi organisasi pada schema database yang benar-benar terpasang. Lakukan read-only review schema terpisah dari database sekolah jika memungkinkan.
7. Jalankan dependency advisory scan terkini atas lockfile pada lingkungan yang disetujui; audit ini tidak menganggap versi tertentu aman atau rentan tanpa data advisory.
8. Uji browser ponsel/desktop, zoom 200%, fokus, kontras terukur, screen reader, koneksi lambat, offline, dan pulih jaringan. Temuan UI di sini bersumber dari kode, bukan penilaian visual lengkap.

## Rencana pelaksanaan perbaikan

1. Buat fixture staging terisolasi: dua organisasi, dua guru, dua kelas, dua siswa, seluruh tipe soal, serta attempt tiap status. Jangan memakai data pribadi asli.
2. Tutup akses lintas resource dan kebocoran kunci. Jadikan kebijakan kelayakan ujian, rilis hasil, dan kepemilikan resource satu sumber aturan server.
3. Perbaiki state machine attempt, deadline, idempotensi, autosave revision, persist atomik, dan pelestarian nilai manual. Sertakan BUG-16 dalam tes grading.
4. Standarkan kontrak upload lalu desain ulang validasi dan atomicity backup/restore. Jalankan round-trip sebelum mengandalkan backup aplikasi untuk pemulihan.
5. Perbaiki status/error UI, monitoring, informasi waktu, aksesibilitas, dan laporan analitik. Terapkan ke seluruh role melalui komponen bersama.
6. Jalankan matriks regresi, lint yang diprioritaskan, build produksi, serta uji beban sesuai jumlah peserta yang benar-benar ditargetkan. Catat hasil dan risiko tersisa sebelum rilis.

## Lampiran

- [Matriks seluruh halaman](audit-2026-09-19/MATRIKS_HALAMAN.md)
- [Rencana uji dan reproduksi](audit-2026-09-19/RENCANA_UJI.md)
- [Daftar temuan terstruktur](audit-2026-09-19/findings.json)
- [Inventaris sumber beserta hash](audit-2026-09-19/inventory.json)
- [Hasil ESLint lengkap](audit-2026-09-19/eslint-web.json)

Nomor baris merujuk baseline audit dan dapat bergeser setelah perbaikan. Source anchor disimpan di findings.json agar lokasi tetap mudah ditemukan.
`;
fs.writeFileSync(path.join(root,'docs/AUDIT_LENGKAP_2026-09-19.md'),report);

function pageMap(file) {
  const route=file.replace('apps/web/app','').replace('/page.tsx','')||'/';
  if(route==='/') return ['QA-01','Login, transisi sesi, error/timeout, redirect role; uji rate limit deployment.'];
  if(route.includes('/pengawas')) return ['UX-01','Data live, izin role Pengawas, kondisi tanpa ujian, koneksi putus.'];
  if(route.includes('/notifications/settings')) return ['SEC-05, UX-07','Preferensi hanya milik pengguna sendiri, toggle keyboard/screen reader, simpan gagal.'];
  if(route.endsWith('/notifications')) return ['UX-02, UX-10','Lebih dari 50 item, filter server, unread count, aksi massal dan error.'];
  if(route.includes('/backup')) return ['SEC-12–13, BUG-02, BUG-04–05','Round-trip ZIP bergambar, izin awal, limit, kegagalan tengah restore, cakupan entitas.'];
  if(route.includes('/siswa/exam/')) return ['SEC-01–04, SEC-09–10, BUG-01, BUG-03, BUG-08–10, BUG-12, BUG-14, BUG-16','Kelayakan, kunci, waktu, offline/reload, autosave balapan, storage penuh, submit/retry.'];
  if(route.includes('/results/review/')) return ['SEC-14, BUG-11–12, BUG-15','Kunci hanya setelah rilis, status final, bukti historis, semua tipe soal.'];
  if(route.includes('/results/')) return ['SEC-14, UX-02, UX-06','Pemilik, rilis hasil, status, rincian skor dan waktu.'];
  if(route.endsWith('/results')) return ['SEC-14, UX-02, UX-04, UX-06–07','Status selesai, skor tersembunyi di API, keyboard, data kosong/error.'];
  if(route.endsWith('/siswa/schedule')) return ['SEC-01, BUG-13, UX-02, UX-06','Public/private, target kelas/individu, awal/akhir ujian dan zona waktu.'];
  if(route.endsWith('/siswa/analytics')) return ['SEC-14, UX-12','Rilis nilai, tren pendek, histori selesai, data minimum.'];
  if(route.endsWith('/siswa')) return ['SEC-14, UX-02, UX-04','Ringkasan hanya data yang boleh dirilis; hitungan aktif/selesai, error sesi.'];
  if(route.includes('/analytics/exam/')) return ['UX-11, BUG-06, BUG-15–16','Ekspor semua tipe, skor manual/otomatis konsisten, batas akses ujian.'];
  if(route.endsWith('/analytics')) return ['QA-01–02','Cakupan guru/organisasi, filter, empty/error, konsistensi ringkasan dan detail.'];
  if(route.includes('/grading/assignment/')) return ['SEC-08, BUG-01, BUG-06, BUG-15','Kepemilikan answer, nilai parsial, PDF/lampiran, rentang skor.'];
  if(route.includes('/grading/')) return ['SEC-08, BUG-06, BUG-15, UX-06','Penilaian parsial/lengkap, range, ID asing, regrade menjaga nilai manual.'];
  if(route.endsWith('/grading')) return ['BUG-06, UX-02, QA-02','Daftar pending benar, pergantian ujian, error, detail dengan izin.'];
  if(route.includes('/monitoring/')) return ['SEC-09–10, BUG-11, BUG-15, UX-05','Statistik esai/objektif, bukti historis, reset/terminate, izin staf.'];
  if(route.endsWith('/monitoring')) return ['SEC-09–10, UX-08','Balapan pemilihan ujian, refresh, log asli, reset/terminate idempoten.'];
  if(route.includes('/questions/') && route.endsWith('/edit')) return ['SEC-07, BUG-01, BUG-07, BUG-14–15','Soal/opsi asing, bobot nol, semua tipe, upload, pelestarian grading manual.'];
  if(route.includes('/questions/')) return ['SEC-07, SEC-11, BUG-01, BUG-07, BUG-11, BUG-14–15, QA-03','Impor/edit/delete, soal sudah dipakai, lampiran, preview, izin bank.'];
  if(route.endsWith('/questions')) return ['SEC-07, SEC-11, QA-03','Cakupan bank pemilik, kategori, pencarian, empty/error, aksi massal.'];
  if(route.includes('/exams/pas/')) return ['UX-09, BUG-05, BUG-13','Generate parsial, skipped, target hasil pembuatan dan backup jadwal.'];
  if(route.endsWith('/exams')) return ['SEC-01, SEC-14, BUG-12–13, QA-03','Publish public/private, target, waktu, release hasil, bank valid.'];
  if(route.includes('/assignments/')) return ['SEC-01, SEC-08, BUG-01, BUG-06','Penugasan peserta, berkas tugas, izin nilai dan hasil.'];
  if(route.endsWith('/pas')) return ['BUG-05, QA-02','Konfigurasi/jadwal tersimpan, izin, validasi waktu, pemulihan backup.'];
  if(route.endsWith('/classes')) return ['UX-02, QA-02','Keanggotaan/organisasi, CRUD bila role staf, empty/error dan paging.'];
  return ['UX-03, QA-01–03','Autentikasi dan role, agregasi, navigasi, loading/error/empty.'];
}
const matrix=`# Matriks cakupan halaman — 19 September 2026

Seluruh ${pages.length} file page.tsx diinventarisasi. Kolom temuan menunjukkan hubungan halaman dengan akar masalah bersama; bukan klaim bahwa setiap skenario sudah direproduksi melalui UI halaman itu. Semua halaman juga terkena perhatian lint, layout/auth bersama, dan pengujian keyboard/error. Tidak ada browser terautentikasi yang diuji dalam audit ini.

Metode: pembacaan struktur/pemanggil, pencarian pola salinan antarrole, serta penelusuran mendalam pada komponen dan layanan yang relevan. Halaman pendek seperti pembungkus ujian tetap ditelusuri ke ExamPage. Detail bukti per temuan berada di [laporan utama](../AUDIT_LENGKAP_2026-09-19.md); label R hanya berlaku pada skenario yang ditulis di sana.

| Halaman | Baris | Temuan terkait / perhatian | Uji halaman berikutnya di staging |
|---|---:|---|---|
${pages.map(p=>{const [ids,test]=pageMap(p.file);return `| [${p.file.replace('apps/web/app','').replace('/page.tsx','')||'/'}](../../${p.file}) | ${p.lines} | ${ids} | ${test} |`;}).join('\n')}

## Komponen/jalur bersama yang ditelusuri

| Jalur | Fokus |
|---|---|
| Dashboard layout, session, JWT/proxy helpers | Identitas, role, loading, error, perbedaan izin UI/server |
| ExamPage, ExamViewer, renderer/form tipe soal | Autosave, timer, offline, hook, metadata, lampiran |
| Students / exam-attempts | Penugasan, deadline, finalisasi, hasil, retry dan late sync |
| Questions / imports / grading / teachers | Kepemilikan bank/answer, bobot, regrade, penilaian manual |
| Proctoring / monitoring | Event, hitungan warning, reset/terminasi dan statistik |
| Storage / backup | Kontrak respons, kepemilikan objek, validasi arsip, integritas dan pemulihan |
| Analytics / notifications / PAS | Akurasi informasi, pagination, hasil parsial dan ekspor |
| FastAPI scoring dan parser | Paritas tes lama, validasi jawaban, duplikasi pilihan |

Inventaris penuh menyimpan path, jumlah baris, SHA-256, serta metadata struktur halaman pada [inventory.json](inventory.json). Angka baris adalah ukuran cakupan mekanis, bukan metrik kualitas atau jaminan semua baris telah diverifikasi manual.
`;
fs.writeFileSync(path.join(dir,'MATRIKS_HALAMAN.md'),matrix);
console.log(JSON.stringify({findings:findings.length,priorityCounts,sourceFiles:inventory.length,pages:pages.length,lint:lintSummary},null,2));
