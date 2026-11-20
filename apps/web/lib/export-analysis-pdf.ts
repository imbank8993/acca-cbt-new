/**
 * Dua PDF dari Monitoring → Hasil → Export:
 *  - "Analisis Soal": ringkasan nilai, sebaran nilai, hasil per bentuk soal dan materi, statistik tiap soal, daftar nilai;
 *  - "Laporan Siswa": satu halaman per siswa.
 * Keduanya hanya menyajikan data dan angka: tanpa narasi, kategori, kesimpulan, atau saran.
 * Bahasa dan batas: lib/analysis-plain.ts; dasar riset: docs/laporan-analisis-hasil-pdf-2026-11-16.md.
 */
import type { jsPDF } from 'jspdf';
import { formatAnswerKey, formatStudentAnswer, type DisplayQuestion } from './answer-display';
import { missedByTopic, percentText, readItem, studentTypeRows, summarizeTypes, typeInfo } from './analysis-plain';
import type { DetailedItemAnalysisResponse, ExamAnswerRecord, ExamAttemptRecord, OrganizationExam } from './api/proctor';
import type { QuestionRecord } from './api/questions';
import { buildAssessmentReport, type AssessmentReport, type StudentReport } from './assessment-report';
import type { IrtCalibration } from './irt-calibration';
import { fitLogo, loadPublicImage, type KopLogo } from './school-logo';
import { getSchoolTimeZoneLabel } from './school-time';

export interface AnalysisPdfOptions {
    exam: OrganizationExam | undefined;
    attempts: ExamAttemptRecord[];
    detailedAnalysis: DetailedItemAnalysisResponse | null;
    questions: QuestionRecord[];
    answers: ExamAnswerRecord[];
    irt?: IrtCalibration | null;
    timeZone?: string;
}
export type AnalysisPdfKind = 'soal' | 'siswa';

/** Logo ACCA (wordmark) di pojok kiri atas kop. */
export const ACCA_LOGO_PATH = '/logo-sidebar.png';
const L = 18, R = 192, W = R - L, TOP = 14, BOTTOM = 279;
type RGB = [number, number, number];
const INK: RGB = [30, 41, 59], MUTED: RGB = [100, 116, 139], BLUE: RGB = [31, 107, 240], LINE: RGB = [221, 227, 235], SOFT: RGB = [244, 247, 251];

/** Font standar PDF hanya WinAnsi: ganti simbol yang tidak tersedia. */
export function pdfSafe(text: unknown): string {
    return String(text ?? '')
        .replace(/θ/g, 'theta').replace(/α/g, 'alpha').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/√/g, 'akar ')
        .replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/→/g, '->')
        .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}
const num = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits).replace('.', ',');

export function analysisPdfFileName(title: string, kind: AnalysisPdfKind = 'soal'): string {
    const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').slice(0, 100) || 'Ujian';
    return `${kind === 'soal' ? 'Analisis_Soal' : 'Laporan_Siswa'}_${safe}.pdf`;
}

interface Column { label: string; width: number; align?: 'left' | 'center' | 'right' }
interface TableOptions { fills?: Array<Array<RGB | null>>; size?: number; pad?: number }

class Writer {
    y = TOP;
    /** Jarak lebih rapat untuk laporan siswa agar muat satu halaman. */
    compact = false;
    /** Dipanggil setiap halaman lanjutan dibuat. */
    onNewPage: () => void = () => { this.y = TOP; };
    constructor(readonly pdf: jsPDF) {}

    font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', rgb: RGB = INK) { this.pdf.setFont('helvetica', style); this.pdf.setFontSize(size); this.pdf.setTextColor(...rgb); }
    lines(text: string, width: number) { return this.pdf.splitTextToSize(pdfSafe(text), width) as string[]; }
    lineHeight(size: number) { return size * 0.3528 * 1.4; }
    newPage() { this.pdf.addPage(); this.onNewPage(); }
    ensure(height: number) { if (this.y + height > BOTTOM) this.newPage(); }

