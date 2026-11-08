# Uji beban pengumpulan serentak (k6)

Meniru 200–300 siswa yang mengerjakan ujian lalu **mengumpulkan pada detik yang sama**
(waktu ujian habis bersamaan). Jalankan di server **staging** atau pada ujian uji coba
khusus — jangan pada ujian sungguhan.

## Persiapan

1. Pasang k6: <https://grafana.com/docs/k6/latest/set-up/install-k6/>
2. Buat ujian uji coba berisi soal pilihan ganda (`mcq`), terbitkan, dan tugaskan ke
   akun-akun siswa uji. Durasi ujian harus lebih panjang dari `SUBMIT_AT_SECONDS`.
   Matikan screenshot pada ujian ini.
3. Siapkan `students.txt`: satu UUID akun siswa uji per baris.

## Menjalankan

```bash
k6 run \
  -e BASE_URL=https://acca-cbt-staging.icgowa.sch.id \
  -e EXAM_ID=<uuid-ujian-uji-coba> \
  -e JWT_SECRET=<JWT_SECRET-server-staging> \
  -e STUDENTS_FILE=./students.txt \
  -e SUBMIT_AT_SECONDS=240 \
  tools/loadtest/submit-burst.k6.js
```

Variabel lain: `RAMP_SECONDS` (60), `AUTOSAVE_SECONDS` (20), `MAX_STUDENTS`,
atau `TOKENS_FILE` (satu token Bearer per baris) sebagai ganti `JWT_SECRET`.

Sambil berjalan, pantau di VPS:

```bash
docker stats
psql -c "SELECT state, wait_event_type, count(*) FROM pg_stat_activity GROUP BY 1,2;"
docker logs -f acca-cbt-api 2>&1 | grep -iE "P2028|P2024|penilaian tertunda"
```

## Membaca hasil

- `cbt_submit_failed` harus 0. Ini angka paling penting.
- `cbt_submit_duration` p95 di bawah 20 detik.
- `cbt_submit_grading_pending` boleh lebih dari 0: jawaban sudah tersimpan,
  nilai dihitung ulang oleh worker dalam 30 detik.
- `cbt_autosave_failed` mendekati 0; autosave yang gagal saat burst berarti pool
  koneksi masih kurang (`DB_CONNECTION_LIMIT`).
