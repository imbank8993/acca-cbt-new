/**
 * Dua PDF dari Monitoring → Hasil → Export:
 *  - "Analisis Soal": analisis umum untuk guru dan sekolah (ringkasan, sebaran capaian, hasil per bentuk soal,
 *    penguasaan materi, analisis tiap soal, daftar nilai);
 *  - "Laporan Siswa": satu laporan per siswa yang dapat dibagikan kepada siswa dan orang tua.
 * Bahasa dan batas: lib/analysis-plain.ts; dasar riset: docs/laporan-analisis-hasil-pdf-2026-11-16.md.
 */
import type { jsPDF } from 'jspdf';
import { formatAnswerKey, formatStudentAnswer, type DisplayQuestion } from './answer-display';
import {
    RELIABILITY_PLAIN, classNarrative, missedByTopic, parentAdvice, percentText, readItem, resultText,
    studentAdvice, studentNarrative, studentTypeRows, summarizeTypes, type ItemReading,
} from './analysis-plain';
import type { DetailedItemAnalysisResponse, ExamAnswerRecord, ExamAttemptRecord, OrganizationExam } from './api/proctor';
import type { QuestionRecord } from './api/questions';
import { MASTERY_BANDS, buildAssessmentReport, type AssessmentReport, type StudentReport } from './assessment-report';
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
const GOOD: RGB = [222, 244, 231], WARN: RGB = [254, 243, 214], BAD: RGB = [253, 226, 226], INFO: RGB = [224, 236, 255];

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

const CONCLUSION_FILL: Record<string, RGB | null> = { 'Layak dipakai': GOOD, 'Perlu diperbaiki': WARN, 'Periksa ulang': BAD, 'Belum dapat disimpulkan': null };
const bandFill = (id?: string | null): RGB | null => id === 'bimbingan' ? BAD : id === 'remedial' ? WARN : id === 'tuntas' ? GOOD : id === 'pengayaan' ? INFO : null;
const BAND_RANGE: Record<string, string> = { bimbingan: '0-40', remedial: '41-65', tuntas: '66-85', pengayaan: '86-100' };
const hasTopics = (report: AssessmentReport) => report.topics.some(topic => topic.name !== 'Tanpa materi');

interface Meta { title: string; subject: string; classes: string; date: string; created: string }