    section(title: string) {
        this.y += this.compact ? 3 : 5;
        this.ensure(this.compact ? 16 : 24);
        this.font(11.5, 'bold', INK);
        this.pdf.text(pdfSafe(title), L, this.y + 3);
        this.pdf.setDrawColor(...BLUE); this.pdf.setLineWidth(0.6); this.pdf.line(L, this.y + 5, L + 14, this.y + 5);
        this.y += this.compact ? 8 : 9;
    }
    paragraph(text: string, size = 9.5, rgb: RGB = INK, style: 'normal' | 'bold' | 'italic' = 'normal', indent = 0) {
        this.font(size, style, rgb);
        const height = this.lineHeight(size);
        for (const line of this.lines(text, W - indent)) {
            if (this.y + height > BOTTOM) { this.newPage(); this.font(size, style, rgb); }
            this.pdf.text(line, L + indent, this.y + height * 0.75);
            this.y += height;
        }
    }
    bullets(items: string[], size = 9.5) {
        const height = this.lineHeight(size);
        for (const item of items) {
            this.font(size);
            const lines = this.lines(item, W - 6);
            this.ensure(height * Math.min(2, lines.length));
            this.pdf.setFillColor(...BLUE); this.pdf.circle(L + 1.5, this.y + height * 0.5, 0.7, 'F');
            this.font(size);
            for (const line of lines) {
                if (this.y + height > BOTTOM) { this.newPage(); this.font(size); }
                this.pdf.text(line, L + 6, this.y + height * 0.75);
                this.y += height;
            }
            this.y += 1;
        }
    }
    /** Baris label–isi tanpa bingkai (identitas dokumen). */
    details(rows: Array<[string, string]>, columns = 2) {
        const colWidth = W / columns, labelWidth = 32, size = 9, height = this.lineHeight(size) + 0.6;
        for (let start = 0; start < rows.length; start += columns) {
            const group = rows.slice(start, start + columns);
            const lineCount = Math.max(...group.map(([, value]) => { this.font(size, 'bold'); return this.lines(value, colWidth - labelWidth - 4).length; }));
            this.ensure(height * lineCount);
            group.forEach(([label, value], index) => {
                const x = L + index * colWidth;
                this.font(size, 'normal', MUTED); this.pdf.text(pdfSafe(label), x, this.y + height * 0.75);
                this.font(size, 'bold'); this.pdf.text(this.lines(value, colWidth - labelWidth - 4), x + labelWidth, this.y + height * 0.75, { lineHeightFactor: 1.4 });
            });
            this.y += height * lineCount;
        }
    }
    stats(cards: Array<[string, string, string?]>) {
        const gap = 4, height = this.compact ? 17 : 19, width = (W - gap * (cards.length - 1)) / cards.length;
        this.ensure(height + 4);
        cards.forEach(([label, value, hint], index) => {
            const x = L + index * (width + gap);
            this.pdf.setFillColor(...SOFT); this.pdf.roundedRect(x, this.y, width, height, 2, 2, 'F');
            const k = height / 19;
            this.font(8, 'normal', MUTED); this.pdf.text(this.lines(label, width - 6)[0] || '', x + 3.5, this.y + 5.5 * k);
            this.font(value.length > 14 ? 11 : 15, 'bold'); this.pdf.text(this.lines(value, width - 6)[0] || '', x + 3.5, this.y + 12.3 * k);
            if (hint) { this.font(7.5, 'normal', MUTED); this.pdf.text(this.lines(hint, width - 6)[0] || '', x + 3.5, this.y + 16.6 * k); }
        });
        this.y += height + 4;
    }
    table(columns: Column[], rows: string[][], options: TableOptions = {}) {
        const size = options.size ?? 8.8, pad = options.pad ?? 2, lh = this.lineHeight(size);
        const xs = columns.map((_, index) => L + columns.slice(0, index).reduce((sum, column) => sum + column.width, 0));
        this.font(size, 'bold');
        const headings = columns.map(column => this.lines(column.label, column.width - pad * 2));
        const headerHeight = Math.max(...headings.map(lines => lines.length)) * lh + pad * 2;
        const header = () => {
            this.font(size, 'bold', MUTED);
            this.pdf.setFillColor(...SOFT); this.pdf.rect(L, this.y, W, headerHeight, 'F');
            headings.forEach((lines, index) => this.cellText(lines, xs[index], columns[index], pad, lh));
            this.y += headerHeight;
        };
        this.ensure(headerHeight + lh * 3 + pad * 2);
        header();
        rows.forEach((row, rowIndex) => {
            this.font(size);
            const wrapped = row.map((cell, index) => this.lines(cell, columns[index].width - pad * 2));
            const height = Math.max(...wrapped.map(lines => lines.length)) * lh + pad * 2;
            if (this.y + height > BOTTOM) { this.newPage(); header(); this.font(size); }
            options.fills?.[rowIndex]?.forEach((color, index) => {
                if (!color) return;
                this.pdf.setFillColor(...color);
                this.pdf.roundedRect(xs[index] + 0.8, this.y + pad - 1, columns[index].width - 1.6, wrapped[index].length * lh + 2, 1, 1, 'F');
            });
            this.pdf.setTextColor(...INK);
            wrapped.forEach((lines, index) => this.cellText(lines, xs[index], columns[index], pad, lh));
            this.pdf.setDrawColor(...LINE); this.pdf.setLineWidth(0.2); this.pdf.line(L, this.y + height, R, this.y + height);
            this.y += height;
        });
        this.y += 3;
    }
    private cellText(lines: string[], x: number, column: Column, pad: number, lh: number) {
        const align = column.align ?? 'left';
        const tx = align === 'right' ? x + column.width - pad : align === 'center' ? x + column.width / 2 : x + pad;
        lines.forEach((line, index) => this.pdf.text(line, tx, this.y + pad + lh * index + lh * 0.75, { align }));
    }
}

