/**
 * Uji hidup endpoint analitik terhadap acca_db.
 *
 * Mencari data nyata (ujian dengan peserta, staf organisasinya, siswa yang
 * sudah menyelesaikan ujian), menerbitkan token untuk masing-masing, lalu
 * memanggil setiap endpoint dan melaporkan status serta bentuk balasannya.
 *
 *   node tools/probe-analytics.js
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', 'apps', 'api', '.env') });

const BASE = 'http://127.0.0.1:3004/api';
const prisma = new PrismaClient();

function token(authId) {
    return jwt.sign({ sub: authId }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

async function call(label, path, bearer) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${bearer}` },
    });
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text.slice(0, 200);
    }
    console.log(`\n${res.status}  ${label}`);
    console.log(`     GET ${path}`);
    console.log('     ' + ringkas(body));
    return { status: res.status, body };
}

/** Ringkas balasan jadi satu baris: kunci + ukuran, bukan seluruh isinya. */
function ringkas(body) {
    if (body === null || typeof body !== 'object') return String(body);
    return Object.entries(body)
        .map(([k, v]) => {
            if (Array.isArray(v)) return `${k}[${v.length}]`;
            if (v && typeof v === 'object') return `${k}{${Object.keys(v).join(',')}}`;
            return `${k}=${JSON.stringify(v)}`;
        })
        .join('  ');
}

async function main() {
    // Ujian yang benar-benar punya peserta selesai — analisis butir baru bermakna.
    const [exam] = await prisma.$queryRawUnsafe(`
        SELECT e.id, e.title, e.organization_id, e.created_by, e.exam_type,
               COUNT(a.id)::int AS peserta
        FROM cbt_exams e
        JOIN cbt_exam_attempts a ON a.exam_id = e.id
         AND a.status IN ('submitted', 'auto_submitted')
        GROUP BY e.id
        ORDER BY peserta DESC
        LIMIT 1
    `);

    if (!exam) {
        console.log('Tidak ada ujian dengan peserta selesai di acca_db — uji dilewati.');
        return;
    }
    console.log(`Ujian uji : ${exam.title} (${exam.peserta} peserta selesai)`);

    // Staf yang berhak atas ujian itu: pembuatnya kalau ada, kalau tidak Proktor
    // organisasinya.
    let staffId = exam.created_by;
    if (!staffId) {
        const [proktor] = await prisma.$queryRawUnsafe(
            `SELECT m.user_id FROM cbt_organization_members m
             JOIN cbt_roles r ON r.id = m.role_id
             WHERE m.organization_id = $1::uuid AND r.name IN ('Proktor', 'Admin')
             LIMIT 1`,
            exam.organization_id,
        );
        staffId = proktor?.user_id;
    }

    const [attempt] = await prisma.$queryRawUnsafe(
        `SELECT id, user_id FROM cbt_exam_attempts
         WHERE exam_id = $1::uuid AND status IN ('submitted', 'auto_submitted')
         LIMIT 1`,
        exam.id,
    );

    const [question] = await prisma.$queryRawUnsafe(
        `SELECT q.id FROM cbt_bank_questions q
         WHERE q.bank_id = (SELECT question_bank_id FROM cbt_exams WHERE id = $1::uuid)
         LIMIT 1`,
        exam.id,
    );

    console.log(`Staf      : ${staffId}`);
    console.log(`Siswa     : ${attempt?.user_id}`);
    console.log(`Attempt   : ${attempt?.id}`);
    console.log(`Soal      : ${question?.id}`);

    const staf = token(staffId);
    const siswa = token(attempt.user_id);

    console.log('\n──────── STAF ────────');
    await call('daftar ujian + statistik', `/analytics/exams?organizationId=${exam.organization_id}`, staf);
    await call('analisis satu ujian', `/analytics/exams/${exam.id}`, staf);
    await call('peringkat peserta', `/analytics/exams/${exam.id}/students`, staf);
    await call('data ekspor', `/analytics/exams/${exam.id}/export`, staf);
    if (question) {
        await call('respons satu soal', `/analytics/exams/${exam.id}/questions/${question.id}/responses`, staf);
    }
    await call('review attempt (staf)', `/analytics/attempts/${attempt.id}/review`, staf);

    console.log('\n──────── SISWA ────────');
    await call('rekap analitik', '/student-analytics', siswa);
    await call('riwayat ujian', '/student-analytics/history?limit=5', siswa);
    await call('perbandingan kelas', '/student-analytics/comparison', siswa);
    await call('review hasil ujian', `/exam-review/attempts/${attempt.id}`, siswa);

    console.log('\n──────── OTORISASI (harus DITOLAK) ────────');
    await call('siswa membuka analitik staf', `/analytics/exams/${exam.id}`, siswa);
    await call('siswa membuka review staf', `/analytics/attempts/${attempt.id}/review`, siswa);

    // Attempt milik orang lain: siswa lain yang ujiannya berbeda.
    const [lain] = await prisma.$queryRawUnsafe(
        `SELECT id, user_id FROM cbt_exam_attempts
         WHERE user_id <> $1::uuid AND status IN ('submitted', 'auto_submitted')
         LIMIT 1`,
        attempt.user_id,
    );
    if (lain) {
        await call(`siswa membuka review attempt milik ${lain.user_id.slice(0, 8)}…`,
            `/exam-review/attempts/${lain.id}`, siswa);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