function classReport(w: Writer, report: AssessmentReport, readings: ItemReading[], meta: Meta, logo: KopLogo | null) {
    drawKop(w, logo, 'Analisis Soal');
    titleBlock(w, 'LAPORAN ANALISIS SOAL', meta.title);
    w.details([
        ['Mata pelajaran', meta.subject], ['Kelas', meta.classes],
        ['Tanggal ujian', meta.date], ['Jumlah soal', `${report.itemCount} soal`],
        ['Peserta', `${report.analyzed} dari ${report.registered} siswa`], ['Dicetak', meta.created],
    ]);
    w.y += 2;
    w.onNewPage = () => { drawKop(w, logo, `Analisis Soal - ${meta.title}`, true); };
    if (report.warnings.length) {
        w.y += 3;
        w.paragraph(`Perhatian: ${report.warnings.join(' ')}`, 8.5, [146, 86, 18], 'italic');
    }

    const d = report.descriptives;
    const passed = report.bandCounts.tuntas + report.bandCounts.pengayaan;
    const graded = Object.values(report.bandCounts).reduce((a, b) => a + b, 0);
    w.section('1. Ringkasan Hasil');
    w.stats([
        ['Rata-rata nilai', num(d?.mean, 1), 'skala 0-100'],
        ['Nilai tertinggi / terendah', d ? `${num(d.max)} / ${num(d.min)}` : '-'],
        ['Siswa tuntas', graded ? `${passed} siswa` : '-', graded ? `${percentText(passed / graded)} dari ${graded} siswa` : 'menunggu penilaian'],
        ['Keajegan soal', RELIABILITY_PLAIN(report.reliability.value), report.reliability.value == null ? '' : `reliabilitas ${num(report.reliability.value, 2)}`],
    ]);
    w.paragraph(classNarrative(report, readings));

    w.section('2. Sebaran Capaian Siswa');
    w.table([{ label: 'Kategori capaian', width: 42 }, { label: 'Rentang nilai', width: 26, align: 'center' }, { label: 'Jumlah siswa', width: 28, align: 'center' }, { label: 'Tindak lanjut', width: W - 96 }],
        MASTERY_BANDS.map(band => [band.label, BAND_RANGE[band.id], `${report.bandCounts[band.id]} (${graded ? percentText(report.bandCounts[band.id] / graded) : '-'})`, band.advice]),
        { fills: MASTERY_BANDS.map(band => [bandFill(band.id), null, null, null]) });

    w.section('3. Hasil per Bentuk Soal');
    const types = summarizeTypes(report.items, readings);
    w.table([{ label: 'Bentuk soal', width: 40 }, { label: 'Cara penilaian', width: W - 40 - 18 - 24 - 22 - 26 }, { label: 'Jumlah soal', width: 18, align: 'center' },
        { label: 'Capaian kelas', width: 24, align: 'center' }, { label: 'Layak dipakai', width: 22, align: 'center' }, { label: 'Perlu tindak lanjut', width: 26, align: 'center' }],
    types.map(type => [type.label, type.scoring, String(type.count), percentText(type.achievement), String(type.good), String(type.fix)]));

    if (hasTopics(report)) {
        w.section('4. Penguasaan Materi');
        w.table([{ label: 'Materi', width: W - 18 - 26 - 46 }, { label: 'Soal', width: 18, align: 'center' }, { label: 'Capaian kelas', width: 26, align: 'center' }, { label: 'Keterangan', width: 46 }],
            report.topics.map(topic => [topic.name, String(topic.questionCount), topic.percent == null ? '-' : `${num(topic.percent)}%`,
                topic.percent == null ? 'Menunggu penilaian' : topic.percent > 65 ? 'Sudah dikuasai' : 'Perlu diajarkan ulang']),
            { fills: report.topics.map(topic => [null, null, null, topic.percent == null ? null : topic.percent > 65 ? GOOD : WARN]) });
    }

    const n = hasTopics(report) ? 5 : 4;
    w.section(`${n}. Analisis Tiap Soal`);
    w.paragraph('Capaian kelas adalah rata-rata skor siswa dibandingkan skor maksimum soal. Penjelasan setiap kolom ada di bagian "Cara Membaca Laporan".', 8.5, MUTED);
    w.y += 1.5;
    w.table([{ label: 'No', width: 11, align: 'center' }, { label: 'Bentuk soal', width: 31 }, { label: 'Materi', width: W - 11 - 31 - 20 - 20 - 22 - 33 },
        { label: 'Capaian kelas', width: 20, align: 'center' }, { label: 'Kesulitan', width: 20, align: 'center' }, { label: 'Daya pembeda', width: 22, align: 'center' }, { label: 'Kesimpulan', width: 33 }],
    readings.map(item => [String(item.number), item.typeLabel, item.topic, percentText(item.achievement), item.difficulty, item.discrimination, item.conclusion]),
    { fills: readings.map(item => [null, null, null, null, null, null, CONCLUSION_FILL[item.conclusion]]), size: 8.5 });

    const noted = readings.filter(item => item.notes.length);
    if (noted.length) {
        w.section(`${n + 1}. Catatan dan Saran Perbaikan Soal`);
        w.table([{ label: 'No', width: 11, align: 'center' }, { label: 'Kesimpulan', width: 32 }, { label: 'Catatan dan saran', width: W - 43 }],
            noted.map(item => [String(item.number), item.conclusion, item.notes.join(' ')]),
            { fills: noted.map(item => [null, CONCLUSION_FILL[item.conclusion], null]) });
    }

    w.section(`${n + (noted.length ? 2 : 1)}. Daftar Nilai Siswa`);
    w.table([{ label: 'No', width: 11, align: 'center' }, { label: 'Nama siswa', width: W - 11 - 26 - 22 - 40 }, { label: 'Kelas', width: 26 },
        { label: 'Nilai', width: 22, align: 'center' }, { label: 'Kategori', width: 40 }],
    report.students.map((student, index) => [String(index + 1), student.name, student.className, student.score == null ? '-' : num(student.score), student.band?.label || 'Menunggu penilaian']),
    { fills: report.students.map(student => [null, null, null, null, bandFill(student.band?.id)]) });

    w.section('Cara Membaca Laporan');
    const terms: Array<[string, string]> = [
        ['Capaian kelas', 'Rata-rata skor seluruh siswa pada satu soal dibandingkan skor maksimumnya. Untuk soal yang hanya dinilai benar atau salah, angka ini sama dengan persentase siswa yang menjawab benar.'],
        ['Kesulitan', 'Mudah jika capaian kelas di atas 70%, sedang jika 31-70%, dan sulit jika 30% atau kurang.'],
        ['Daya pembeda', 'Kemampuan soal membedakan siswa yang sudah menguasai materi dengan yang belum, dihitung dari selisih capaian 27% siswa bernilai tertinggi dan 27% siswa bernilai terendah. Baik: 0,30 atau lebih; cukup: 0,20-0,29; kurang: di bawah 0,20; terbalik: siswa bernilai rendah justru lebih banyak benar.'],
        ['Kesimpulan', 'Layak dipakai: soal berfungsi dengan baik. Perlu diperbaiki: soal dapat dipakai lagi setelah kalimat, pilihan jawaban, atau pedoman penskorannya diperbaiki. Periksa ulang: ada tanda kunci jawaban keliru atau soal bermakna ganda.'],
        ['Bentuk soal', 'Pilihan ganda juga diperiksa dari pilihan jawaban yang dipilih siswa. Soal yang dapat bernilai sebagian (benar-salah, menjodohkan, mengurutkan, isian, uraian) juga diperiksa dari banyaknya siswa yang hanya benar sebagian.'],
        ['Keajegan soal', 'Menunjukkan seberapa konsisten soal-soal mengukur kemampuan yang sama (reliabilitas). Baik: 0,70 atau lebih; cukup: 0,60-0,69; kurang: di bawah 0,60. Jika kurang, gunakan hasil ujian ini bersama bukti lain, misalnya tugas dan pengamatan.'],
        ['Kategori capaian', 'Mengikuti interval kriteria ketercapaian tujuan pembelajaran (KKTP): 0-40 perlu bimbingan, 41-65 remedial sebagian, 66-85 tuntas, 86-100 pengayaan.'],
    ];
    w.table([{ label: 'Istilah', width: 34 }, { label: 'Arti', width: W - 34 }], terms.map(([term, text]) => [term, text]));
    w.y += 1;
    w.paragraph('Rujukan: Depdiknas (2008) Panduan Analisis Butir Soal; Kemendikbudristek (2024) Panduan Pembelajaran dan Asesmen; '
        + 'Ebel & Frisbie (1991); Haladyna & Downing (1993); Zenisky & Hambleton (2012). Data teknis lengkap (korelasi butir, '
        + 'parameter IRT, sebaran pilihan jawaban) tersedia pada ekspor Excel.', 7.8, MUTED);
}

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

    const mean = report.descriptives?.mean;
    w.stats([
        ['Nilai', student.score == null ? 'Menunggu' : num(student.score), student.score == null ? 'penilaian guru belum selesai' : 'dari 100'],
        ['Kategori', student.band?.label || 'Menunggu', student.band ? `rentang nilai ${BAND_RANGE[student.band.id]}` : ''],
        ['Rata-rata kelas', num(mean), 'sebagai pembanding'],
        ...(student.scaled != null ? [['Skor IRT', num(student.scaled), 'skala 200-800'] as [string, string, string]] : []),
    ]);

    w.y += 1;
    w.paragraph(studentNarrative(student, mean));

    w.section('Hasil per Bentuk Soal');
    const rows = studentTypeRows(student.items);
    w.table([{ label: 'Bentuk soal', width: 46 }, { label: 'Jumlah', width: 20, align: 'center' }, { label: 'Hasil', width: W - 46 - 20 - 26 }, { label: 'Capaian', width: 26, align: 'center' }],
        rows.map(row => [row.label, String(row.count), resultText(row), percentText(row.achievement)]), { pad: 1.3 });

    const topics = student.topics.filter(topic => topic.max > 0 && topic.name !== 'Tanpa materi');
    const missed = missedByTopic(student.items);
    const missedFor = new Map(missed.map(group => [group.topic, group.numbers.join(', ')]));
    if (topics.length) {
        w.section('Penguasaan Materi');
        w.table([{ label: 'Materi', width: W - 22 - 36 - 50 }, { label: 'Capaian', width: 22, align: 'center' }, { label: 'Keterangan', width: 36 }, { label: 'Nomor soal yang belum tepat', width: 50 }],
            topics.map(topic => [topic.name, `${num(topic.percent)}%`, (topic.percent ?? 0) > 65 ? 'Sudah dikuasai' : 'Perlu ditingkatkan', missedFor.get(topic.name) || '-']),
            { fills: topics.map(topic => [null, null, (topic.percent ?? 0) > 65 ? GOOD : WARN, null]), pad: 1.3 });
        const other = missedFor.get('Tanpa materi');
        if (other) w.paragraph(`Soal lain yang belum tepat: nomor ${other}.`, 9);
    } else if (missed.length) {
        w.section('Soal yang Perlu Dipelajari Kembali');
        w.paragraph(`Nomor soal: ${missed.flatMap(group => group.numbers).sort((a, b) => a - b).join(', ')}.`);
    }

    w.section('Saran');
    w.paragraph('Untuk siswa', 9, INK, 'bold');
    w.bullets(studentAdvice(student));
    w.y += 1;
    w.ensure(w.lineHeight(9) * 4);
    w.paragraph('Untuk orang tua/wali', 9, INK, 'bold');
    w.bullets([parentAdvice(student.band?.id)]);
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
    const readings = report.items.map(item => readItem(item, report.analyzed));

    if (kind === 'soal') {
        pdf.setProperties({ title: `Analisis Soal - ${meta.title}`, subject: 'Analisis soal dan hasil ujian kelas', creator: 'ACCA CBT' });
        classReport(w, report, readings, meta, logo);
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
    return { pdf, report, readings };
}

export async function exportAnalysisToPdf(options: AnalysisPdfOptions, kind: AnalysisPdfKind = 'soal') {
    const { pdf } = await buildAnalysisPdf(options, kind);
    pdf.save(analysisPdfFileName(options.exam?.title || 'Ujian', kind));
}