/** Kop: logo ACCA di kiri atas, jenis dokumen di kanan, garis biru di bawahnya. */
function drawKop(w: Writer, logo: KopLogo | null, kind: string, small = false) {
    const { pdf } = w;
    const top = 10, boxH = small ? 5.5 : 8.5;
    if (logo) {
        const size = fitLogo(logo, small ? 32 : 48, boxH);
        pdf.addImage(logo.dataUrl, 'PNG', L, top, size.width, size.height, 'acca-logo', 'FAST');
    } else {
        w.font(small ? 11 : 16, 'bold', BLUE); pdf.text('ACCA', L, top + boxH - 1);
    }
    w.font(small ? 7.5 : 8.5, 'bold', MUTED); pdf.text(pdfSafe(kind.toUpperCase()), R, top + boxH - 1.5, { align: 'right' });
    const lineY = top + boxH + 3;
    pdf.setDrawColor(...BLUE); pdf.setLineWidth(small ? 0.3 : 0.6); pdf.line(L, lineY, R, lineY);
    w.y = lineY + (small ? 6 : 8);
}

function titleBlock(w: Writer, title: string, subtitle: string) {
    w.font(15, 'bold'); w.pdf.text(pdfSafe(title), (L + R) / 2, w.y + 2, { align: 'center' });
    w.y += 7.5;
    w.font(10.5, 'normal', MUTED);
    w.lines(subtitle, W - 20).forEach(line => { w.pdf.text(line, (L + R) / 2, w.y + 1, { align: 'center' }); w.y += 5; });
    w.y += 3;
}

function footer(pdf: jsPDF, left: (page: number) => string) {
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        pdf.setPage(page);
        pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(L, 285, R, 285);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED);
        pdf.text(pdf.splitTextToSize(pdfSafe(left(page)), W - 36)[0] || '', L, 289.5);
        pdf.text(`Halaman ${page} dari ${pages}`, R, 289.5, { align: 'right' });
    }
}

const hasTopics = (report: AssessmentReport) => report.topics.some(topic => topic.name !== 'Tanpa materi');
const SCORE_RANGES: Array<[string, (score: number) => boolean]> = [
    ['0-40', score => score <= 40], ['41-65', score => score > 40 && score <= 65],
    ['66-85', score => score > 65 && score <= 85], ['86-100', score => score > 85],
];

interface Meta { title: string; subject: string; classes: string; date: string; created: string }

