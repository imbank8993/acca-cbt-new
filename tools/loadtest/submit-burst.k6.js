/**
 * Uji beban ACCA CBT: banyak siswa mengerjakan lalu MENGUMPULKAN SERENTAK.
 *
 * Skenario per siswa (1 VU = 1 siswa):
 *   1. Mulai pengerjaan + ambil soal (disebar selama RAMP_SECONDS).
 *   2. Autosave jawaban pilihan ganda tiap AUTOSAVE_SECONDS sampai detik ke-SUBMIT_AT_SECONDS.
 *   3. Semua siswa memanggil submit-intent + submit pada detik yang SAMA
 *      (meniru waktu ujian habis bersamaan).
 *
 * JANGAN jalankan pada ujian sungguhan. Pakai server staging atau ujian uji coba
 * khusus, dengan akun siswa uji yang sudah ditugaskan ke ujian itu.
 *
 * Contoh:
 *   k6 run \
 *     -e BASE_URL=https://acca-cbt-staging.icgowa.sch.id \
 *     -e EXAM_ID=<uuid ujian uji coba> \
 *     -e JWT_SECRET=<JWT_SECRET server staging> \
 *     -e STUDENTS_FILE=./students.txt \
 *     -e SUBMIT_AT_SECONDS=240 \
 *     tools/loadtest/submit-burst.k6.js
 *
 * STUDENTS_FILE: satu UUID pengguna siswa per baris (kolom `id` akun CBT).
 * Sebagai ganti JWT_SECRET, boleh TOKENS_FILE: satu token Bearer per baris.
 * Jumlah VU = jumlah baris (dibatasi MAX_STUDENTS bila diisi).
 */
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const EXAM_ID = __ENV.EXAM_ID || '';
const RAMP_SECONDS = Number(__ENV.RAMP_SECONDS || 60);
const AUTOSAVE_SECONDS = Number(__ENV.AUTOSAVE_SECONDS || 20);
const SUBMIT_AT_SECONDS = Number(__ENV.SUBMIT_AT_SECONDS || 240);
const MAX_STUDENTS = Number(__ENV.MAX_STUDENTS || 0);

if (!BASE_URL || !EXAM_ID) throw new Error('BASE_URL dan EXAM_ID wajib diisi.');
if (SUBMIT_AT_SECONDS <= RAMP_SECONDS + 30) throw new Error('SUBMIT_AT_SECONDS harus > RAMP_SECONDS + 30.');

function readLines(path) {
    return open(path).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

const credentials = new SharedArray('credentials', () => {
    let lines;
    if (__ENV.TOKENS_FILE) lines = readLines(__ENV.TOKENS_FILE).map(token => ({ token }));
    else if (__ENV.STUDENTS_FILE && __ENV.JWT_SECRET) lines = readLines(__ENV.STUDENTS_FILE).map(userId => ({ userId }));
    else throw new Error('Isi TOKENS_FILE, atau STUDENTS_FILE + JWT_SECRET.');
    return MAX_STUDENTS > 0 ? lines.slice(0, MAX_STUDENTS) : lines;
});

const submitDuration = new Trend('cbt_submit_duration', true);
const autosaveDuration = new Trend('cbt_autosave_duration', true);
const submitOk = new Counter('cbt_submit_ok');
const submitFailed = new Counter('cbt_submit_failed');
const gradingPending = new Counter('cbt_submit_grading_pending');
const autosaveFailed = new Counter('cbt_autosave_failed');

export const options = {
    scenarios: {
        students: {
            executor: 'per-vu-iterations',
            vus: credentials.length,
            iterations: 1,
            maxDuration: `${SUBMIT_AT_SECONDS + 300}s`,
        },
    },
    thresholds: {
        cbt_submit_failed: ['count==0'],
        cbt_autosave_failed: ['count<10'],
        cbt_submit_duration: ['p(95)<20000'],
        cbt_autosave_duration: ['p(95)<3000'],
    },
};

/** Token HS256 sebentuk dengan yang diterbitkan auth.service.ts (sub = authId = UUID). */
function mintToken(userId) {
    const now = Math.floor(Date.now() / 1000);
    const header = encoding.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'rawurl');
    const payload = encoding.b64encode(JSON.stringify({
        sub: userId, authId: userId, role: 'Siswa', iat: now, exp: now + 4 * 3600,
    }), 'rawurl');
    const signature = crypto.hmac('sha256', __ENV.JWT_SECRET, `${header}.${payload}`, 'base64rawurl');
    return `${header}.${payload}.${signature}`;
}

