// Deterministic, deliberately dense sample for visual review of the analysis export.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith('@/')) request = path.resolve(__dirname, '../apps/web', request.slice(2));
    return resolveFilename.call(this, request, parent, ...rest);
};
require('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const { buildAnalysisPdf } = require('../apps/web/lib/export-analysis-pdf.ts');

const questionCount = 24;
const studentCount = 12;
const classical = process.env.PREVIEW_CLASSICAL === '1';
const topics = [
    'Persamaan dan pertidaksamaan linear',
    'Fungsi kuadrat serta interpretasi grafik',
    'Statistika deskriptif dan peluang',
    'Geometri bidang dan pengukuran',
];
const questions = Array.from({ length: questionCount }, (_, index) => {
    const id = `q${index + 1}`;
    return {
        id, number: index + 1, type: 'mcq', score_default: 1,
        topic: topics[index % topics.length], question_text: `<p>Butir ${index + 1}</p>`,
        options: ['A', 'B', 'C', 'D'].map((letter, optionIndex) => ({
            id: `${id}${letter}`, option_text: `Pilihan ${letter}`, is_correct: optionIndex === 0,
        })),
    };
});
const matrix = Array.from({ length: studentCount }, (_, student) => ({
    attempt_id: `a${student + 1}`,
    student_name: `Peserta Contoh dengan Nama Panjang ${student + 1}`,
    student_nis: `202600${String(student + 1).padStart(2, '0')}`,
    class_name: student % 2 ? 'X IPA 2' : 'X IPA 1',
    status: 'submitted',
    items: Object.fromEntries(questions.map((question, index) => {
        const correct = student * 7 + ((student * 11 + index * 23) % 21) - (index % 7) * 6 >= 36;
        const unanswered = (student + index * 3) % 29 === 0;
        return [question.id, {
            status: unanswered ? 'unanswered' : correct ? 'correct' : 'wrong',
            score: correct ? 1 : 0,
        }];
    })),
}));
const attempts = matrix.map((row, student) => {
    const correct = Object.values(row.items).filter(cell => cell.status === 'correct').length;
    return {
        id: row.attempt_id, status: 'submitted', total_score: correct / questionCount * 100,
        detailed_scores: { classical: correct / questionCount * 100, irt_3pl: (student - 5.5) / 3 },
        metadata: { irt_score_scale: 'theta' }, kelas_name: row.class_name,
    };
});
const answers = matrix.flatMap(row => questions.map(question => {
    const state = row.items[question.id].status;
    return { attempt_id: row.attempt_id, question_id: question.id,
        selected_option_id: state === 'unanswered' ? null : `${question.id}${state === 'correct' ? 'A' : 'B'}` };
}));
const irt = {
    models: ['irt_1pl', 'irt_2pl', 'irt_3pl'],
    items: questions.map((question, index) => ({ question_id: question.id, b: (index % 7 - 3) / 2, a: 0.75 + index % 5 * 0.2, c: 0.2 })),
};

(async () => {
    const { pdf, report } = await buildAnalysisPdf({
        exam: { title: 'Asesmen Akhir Semester Matematika Kelas X', subject: 'Matematika', scoring_type: classical ? 'classical' : 'classical,irt_3pl', start_time: '2026-11-10T01:00:00.000Z' },
        attempts, detailedAnalysis: { matrix, items: [] }, questions, answers, irt: classical ? null : irt,
        timeZone: 'Asia/Makassar', profile: null,
    });
    const output = process.argv[2] || path.resolve(__dirname, '../tmp/pdfs/analysis-preview.pdf');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(pdf.output('arraybuffer')));
    console.log(`${output} (${pdf.getNumberOfPages()} pages, reliability ${report.reliability.value?.toFixed(2) ?? 'unavailable'})`);
})().catch(error => { console.error(error); process.exitCode = 1; });