/** Laporan analisis soal: hanya data dan angka, tanpa narasi, kategori, atau kesimpulan. */
function classReport(w: Writer, report: AssessmentReport, meta: Meta, logo: KopLogo | null) {
    drawKop(w, logo, 'Analisis Soal');
    titleBlock(w, 'LAPORAN ANALISIS SOAL', meta.title);
    w.details([
        ['Mata pelajaran', meta.subject], ['Kelas', meta.classes],
        ['Tanggal ujian', meta.date], ['Jumlah soal', `${report.itemCount} soal`],
        ['Peserta', `${report.analyzed} dari ${report.registered} siswa`], ['Dicetak', meta.created],
    ]);
    w.y += 2;
    w.onNewPage = () => { drawKop(w, logo, `Analisis Soal - ${meta.title}`, true); };

    const d = report.descriptives;
    w.section('1. Ringkasan Nilai');
    w.stats([
        ['Rata-rata', num(d?.mean, 1)], ['Median', num(d?.median, 1)],
        ['Tertinggi / terendah', d ? `${num(d.max)} / ${num(d.min)}` : '-'], ['Simpangan baku', num(d?.sd, 1)],
    ]);
    w.stats([
        ['Peserta dinilai', String(d?.n ?? 0)], ['Kuartil 1 / 3', d ? `${num(d.q1, 1)} / ${num(d.q3, 1)}` : '-'],
        ['Reliabilitas', num(report.reliability.value, 2), report.reliability.method], ['SEM', num(report.reliability.sem, 2)],
    ]);

    w.section('2. Sebaran Nilai');
    const scores = report.students.map(student => student.score).filter((score): score is number => score != null);
    w.table([{ label: 'Rentang nilai', width: 58 }, { label: 'Jumlah siswa', width: 58, align: 'center' }, { label: 'Persentase', width: W - 116, align: 'center' }],
        SCORE_RANGES.map(([label, inRange]) => {
            const count = scores.filter(inRange).length;
            return [label, String(count), scores.length ? percentText(count / scores.length) : '-'];
        }));

    w.section('3. Hasil per Bentuk Soal');
    const types = summarizeTypes(report.items, report.items.map(item => readItem(item, report.analyzed)));
    w.table([{ label: 'Bentuk soal', width: W - 40 - 40 }, { label: 'Jumlah soal', width: 40, align: 'center' }, { label: 'Capaian rata-rata', width: 40, align: 'center' }],
        types.map(type => [type.label, String(type.count), percentText(type.achievement)]));

    let n = 4;
    if (hasTopics(report)) {
        w.section(`${n++}. Capaian per Materi`);
        w.table([{ label: 'Materi', width: W - 40 - 40 }, { label: 'Jumlah soal', width: 40, align: 'center' }, { label: 'Capaian', width: 40, align: 'center' }],
            report.topics.map(topic => [topic.name, String(topic.questionCount), topic.percent == null ? '-' : `${num(topic.percent)}%`]));
    }

    w.section(`${n++}. Statistik Tiap Soal`);
    w.table([{ label: 'No', width: 9, align: 'center' }, { label: 'Bentuk soal', width: 25 }, { label: 'Materi', width: W - 9 - 25 - 12 - 13 - 14 - 13 - 13 - 13 - 13 - 13 },
        { label: 'Skor maks', width: 12, align: 'center' }, { label: 'Dinilai', width: 13, align: 'center' },
        { label: 'Benar penuh', width: 14, align: 'center' }, { label: 'Benar sebagian', width: 13, align: 'center' }, { label: 'Skor nol', width: 13, align: 'center' },
        { label: 'p', width: 13, align: 'center' }, { label: 'D', width: 13, align: 'center' }, { label: 'r it', width: 13, align: 'center' }],
    report.items.map(item => [String(item.number), typeInfo(item.type).label, item.topic, num(item.maxScore, item.maxScore % 1 ? 1 : 0), String(item.graded),
        percentText(item.fullShare), percentText(item.partialShare), percentText(item.zeroShare), num(item.p, 2), num(item.d, 2), num(item.ritc, 2)]),
    { size: 7.8, pad: 1.6 });
    w.paragraph('p = indeks kesukaran (0-1); D = indeks daya pembeda (27% atas - 27% bawah); r it = korelasi skor butir dengan skor total.', 7.5, MUTED);

    w.section(`${n}. Daftar Nilai Siswa`);
    w.table([{ label: 'No', width: 11, align: 'center' }, { label: 'Nama siswa', width: W - 11 - 26 - 18 - 16 - 16 - 16 - 16 }, { label: 'Kelas', width: 26 },
        { label: 'Nilai', width: 18, align: 'center' }, { label: 'Benar', width: 16, align: 'center' }, { label: 'Sebagian', width: 16, align: 'center' },
        { label: 'Salah', width: 16, align: 'center' }, { label: 'Kosong', width: 16, align: 'center' }],
    report.students.map((student, index) => [String(index + 1), student.name, student.className, student.score == null ? '-' : num(student.score),
        String(student.correct), String(student.partial), String(student.wrong), String(student.unanswered)]));
}

