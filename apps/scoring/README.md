# apps/scoring — layanan penilaian & AI (FastAPI)

Menangani perhitungan nilai, IRT, analitik butir, dan integrasi AI untuk CBT.

## Prinsip

**Layanan ini tidak punya akses database.** Tidak ada `DATABASE_URL` di
`.env.example`, dan itu disengaja. NestJS tetap satu-satunya pemilik akses
PostgreSQL: ia mengambil data, mengirimkannya ke sini lewat payload, menerima
hasilnya, lalu menulis kembali. Akibatnya otorisasi dan kepemilikan data hanya
ditegakkan di satu tempat, dan layanan ini bisa di-deploy ulang tanpa memikirkan
kredensial.

Hanya NestJS yang boleh memanggilnya, dari mesin yang sama, dengan header
`x-api-key`. Tanpa `SCORING_API_KEY` terkonfigurasi, seluruh permintaan ditolak
— salah konfigurasi harus terlihat, bukan diam-diam permisif.

## Menjalankan

```bash
cd apps/scoring
python -m venv .venv
.venv/Scripts/activate        # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # isi SCORING_API_KEY, samakan dengan apps/api/.env
uvicorn app.main:app --reload --port 8000
```

Dokumentasi endpoint: <http://127.0.0.1:8000/docs>

Dari root monorepo: `npm run dev:scoring`

## Endpoint

| Endpoint | Asal kode |
|---|---|
| `POST /grading/answer` | `calculateSingleAnswerScore` |
| `POST /grading/attempt` | `gradeAttemptFromSavedAnswers` |
| `POST /grading/relative` | `applyRelativeQuizScoring` |
| `POST /irt/calculate` | `calculateExamIRT` (1PL/2PL/3PL) |
| `POST /analytics/exam` | `getExamAnalytics` |
| `POST /analytics/items` | baru — indeks kesukaran & daya beda |
| `POST /ai/kisi-kisi` | `generateKisiKisiAction` |
| `POST /ai/essay-score` | baru — usulan nilai esai |

## Uji paritas

Nilai siswa tidak boleh bergeser hanya karena penilaiannya pindah bahasa.
`tests/test_grading_parity.py` menjalankan 77 kasus — mencakup ke-13 tipe soal
berikut bentuk jawaban warisan dan rusak — lalu membandingkan hasilnya dengan
keluaran fungsi TypeScript ASLI.

```bash
.venv/Scripts/python.exe -m pytest tests/ -q
```

Fixture harapan dihasilkan dari kode TypeScript yang sebenarnya, bukan ditulis
tangan:

```bash
node tools/gen-grading-cases.js
```

Ada satu selisih yang disengaja, dijelaskan di dalam berkas ujinya: untuk
pilihan ganda berjawaban string kosong, versi TypeScript menghasilkan
`is_correct = ""` (operator `&&` di JavaScript mengembalikan operan falsy)
padahal tipenya `boolean | null`. Python mengembalikan `None`.

## Yang belum dipindahkan

Parsing dokumen (`lib/doc-parser.ts` 905 baris, `lib/excel-parser.ts` 666 baris)
belum ada di sini. Keduanya kini berjalan **di browser**, bukan di server —
memindahkannya berarti berkas harus diunggah lebih dulu, jadi ini perubahan alur
kerja, bukan sekadar pemindahan kode. Lihat docs/MIGRASI_BACKEND.md.