export function setup() {
    // Satu titik waktu bersama: semua siswa submit pada detik yang sama.
    return { submitAtMs: Date.now() + SUBMIT_AT_SECONDS * 1000 };
}

export default function (data) {
    const credential = credentials[__VU - 1];
    const token = credential.token || mintToken(credential.userId);
    const deviceId = `k6-loadtest-device-${__VU}-${EXAM_ID.slice(0, 8)}`;
    const params = (name) => ({
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Origin: BASE_URL,
        },
        tags: { name },
        timeout: '60s',
    });

    // 1. Masuk bertahap seperti siswa membuka ujian.
    sleep(Math.random() * RAMP_SECONDS);
    const started = http.post(`${BASE_URL}/api/students/exams/${EXAM_ID}/attempts`,
        JSON.stringify({ deviceId, screenCaptureReady: true }), params('start'));
    const startBody = started.json() || {};
    const attempt = startBody.attempt;
    if (!check(started, { 'mulai ujian 2xx': r => r.status >= 200 && r.status < 300 && Boolean(attempt && attempt.id) })) {
        console.error(`VU ${__VU}: gagal mulai (${started.status}) ${String(started.body).slice(0, 200)}`);
        return;
    }

    const questionsRes = http.get(`${BASE_URL}/api/students/exams/${EXAM_ID}/questions`, params('questions'));
    check(questionsRes, { 'ambil soal 2xx': r => r.status >= 200 && r.status < 300 });
    // Hanya pilihan ganda biasa: jawabannya cukup satu id opsi.
    const questions = ((questionsRes.json() || {}).questions || [])
        .filter(q => q.type === 'mcq')
        .map(q => ({ id: q.id, options: (q.bank_question_options || []).map(o => o.id).filter(Boolean) }))
        .filter(q => q.options.length > 0);

    const answers = {};
    const revisions = {};
    const sessionStartedAt = attempt.started_at;

    // 2. Autosave berkala: beberapa soal dijawab / diubah tiap putaran.
    while (Date.now() < data.submitAtMs - AUTOSAVE_SECONDS * 1000) {
        sleep(AUTOSAVE_SECONDS * (0.7 + Math.random() * 0.6));
        if (!questions.length) continue;
        const batch = [];
        for (let i = 0; i < 3; i++) {
            const q = questions[Math.floor(Math.random() * questions.length)];
            answers[q.id] = q.options[Math.floor(Math.random() * q.options.length)];
            revisions[q.id] = (revisions[q.id] || 0) + 1;
            batch.push({ questionId: q.id, selected_option_id: answers[q.id], revision: revisions[q.id] });
        }
        const saved = http.put(`${BASE_URL}/api/students/attempts/${attempt.id}/answers`,
            JSON.stringify({ answers: batch, deviceId, sessionStartedAt }), params('autosave'));
        autosaveDuration.add(saved.timings.duration);
        if (!check(saved, { 'autosave 2xx': r => r.status >= 200 && r.status < 300 })) {
            autosaveFailed.add(1);
            console.warn(`VU ${__VU}: autosave ${saved.status} ${String(saved.body).slice(0, 160)}`);
        }
    }

    // 3. Tunggu titik submit bersama, lalu submit serentak.
    const wait = (data.submitAtMs - Date.now()) / 1000;
    if (wait > 0) sleep(wait);

    const submission = { answers, attemptId: attempt.id, deviceId, answerRevisions: revisions };
    const begin = Date.now();
    const intent = http.post(`${BASE_URL}/api/students/attempts/${attempt.id}/submit-intent`,
        JSON.stringify({ deviceId, submission }), params('submit-intent'));
    const submitted = http.post(`${BASE_URL}/api/students/exams/${EXAM_ID}/submit`,
        JSON.stringify(submission), params('submit'));
    submitDuration.add(Date.now() - begin);

    const ok = check(submitted, { 'submit 2xx': r => r.status >= 200 && r.status < 300 }) &&
        check(intent, { 'submit-intent 2xx': r => r.status >= 200 && r.status < 300 });
    if (ok) {
        submitOk.add(1);
        if ((submitted.json() || {}).gradingPending) gradingPending.add(1);
    } else {
        submitFailed.add(1);
        console.error(`VU ${__VU}: submit gagal intent=${intent.status} submit=${submitted.status} ${String(submitted.body).slice(0, 200)}`);
    }
}