/** Laporan per siswa: hanya data dan angka, tanpa narasi, kategori, atau saran. */
function studentPage(w: Writer, report: AssessmentReport, student: StudentReport, meta: Meta, logo: KopLogo | null) {
    w.onNewPage = () => { drawKop(w, logo, `Laporan Hasil Ujian - ${student.name}`, true); };
    w.compact = true;
    drawKop(w, logo, 'Laporan Hasil Ujian Siswa');
    w.y -= 2;
    titleBlock(w, 'LAPORAN HASIL UJIAN SISWA', meta.title);
    w.y -= 2;
    w.details([
        ['Nama', student.name], ['Mata pelajaran', meta.subject],
        ['NIS', student.nis], ['Tanggal ujian', meta.date],
        ['Kelas', student.className], ['Jumlah soal', `${student.items.length} soal`],
    ]);
    w.y += 3;

    w.stats([
        ['Nilai', student.score == null ? '-' : num(student.score)],
        ['Rata-rata kelas', num(report.descriptives?.mean)],
        ...(student.scaled != null ? [['Skor IRT', num(student.scaled)] as [string, string]] : []),
    ]);
    w.stats([
        ['Benar', String(student.correct)], ['Benar sebagian', String(student.partial)],
        ['Salah', String(student.wrong)], ['Tidak dijawab', String(student.unanswered)],
    ]);

    w.section('Hasil per Bentuk Soal');
    w.table([{ label: 'Bentuk soal', width: W - 18 * 6 }, { label: 'Jumlah', width: 18, align: 'center' }, { label: 'Benar', width: 18, align: 'center' },
        { label: 'Sebagian', width: 18, align: 'center' }, { label: 'Salah', width: 18, align: 'center' }, { label: 'Kosong', width: 18, align: 'center' }, { label: 'Capaian', width: 18, align: 'center' }],
    studentTypeRows(student.items).map(row => [row.label, String(row.count), String(row.full), String(row.partial), String(row.wrong), String(row.empty), percentText(row.achievement)]),
    { pad: 1.3 });

    const topics = student.topics.filter(topic => topic.max > 0 && topic.name !== 'Tanpa materi');
    const missedFor = new Map(missedByTopic(student.items).map(group => [group.topic, group.numbers]));
    if (topics.length) {
        w.section('Capaian per Materi');
        w.table([{ label: 'Materi', width: W - 24 - 20 - 50 }, { label: 'Skor', width: 24, align: 'center' }, { label: 'Capaian', width: 20, align: 'center' }, { label: 'Nomor soal belum tepat', width: 50 }],
            topics.map(topic => [topic.name, `${num(topic.earned, 1)} / ${num(topic.max, 1)}`, `${num(topic.percent)}%`, missedFor.get(topic.name)?.join(', ') || '-']),
            { pad: 1.3 });
    }
    const listed = new Set(topics.map(topic => topic.name));
    const rest = [...missedFor.entries()].filter(([topic]) => !listed.has(topic)).flatMap(([, numbers]) => numbers).sort((x, y) => x - y);
    if (rest.length) w.paragraph(`Nomor soal belum tepat${topics.length ? ' (lainnya)' : ''}: ${rest.join(', ')}`, 9);
}

function prepare(options: AnalysisPdfOptions) {
    const detailed = options.detailedAnalysis;
    if (!detailed?.matrix?.length) throw new Error('Belum ada peserta yang dapat dianalisis.');
    const keyDisplay: Record<string, string> = {};
    const display = new Map<string, DisplayQuestion>(options.questions.map(question => [question.id, {
        type: question.type, question_text: question.question_text, metadata: question.metadata,
        options: (question.options || question.bank_question_options || []).map(option => ({ ...option, id: option.id || '' })),
    } as DisplayQuestion]));
    for (const item of detailed.items ?? []) keyDisplay[item.id] = item.key_display || '-';
    for (const [id, question] of display) {
        const key = formatAnswerKey(question).join('; ');
        if (key) keyDisplay[id] = key;
        else if (!keyDisplay[id]) keyDisplay[id] = ['essay', 'esay', 'uraian'].includes(question.type) ? 'Rubrik / koreksi manual' : '-';
    }
    const raw = new Map(options.answers.map(answer => [`${answer.attempt_id}:${answer.question_id}`, answer]));
    const matrix = detailed.matrix.map(row => ({ ...row, items: Object.fromEntries(Object.entries(row.items).map(([questionId, cell]) => {
        const question = display.get(questionId), answer = raw.get(`${row.attempt_id}:${questionId}`);
        return [questionId, question && answer ? { ...cell, display_answer: formatStudentAnswer(question, answer.selected_option_id, answer.essay_answer).join('; ') || '-' } : cell];
    })) }));
    const report = buildAssessmentReport({
        questions: options.questions.map((question, index) => ({ ...question, number: question.number ?? index + 1,
            options: question.options || question.bank_question_options || [] })),
        matrix, attempts: options.attempts as never, answers: options.answers, keyDisplay,
        irt: options.irt ?? null, scoringType: options.exam?.scoring_type,
    });
    if (!report.analyzed) throw new Error('Belum ada peserta yang mengumpulkan jawaban.');

    const zone = options.timeZone || 'Asia/Jakarta';
    const dateText = (value?: string | null, time = false) => value && Number.isFinite(Date.parse(value))
        ? new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'long', ...(time ? { timeStyle: 'short' } : {}) }).format(new Date(value)) : '-';
    const classes = [...new Set(options.attempts.flatMap(attempt => String(attempt.kelas_name || '').split(',').map(name => name.trim()).filter(name => name && name !== '-')))]
        .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
    const meta: Meta = {
        title: options.exam?.title || 'Ujian', subject: options.exam?.subject || '-', classes: classes.join(', ') || '-',
        date: dateText(options.exam?.start_time), created: `${dateText(new Date().toISOString(), true)} ${getSchoolTimeZoneLabel(zone)}`,
    };
    return { report, meta };
}

export async function buildAnalysisPdf(options: AnalysisPdfOptions, kind: AnalysisPdfKind = 'soal') {
    const { report, meta } = prepare(options);
    const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadPublicImage(ACCA_LOGO_PATH).catch(() => null)]);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const w = new Writer(pdf);

    if (kind === 'soal') {
        pdf.setProperties({ title: `Analisis Soal - ${meta.title}`, subject: 'Analisis soal dan hasil ujian kelas', creator: 'ACCA CBT' });
        classReport(w, report, meta, logo);
        footer(pdf, () => `ACCA CBT  /  Analisis Soal  /  ${meta.title}`);
    } else {
        pdf.setProperties({ title: `Laporan Siswa - ${meta.title}`, subject: 'Laporan hasil ujian per siswa', creator: 'ACCA CBT' });
        const owner: string[] = [];
        report.students.forEach((student, index) => {
            if (index > 0) pdf.addPage();
            const first = pdf.getNumberOfPages();
            studentPage(w, report, student, meta, logo);
            for (let page = first; page <= pdf.getNumberOfPages(); page++) owner[page] = student.name;
        });
        footer(pdf, page => `ACCA CBT  /  ${owner[page] || ''}  /  ${meta.title}`);
    }
    return { pdf, report };
}

export async function exportAnalysisToPdf(options: AnalysisPdfOptions, kind: AnalysisPdfKind = 'soal') {
    const { pdf } = await buildAnalysisPdf(options, kind);
    pdf.save(analysisPdfFileName(options.exam?.title || 'Ujian', kind));
}
