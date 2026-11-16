/**
 * PDF "Laporan Analisis Hasil" (Monitoring → Hasil → Export → PDF): satu berkas A4 berisi
 * analisis kelas (ringkasan, distribusi, reliabilitas, IRT, materi, butir, pengecoh, rekap)
 * lalu satu laporan untuk setiap peserta. Dasar: docs/laporan-analisis-hasil-pdf-2026-11-16.md.
 */
import type { jsPDF } from 'jspdf';
import { formatAnswerKey, formatStudentAnswer, type DisplayQuestion } from './answer-display';
import type { DetailedItemAnalysisResponse, ExamAnswerRecord, ExamAttemptRecord, OrganizationExam } from './api/proctor';
import type { QuestionRecord } from './api/questions';
import { MASTERY_BANDS, buildAssessmentReport, type AssessmentReport, type StudentReport } from './assessment-report';
import type { IrtCalibration } from './irt-calibration';
import { drawPdfKop } from './pas/pdf-kop';
import { formatKopParts, type ProfilSekolah } from './pas/print-kop';
import { loadKopLogo } from './school-logo';
import { getSchoolTimeZoneLabel } from './school-time';

export interface AnalysisPdfOptions {
    exam: OrganizationExam | undefined;
    attempts: ExamAttemptRecord[];
    detailedAnalysis: DetailedItemAnalysisResponse | null;
    questions: QuestionRecord[];
    answers: ExamAnswerRecord[];
    irt?: IrtCalibration | null;
    profile?: ProfilSekolah | null;
    timeZone?: string;
}

const L = 15, R = 195, W = R - L, TOP = 16, BOTTOM = 280;
type RGB = [number, number, number];
const INK: RGB = [18, 38, 63], MUTED: RGB = [100, 116, 139], BLUE: RGB = [38, 91, 151], LINE: RGB = [224, 231, 240], SOFT: RGB = [245, 248, 252];
const HEAD: RGB = [231, 238, 247];
const GOOD: RGB = [220, 243, 230], WARN: RGB = [254, 243, 214], BAD: RGB = [253, 226, 226], NONE: RGB = [238, 241, 245];
const BAND_SHORT: Record<string, string> = { bimbingan: 'remedial menyeluruh', remedial: 'remedial sebagian', tuntas: 'penguatan', pengayaan: 'pengayaan' };
const BAND_COLOR: Record<string, RGB> = { bimbingan: [220, 38, 38], remedial: [217, 119, 6], tuntas: [22, 128, 61], pengayaan: [37, 99, 235] };

/** Font standar PDF hanya WinAnsi: ganti simbol yang tidak tersedia. */
export function pdfSafe(text: unknown): string {
    return String(text ?? '')
        .replace(/θ/g, 'theta').replace(/α/g, 'alpha').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/√/g, 'akar ')
        .replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/→/g, '->')
        .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}
const num = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits).replace('.', ',');
const pct = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? '-' : `${(value * 100).toFixed(digits).replace('.', ',')}%`;

export function analysisPdfFileName(title: string): string {
    const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').slice(0, 100) || 'Ujian';
    return `Laporan_Analisis_${safe}.pdf`;
}

interface Column { label: string; width: number; align?: 'left' | 'center' | 'right' }
interface TableOptions { size?: number; fills?: Array<Array<RGB | null> | RGB | null>; bold?: number[]; pad?: number; onRow?: (index: number, y: number, height: number) => void; minContinuationRows?: number }

class Writer {
    y = TOP;
    running = '';
    constructor(readonly pdf: jsPDF, readonly footer: string) {}

    color(rgb: RGB) { this.pdf.setTextColor(...rgb); }
    font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', rgb: RGB = INK) { this.pdf.setFont('helvetica', style); this.pdf.setFontSize(size); this.color(rgb); }
    lines(text: string, width: number) { return this.pdf.splitTextToSize(pdfSafe(text), width) as string[]; }
    lineHeight(size: number) { return size * 0.3528 * 1.3; }

    newPage(title = this.running) {
        this.pdf.addPage();
        this.y = TOP;
        if (title) {
            this.font(7.5, 'bold', MUTED);
            this.pdf.text(pdfSafe(title), L, this.y);
            this.pdf.setDrawColor(...LINE); this.pdf.setLineWidth(0.2); this.pdf.line(L, this.y + 1.8, R, this.y + 1.8);
            this.y += 7;
        }
    }
    ensure(height: number) { if (this.y + height > BOTTOM) this.newPage(); }

    section(number: string, title: string, note?: string) {
        this.y += 4;
        this.ensure(22);
        this.pdf.setFillColor(...BLUE); this.pdf.rect(L, this.y - 3.6, 1.2, 5, 'F');
        this.font(12, 'bold');
        this.pdf.text(pdfSafe(number ? `${number}  ${title}` : title), L + 3.5, this.y);
        this.y += 5;
        if (note) this.paragraph(note, 8, MUTED);
        this.y += 1;
    }
    sub(title: string) {
        this.y += 2.5;
        this.ensure(14);
        this.font(9.5, 'bold', BLUE);
        this.pdf.text(pdfSafe(title), L, this.y + 1);
        this.y += 5.5;
    }
    paragraph(text: string, size = 8.5, rgb: RGB = INK, indent = 0, style: 'normal' | 'bold' | 'italic' = 'normal') {
        this.font(size, style, rgb);
        const lines = this.lines(text, W - indent);
        const height = this.lineHeight(size);
        for (const line of lines) {
            this.ensure(height);
            this.pdf.text(line, L + indent, this.y + height * 0.72);
            this.y += height;
        }
    }
    bullets(items: string[], size = 8.5, rgb: RGB = INK) {
        for (const item of items) {
            this.font(size, 'normal', rgb);
            const lines = this.lines(item, W - 5);
            const height = this.lineHeight(size);
            this.ensure(height * Math.min(lines.length, 3));
            this.pdf.text('•', L + 1, this.y + height * 0.72);
            for (const line of lines) {
                this.ensure(height);
                this.pdf.text(line, L + 5, this.y + height * 0.72);
                this.y += height;
            }
            this.y += 0.6;
        }
    }
    cards(cards: Array<[string, string, string?]>, height = 16, perRow = 3) {
        const gap = 3;
        for (let start = 0; start < cards.length; start += perRow) {
            const group = cards.slice(start, start + perRow);
            this.ensure(height + gap);
            const width = (W - gap * (group.length - 1)) / group.length;
            group.forEach(([label, value, hint], index) => {
                const x = L + index * (width + gap);
                this.pdf.setFillColor(...SOFT); this.pdf.roundedRect(x, this.y, width, height, 1.5, 1.5, 'F');
                this.font(6.8, 'bold', MUTED); this.pdf.text(this.lines(label.toUpperCase(), width - 5)[0] || '', x + 2.5, this.y + 4.5);
                this.font(value.length > 20 ? 9.5 : 11.5, 'bold'); this.pdf.text(this.lines(value, width - 5)[0] || '', x + 2.5, this.y + 10.3);
                if (hint) { this.font(6.7, 'normal', MUTED); this.pdf.text(this.lines(hint, width - 5)[0] || '', x + 2.5, this.y + 14.2); }
            });
            this.y += height + gap;
        }
    }
    table(columns: Column[], rows: string[][], options: TableOptions = {}) {
        const size = options.size ?? 7.3;
        const pad = options.pad ?? 1.5, lh = this.lineHeight(size);
        const xs = columns.map((_, index) => L + columns.slice(0, index).reduce((sum, column) => sum + column.width, 0));
        this.font(size, 'bold');
        const headings = columns.map(column => this.lines(column.label, column.width - pad * 2));
        const headerHeight = Math.max(...headings.map(lines => lines.length)) * lh + pad * 2;
        const rowHeights = rows.map((row, rowIndex) => {
            this.font(size, options.bold?.includes(rowIndex) ? 'bold' : 'normal');
            return Math.max(...row.map((cell, index) => this.lines(cell, columns[index].width - pad * 2).length)) * lh + pad * 2;
        });
        const remainingHeights = new Array<number>(rows.length);
        for (let index = rows.length - 1, total = 0; index >= 0; index--) remainingHeights[index] = total += rowHeights[index];
        const header = () => {
            this.font(size, 'bold', [38, 65, 100]);
            this.pdf.setFillColor(...HEAD); this.pdf.rect(L, this.y, W, headerHeight, 'F');
            headings.forEach((lines, index) => this.cellText(lines, xs[index], columns[index], pad, lh));
            this.y += headerHeight;
        };
        this.ensure(lh * 4 + 6);
        header();
        rows.forEach((row, rowIndex) => {
            this.font(size, options.bold?.includes(rowIndex) ? 'bold' : 'normal');
            const wrapped = row.map((cell, index) => this.lines(cell, columns[index].width - pad * 2));
            const height = rowHeights[rowIndex];
            const remaining = remainingHeights[rowIndex];
            if (options.minContinuationRows && rows.length - rowIndex <= options.minContinuationRows
                && this.y + remaining > BOTTOM && remaining + headerHeight < BOTTOM - TOP - 7) {
                this.newPage(); header(); this.font(size, options.bold?.includes(rowIndex) ? 'bold' : 'normal');
            }
            if (this.y + height > BOTTOM) { this.newPage(); header(); this.font(size, options.bold?.includes(rowIndex) ? 'bold' : 'normal'); }
            const fill = options.fills?.[rowIndex];
            columns.forEach((column, index) => {
                const color = Array.isArray(fill) && typeof fill[0] !== 'number' ? (fill as Array<RGB | null>)[index] : fill as RGB | null | undefined;
                if (color) { this.pdf.setFillColor(...color); this.pdf.rect(xs[index], this.y, column.width, height, 'F'); }
            });
            this.color(INK);
            wrapped.forEach((lines, index) => this.cellText(lines, xs[index], columns[index], pad, lh));
            options.onRow?.(rowIndex, this.y, height);
            this.pdf.setDrawColor(...LINE); this.pdf.setLineWidth(0.15); this.pdf.line(L, this.y + height, R, this.y + height);
            this.y += height;
        });
        this.y += 3;
    }
    private cellText(lines: string[], x: number, column: Column, pad: number, lh: number) {
        const align = column.align ?? 'left';
        const tx = align === 'right' ? x + column.width - pad : align === 'center' ? x + column.width / 2 : x + pad;
        lines.forEach((line, index) => this.pdf.text(line, tx, this.y + pad + lh * index + lh * 0.72, { align }));
    }
}

function bandFill(id?: string | null): RGB | null {
    return id === 'bimbingan' ? BAD : id === 'remedial' ? WARN : id === 'tuntas' ? GOOD : id === 'pengayaan' ? [222, 235, 255] : null;
}

function drawHistogram(w: Writer, histogram: number[]) {
    const pdf = w.pdf, height = 38, chartX = L + 8, chartW = W - 10;
    w.ensure(height + 12);
    const step = Math.max(1, Math.ceil(Math.max(1, ...histogram) / 4));
    const top = w.y, base = top + height, max = step * 4, barW = chartW / histogram.length;
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.15);
    for (let tick = 0; tick <= 4; tick++) {
        const value = step * tick, ty = base - height * (value / max);
        pdf.line(chartX, ty, chartX + chartW, ty);
        w.font(6, 'normal', MUTED); pdf.text(String(value), chartX - 1.5, ty + 1, { align: 'right' });
    }
    histogram.forEach((count, index) => {
        const barH = height * count / max, x = chartX + index * barW + 1.2;
        const midpoint = index * 10 + 5;
        const band = MASTERY_BANDS.find(item => midpoint <= item.max) ?? MASTERY_BANDS[3];
        pdf.setFillColor(...BAND_COLOR[band.id]);
        if (barH > 0) pdf.rect(x, base - barH, barW - 2.4, barH, 'F');
        w.font(6.5, 'bold'); if (count) pdf.text(String(count), x + (barW - 2.4) / 2, base - barH - 1, { align: 'center' });
        w.font(6, 'normal', MUTED); pdf.text(index === 9 ? '90-100' : `${index * 10}-${index * 10 + 9}`, x + (barW - 2.4) / 2, base + 3.5, { align: 'center' });
    });
    w.y = base + 7;
}

function drawBar(w: Writer, x: number, y: number, width: number, value: number | null, bandId?: string | null) {
    w.pdf.setFillColor(...NONE); w.pdf.rect(x, y, width, 2.6, 'F');
    if (value != null) { w.pdf.setFillColor(...(BAND_COLOR[bandId || ''] || BLUE)); w.pdf.rect(x, y, width * Math.max(0, Math.min(100, value)) / 100, 2.6, 'F'); }
}

function topicTable(w: Writer, topics: Array<{ name: string; percent: number | null; band: { id: string; label: string } | null; extra?: string }>, extraLabel?: string) {
    const barWidth = 50;
    const columns: Column[] = [{ label: 'Materi / indikator', width: W - 24 - 28 - barWidth - (extraLabel ? 16 : 0) }, ...(extraLabel ? [{ label: extraLabel, width: 16, align: 'center' as const }] : []),
        { label: 'Capaian', width: 24, align: 'right' }, { label: 'Kategori', width: 28 }, { label: 'Grafik', width: barWidth }];
    w.table(columns, topics.map(topic => [topic.name, ...(extraLabel ? [topic.extra || '-'] : []), topic.percent == null ? '-' : `${num(topic.percent, 1)}%`, topic.band?.label || '-', '']),
        { fills: topics.map(topic => columns.map(column => column.label === 'Kategori' ? bandFill(topic.band?.id) : null)),
            onRow: (index, y, height) => drawBar(w, R - barWidth + 2, y + height / 2 - 1.3, barWidth - 4, topics[index].percent, topics[index].band?.id) });
}

function generalSection(w: Writer, report: AssessmentReport, meta: { title: string; info: Array<[string, string]> }) {
    const { pdf } = w;
    const d = report.descriptives;
    w.font(15, 'bold'); pdf.text('LAPORAN ANALISIS HASIL ASESMEN', (L + R) / 2, w.y + 2, { align: 'center' });
    w.y += 7;
    w.font(10, 'normal'); w.lines(meta.title, W).forEach(line => { pdf.text(line, (L + R) / 2, w.y + 1, { align: 'center' }); w.y += 4.6; });
    w.y += 2;
    meta.info.forEach(([label, value], index) => {
        const col = index % 2, x = L + col * (W / 2);
        w.font(7.8, 'bold', MUTED); pdf.text(pdfSafe(label), x, w.y);
        w.font(7.8, 'normal'); pdf.text(w.lines(value, W / 2 - 30)[0] || '-', x + 28, w.y);
        if (col === 1 || index === meta.info.length - 1) w.y += 4.3;
    });
    w.y += 2;
    if (report.warnings.length) {
        const lines = report.warnings.flatMap(text => w.lines(`! ${text}`, W - 6));
        const height = lines.length * w.lineHeight(7.8) + 4;
        w.ensure(height);
        pdf.setFillColor(...WARN); pdf.roundedRect(L, w.y, W, height, 1.2, 1.2, 'F');
        w.font(7.8, 'normal', [146, 86, 18]); pdf.text(lines, L + 3, w.y + 2 + w.lineHeight(7.8) * 0.72, { lineHeightFactor: 1.3 });
        w.y += height + 3;
    }

    w.running = `${meta.title} - Analisis kelas`;
    w.section('I.', 'Ringkasan Kelas', 'Nilai memakai nilai klasik (0-100) yang tercatat. Statistik dihitung dari peserta yang sudah mengumpulkan.');
    w.cards([
        ['Peserta', `${report.analyzed} / ${report.registered}`, `${report.completed} mengumpulkan`],
        ['Rata-rata', num(d?.mean), `SB ${num(d?.sd)}`],
        ['Median', num(d?.median), `Q1 ${num(d?.q1, 1)} - Q3 ${num(d?.q3, 1)}`],
        ['Rentang', d ? `${num(d.min, 0)} - ${num(d.max, 0)}` : '-', `${report.itemCount} butir dianalisis`],
        [report.reliability.method, num(report.reliability.value), report.reliability.label],
    ]);
    w.sub('Distribusi nilai');
    drawHistogram(w, report.histogram);
    const total = Math.max(1, Object.values(report.bandCounts).reduce((a, b) => a + b, 0));
    w.table([{ label: 'Kategori capaian (interval KKTP)', width: 62 }, { label: 'Rentang nilai', width: 30, align: 'center' }, { label: 'Peserta', width: 20, align: 'right' },
        { label: '%', width: 18, align: 'right' }, { label: 'Tindak lanjut', width: 50 }],
    MASTERY_BANDS.map(band => [band.label, band.id === 'bimbingan' ? '0 - 40' : band.id === 'remedial' ? '41 - 65' : band.id === 'tuntas' ? '66 - 85' : '86 - 100',
        String(report.bandCounts[band.id]), `${num(report.bandCounts[band.id] / total * 100, 1)}%`, band.advice]),
    { fills: MASTERY_BANDS.map(band => [bandFill(band.id), null, null, null, null]) });

    w.sub('Reliabilitas dan kesalahan pengukuran');
    const rel = report.reliability;
    w.paragraph(rel.value == null
        ? 'Reliabilitas belum dapat dihitung (butir atau peserta yang sudah dinilai lengkap terlalu sedikit, atau semua nilai sama).'
        : `Koefisien ${rel.method} = ${num(rel.value, 3)} (${rel.label.toLowerCase()}), dihitung dari ${rel.n} peserta dan ${rel.k} butir. `
          + `Kesalahan baku pengukuran (SEM) = ${num(rel.sem, 1)} poin nilai: nilai seorang siswa sebaiknya dibaca sebagai rentang +/- ${num(rel.sem, 1)} `
          + `(peluang sekitar 68%), bukan angka pasti. ${rel.value < 0.7 ? 'Untuk keputusan penting (mis. remedial), padukan dengan bukti lain karena reliabilitas di bawah 0,70.' : 'Reliabilitas memadai untuk keputusan di kelas.'}`);
    w.y += 2;

    if (report.irt) {
        const irt = report.irt;
        w.ensure(75);
        w.sub(`Teori respons butir (${irt.label})`);
        w.cards([
            ['Rata-rata theta', num(irt.meanTheta), `skala ${irt.meanTheta == null ? '-' : num(500 + 100 * irt.meanTheta, 0)}`],
            ['SB theta', num(irt.sdTheta), 'sebaran kemampuan'],
            ['Galat baku rata-rata', num(irt.meanSe), irt.hasCalibration ? 'makin kecil makin teliti' : 'perlu Kalkulasi IRT'],
            ['Paling teliti di', irt.peak == null ? '-' : `theta ${num(irt.peak, 1)}`, 'puncak informasi tes'],
        ], 16, 4);
        if (irt.curve.length) drawInformation(w, irt.curve);
        w.paragraph('Nilai IRT dilaporkan pada skala lokal 500 + 100 x theta (200-800); 500 = titik acuan theta 0, bukan rata-rata nasional. '
            + 'Kurva informasi menunjukkan rentang kemampuan yang diukur paling teliti oleh tes ini; di luar puncaknya galat baku siswa membesar.', 7.8, MUTED);
        w.y += 2;
    }

    w.section('II.', 'Penguasaan Materi', 'Persentase skor kelas per materi (kisi-kisi). Materi di bawah 66% menjadi prioritas pembelajaran ulang.');
    if (report.topics.length) topicTable(w, report.topics.map(topic => ({ ...topic, extra: String(topic.questionCount) })), 'Butir');
    const weak = report.topics.filter(topic => topic.name !== 'Tanpa materi' && topic.percent != null && topic.percent <= 65);
    if (weak.length) w.bullets([`Prioritas pembelajaran ulang: ${weak.sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0)).map(topic => `${topic.name} (${num(topic.percent, 0)}%)`).join(', ')}.`]);
    if (report.topics.every(topic => topic.name === 'Tanpa materi')) w.paragraph('Soal belum dipetakan ke materi/kisi-kisi; isi materi pada bank soal agar analisis per materi tersedia.', 8, MUTED);

    itemSection(w, report);
    recapSection(w, report);
}

function drawInformation(w: Writer, curve: Array<{ theta: number; info: number }>) {
    const pdf = w.pdf, height = 30, x0 = L + 10, width = W - 14;
    w.ensure(height + 10);
    const top = w.y, base = top + height, max = Math.max(...curve.map(point => point.info), 1e-6);
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.15);
    pdf.line(x0, base, x0 + width, base); pdf.line(x0, top, x0, base);
    w.font(6, 'normal', MUTED);
    pdf.text(num(max, 1), x0 - 1.5, top + 1.5, { align: 'right' }); pdf.text('0', x0 - 1.5, base, { align: 'right' });
    pdf.text('Informasi', x0 - 1.5, top + height / 2, { align: 'right' });
    for (let theta = -4; theta <= 4; theta += 1) pdf.text(String(theta), x0 + (theta + 4) / 8 * width, base + 3.5, { align: 'center' });
    pdf.text('theta', x0 + width, base + 6.5, { align: 'right' });
    pdf.setDrawColor(...BLUE); pdf.setLineWidth(0.6);
    curve.slice(1).forEach((point, index) => {
        const prev = curve[index];
        pdf.line(x0 + (prev.theta + 4) / 8 * width, base - prev.info / max * height, x0 + (point.theta + 4) / 8 * width, base - point.info / max * height);
    });
    w.y = base + 8;
}

function itemSection(w: Writer, report: AssessmentReport) {
    const irt = report.irt?.hasCalibration ? report.irt : null;
    const showA = irt && irt.model !== 'irt_1pl', showC = irt?.model === 'irt_3pl';
    w.section('III.', 'Analisis Butir Soal',
        'Prioritas ditentukan dari kesukaran, korelasi butir-total (r_it), dan daya beda kelompok atas-bawah (D).');
    const columns: Column[] = [
        { label: 'No', width: 9, align: 'center' }, { label: 'Materi', width: 68 }, { label: 'p', width: 13, align: 'right' },
        { label: 'Kesukaran', width: 24 }, { label: 'r_it', width: 13, align: 'right' }, { label: 'D', width: 13, align: 'right' },
        { label: 'Keputusan', width: 40 },
    ];
    const alpha = report.reliability.value;
    w.table(columns, report.items.map(item => [
        String(item.number), item.topic, num(item.p), item.difficulty || '-', num(item.ritc), num(item.d), item.decision,
    ]), { size: 8, pad: 1.8, fills: report.items.map(item => columns.map(column =>
        column.label === 'Keputusan' ? (item.decision === 'Baik' ? GOOD : item.decision === 'Revisi' ? WARN : BAD)
            : column.label === 'r_it' && item.ritc != null && item.ritc < 0.2 ? (item.ritc < 0 ? BAD : WARN) : null)) });
    const counts = (['Baik', 'Revisi', 'Tinjau ulang'] as const).map(decision => `${decision}: ${report.items.filter(item => item.decision === decision).length}`);
    w.paragraph(`Ringkasan keputusan butir - ${counts.join(' | ')}.`, 8, INK, 0, 'bold');

    const flagged = report.items.filter(item => item.flags.length);
    if (flagged.length) {
        w.sub('Prioritas tindak lanjut');
        const grouped = new Map<string, { label: string; advice: string; numbers: number[] }>();
        for (const item of flagged) for (const flag of item.flags) {
            const key = `${flag.label}\u0000${flag.advice}`;
            const group = grouped.get(key) ?? { label: flag.label, advice: flag.advice, numbers: [] };
            group.numbers.push(item.number);
            grouped.set(key, group);
        }
        const actions = [...grouped.values()].sort((a, b) => b.numbers.length - a.numbers.length);
        w.table([{ label: 'Temuan', width: 48 }, { label: 'No. soal', width: 34 }, { label: 'Langkah perbaikan', width: 98 }],
            actions.map(group => [group.label, group.numbers.join(', '), group.advice]), { size: 8, pad: 2 });
    }

    w.sub('Parameter pendukung per butir');
    w.paragraph('Alpha hapus menunjukkan reliabilitas jika butir dikeluarkan. Nilai yang lebih tinggi dari reliabilitas tes diberi warna kuning.', 7.8, MUTED);
    const fixed = 9 + 30 + 25 + 16 + (irt ? 14 : 0) + (showA ? 14 : 0) + (showC ? 14 : 0);
    const technical: Column[] = [
        { label: 'No', width: 9, align: 'center' }, { label: 'Materi', width: W - fixed },
        { label: 'Daya beda', width: 30 }, { label: 'Alpha hapus', width: 25, align: 'right' },
        ...(irt ? [{ label: 'b', width: 14, align: 'right' as const }] : []),
        ...(showA ? [{ label: 'a', width: 14, align: 'right' as const }] : []),
        ...(showC ? [{ label: 'c', width: 14, align: 'right' as const }] : []),
        { label: 'Kosong', width: 16, align: 'right' },
    ];
    w.table(technical, report.items.map(item => [String(item.number), item.topic, item.discrimination,
        num(item.alphaIfDeleted, 3), ...(irt ? [num(item.irt?.b)] : []), ...(showA ? [num(item.irt?.a)] : []),
        ...(showC ? [num(item.irt?.c)] : []), String(item.omitted)]),
    { size: 8, pad: 1.8, fills: report.items.map(item => technical.map(column =>
        column.label === 'Alpha hapus' && alpha != null && item.alphaIfDeleted != null && item.alphaIfDeleted > alpha ? WARN : null)) });

    const mcq = report.items.filter(item => item.distractors.length);
    if (mcq.length) {
        const letters = Math.min(6, Math.max(...mcq.map(item => item.distractors.length)));
        w.sub('Analisis pengecoh (pilihan ganda)');
        w.paragraph('Tiap sel: % seluruh peserta (kelompok atas / bawah). Hijau = kunci; kuning = dipilih < 5%; '
            + 'merah = lebih banyak dipilih kelompok atas. Temuan dan saran ada pada Prioritas tindak lanjut.', 7.8, MUTED);
        w.y += 1;
        const optionWidth = (W - 9) / letters;
        const columns: Column[] = [{ label: 'No', width: 9, align: 'center' },
            ...Array.from({ length: letters }, (_, index) => ({ label: String.fromCharCode(65 + index), width: optionWidth, align: 'center' as const }))];
        w.table(columns, mcq.map(item => [String(item.number),
            ...Array.from({ length: letters }, (_, index) => {
                const option = item.distractors[index];
                return option ? `${pct(option.share)} (${pct(option.upperShare)} / ${pct(option.lowerShare)})` : '';
            }),
        ]), { size: 7.4, pad: 1.7, fills: mcq.map(item => [null, ...Array.from({ length: letters }, (_, index) => {
            const option = item.distractors[index];
            return !option ? null : option.isKey ? GOOD : option.flag === 'Menarik kelompok atas' ? BAD : option.flag ? WARN : null;
        })]) });
    }
}

function recapSection(w: Writer, report: AssessmentReport) {
    const irt = report.irt;
    w.section('IV.', 'Rekap Peserta', 'Urut kelas lalu nama. B/S/K = benar, salah, kosong. Rincian ada pada halaman masing-masing peserta.');
    const columns: Column[] = [
        { label: 'No', width: 9, align: 'center' }, { label: 'Peserta / kelas', width: W - 9 - 16 - 31 - 26 - (irt ? 31 : 0) },
        { label: 'Nilai', width: 16, align: 'right' }, { label: 'Kategori', width: 31 }, { label: 'B/S/K', width: 26, align: 'center' },
        ...(irt ? [{ label: 'theta', width: 14, align: 'right' as const }, { label: 'Skala IRT', width: 17, align: 'right' as const }] : []),
    ];
    w.table(columns, report.students.map((student, index) => [String(index + 1), `${student.name}\n${student.className}`, student.score == null ? '-' : num(student.score, 1), student.band?.label || 'Menunggu penilaian',
        `${student.correct} / ${student.wrong} / ${student.unanswered}${student.ungraded ? ` (+${student.ungraded} belum dinilai)` : ''}`,
        ...(irt ? [num(student.theta), student.scaled == null ? '-' : num(student.scaled, 0)] : [])]),
    { size: 8, pad: 1.8, fills: report.students.map(student => columns.map(column => column.label === 'Kategori' ? bandFill(student.band?.id) : null)) });
}

function studentSection(w: Writer, report: AssessmentReport, student: StudentReport, title: string, index: number) {
    const { pdf } = w;
    w.running = `${title} - Laporan peserta`;
    w.newPage();
    pdf.setFillColor(...BLUE); pdf.rect(L, w.y - 1, W, 15, 'F');
    w.font(7, 'bold', [207, 224, 245]); pdf.text(`V. LAPORAN PESERTA ${index + 1} DARI ${report.students.length}`, L + 4, w.y + 3.2);
    w.font(12.5, 'bold', [255, 255, 255]); pdf.text(w.lines(student.name, W - 60)[0] || '-', L + 4, w.y + 9.5);
    w.font(8, 'normal', [230, 238, 248]);
    pdf.text(pdfSafe(`NIS ${student.nis}`), R - 4, w.y + 4, { align: 'right' });
    pdf.text(pdfSafe(`Kelas ${student.className}`), R - 4, w.y + 9.5, { align: 'right' });
    w.y += 18;

    const mean = report.descriptives?.mean;
    const diff = student.score != null && mean != null ? student.score - mean : null;
    const sem = student.sem;
    w.cards([
        ['Nilai', student.score == null ? 'Menunggu' : num(student.score, 1), student.score == null ? 'penilaian guru belum selesai' : sem != null && student.score != null ? `kisaran ${num(Math.max(0, student.score - sem), 0)} - ${num(Math.min(100, student.score + sem), 0)}` : 'nilai klasik 0-100'],
        ['Kategori', student.band?.label || 'Menunggu', student.band ? `tindak lanjut: ${BAND_SHORT[student.band.id]}` : ''],
        student.theta != null ? ['Skala IRT', num(student.scaled, 0), student.thetaSe != null
            ? `theta ${num(student.theta)} +/- ${num(student.thetaSe)}` : `theta ${num(student.theta)}`]
            : ['Rata-rata kelas', num(mean, 1), diff == null ? '' : `${diff >= 0 ? '+' : ''}${num(diff, 1)} dari rata-rata`],
    ], 15);
    const context = [
        ...(student.theta != null ? [`Rata-rata kelas ${num(mean, 1)}${diff == null ? '' : ` (${diff >= 0 ? '+' : ''}${num(diff, 1)})`}`] : []),
        `Jawaban: ${student.correct} benar / ${student.wrong} salah / ${student.unanswered} kosong`,
        ...(student.ungraded ? [`${student.ungraded} belum dinilai`] : student.partial ? [`${student.partial} skor sebagian`] : []),
    ];
    w.paragraph(context.join('  |  '), 8, MUTED);

    const named = student.topics.filter(topic => topic.max > 0);
    if (named.length) {
        w.sub('Penguasaan per materi');
        const classPercent = new Map(report.topics.map(topic => [topic.name, topic.percent]));
        topicTable(w, named.map(topic => ({ ...topic, extra: classPercent.get(topic.name) == null ? '-' : `${num(classPercent.get(topic.name) as number, 0)}%` })), 'Kelas');
    }

    w.sub('Umpan balik');
    const strengths = student.strengths.length ? student.strengths.map(topic => `${topic.name} (${num(topic.percent, 0)}%)`).join(', ') : 'Belum ada materi di atas batas tuntas.';
    const needs = student.needs.length ? student.needs.map(topic => `${topic.name} (${num(topic.percent, 0)}%)`).join(', ') : 'Tidak ada materi di bawah batas tuntas.';
    w.paragraph('Sudah dikuasai', 8, [22, 101, 52], 0, 'bold'); w.paragraph(strengths, 8.2, INK, 4); w.y += 1;
    w.paragraph('Perlu diperbaiki', 8, [155, 28, 28], 0, 'bold'); w.paragraph(needs, 8.2, INK, 4); w.y += 1;
    w.paragraph('Langkah berikutnya', 8, BLUE, 0, 'bold');
    w.bullets(student.recommendations, 8.2);
    w.sub('Peta jawaban per butir');
    const perRow = 12, box = W / perRow, boxHeight = 8.7;
    const rows = Math.ceil(student.items.length / perRow);
    w.ensure(rows * (boxHeight + 1.2) + 8);
    student.items.forEach((item, index) => {
        const x = L + (index % perRow) * box, y = w.y + Math.floor(index / perRow) * (boxHeight + 1.2);
        const color: RGB = item.status === 'correct' && (item.credit ?? 0) >= 1 ? [187, 230, 203]
            : item.status === 'ungraded' ? NONE : item.status === 'unanswered' ? [226, 232, 240]
            : (item.credit ?? 0) > 0 ? WARN : [250, 200, 200];
        pdf.setFillColor(...color); pdf.roundedRect(x + 0.5, y, box - 1, boxHeight, 0.8, 0.8, 'F');
        w.font(7, 'bold'); pdf.text(String(item.number), x + box / 2, y + 3.3, { align: 'center' });
        w.font(6.3, 'normal', MUTED);
        pdf.text(item.status === 'correct' && (item.credit ?? 0) >= 1 ? 'B' : item.status === 'ungraded' ? '?' : item.status === 'unanswered' ? 'K' : (item.credit ?? 0) > 0 ? '1/2' : 'S',
            x + box / 2, y + 6.8, { align: 'center' });
    });
    w.y += rows * (boxHeight + 1.2) + 0.5;
    w.font(6.5, 'normal', MUTED);
    pdf.text('B = benar   S = salah   1/2 = skor sebagian   K = kosong   ? = menunggu penilaian', L, w.y + 2.2);
    w.y += 4;

    // Jawaban yang menunggu penilaian bukan kesalahan: cukup ditandai "?" pada peta.
    const wrong = student.items.filter(item => item.status !== 'ungraded' && (item.status !== 'correct' || (item.credit ?? 1) < 1));
    if (wrong.length) {
        w.sub('Butir yang belum tepat');
        w.table([{ label: 'No', width: 9, align: 'center' }, { label: 'Materi', width: 45 }, { label: 'Jawaban siswa', width: 50 }, { label: 'Kunci', width: 50 },
            { label: 'Benar di kelas', width: W - 154, align: 'right' }],
        wrong.map(item => [String(item.number), item.topic, item.status === 'unanswered' ? '(kosong)' : item.answer,
            item.key, pct(item.p)]),
        { size: 6.7, pad: 1, minContinuationRows: 4, fills: wrong.map(item => item.p != null && item.p >= 0.75 ? [WARN, null, null, null, WARN] : null) });
    }

}

function appendix(w: Writer) {
    w.section('', 'Cara Membaca Laporan');
    w.bullets([
        'p = proporsi skor benar. Makin kecil p, makin sulit soal.',
        'r_it = hubungan skor butir dengan total tanpa butir tersebut. Nilai < 0,20 perlu ditinjau; nilai negatif perlu pemeriksaan kunci.',
        'D = selisih proporsi benar kelompok atas dan bawah (27%). Nilai >= 0,40 sangat baik; < 0,20 perlu ditinjau.',
        'KR-20 / Cronbach alpha menunjukkan reliabilitas; >= 0,70 memadai untuk tes kelas. SEM menunjukkan kisaran ketidakpastian nilai.',
        'Pengecoh berfungsi bila dipilih >= 5% peserta dan lebih menarik kelompok bawah. Kategori capaian mengikuti interval KKTP.',
        'IRT: theta = taksiran kemampuan; skala laporan = 500 + 100 x theta. Jawaban belum dinilai tidak dianggap salah.',
    ], 8);
    w.y += 1;
    w.paragraph('Rujukan: AERA, APA, & NCME (2014); Ebel & Frisbie (1991); Haladyna & Downing (1993); '
        + 'Hambleton dkk. (1991); Kemendikbudristek (2022/2024).', 7.5, MUTED);
}

function withDisplayText(options: AnalysisPdfOptions) {
    const detailed = options.detailedAnalysis;
    const keyDisplay: Record<string, string> = {};
    const display = new Map<string, DisplayQuestion>(options.questions.map(question => [question.id, {
        type: question.type, question_text: question.question_text, metadata: question.metadata,
        options: (question.options || question.bank_question_options || []).map(option => ({ ...option, id: option.id || '' })),
    } as DisplayQuestion]));
    for (const item of detailed?.items ?? []) keyDisplay[item.id] = item.key_display || '-';
    for (const [id, question] of display) {
        const key = formatAnswerKey(question).join('; ');
        if (key) keyDisplay[id] = key;
        else if (!keyDisplay[id]) keyDisplay[id] = ['essay', 'esay', 'uraian'].includes(question.type) ? 'Rubrik / koreksi manual' : '-';
    }
    const raw = new Map(options.answers.map(answer => [`${answer.attempt_id}:${answer.question_id}`, answer]));
    const matrix = (detailed?.matrix ?? []).map(row => ({ ...row, items: Object.fromEntries(Object.entries(row.items).map(([questionId, cell]) => {
        const question = display.get(questionId), answer = raw.get(`${row.attempt_id}:${questionId}`);
        return [questionId, question && answer ? { ...cell, display_answer: formatStudentAnswer(question, answer.selected_option_id, answer.essay_answer).join('; ') || '-' } : cell];
    })) }));
    return { keyDisplay, matrix };
}

export async function buildAnalysisPdf(options: AnalysisPdfOptions) {
    if (!options.detailedAnalysis?.matrix?.length) throw new Error('Belum ada peserta yang dapat dianalisis.');
    const { keyDisplay, matrix } = withDisplayText(options);
    const report = buildAssessmentReport({
        questions: options.questions.map((question, index) => ({ ...question, number: question.number ?? index + 1,
            options: question.options || question.bank_question_options || [] })),
        matrix, attempts: options.attempts as never, answers: options.answers, keyDisplay,
        irt: options.irt ?? null, scoringType: options.exam?.scoring_type,
    });
    if (!report.analyzed) throw new Error('Belum ada peserta yang mengumpulkan jawaban.');

    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const title = options.exam?.title || 'Ujian';
    pdf.setProperties({ title: `Laporan Analisis - ${title}`, subject: 'Analisis hasil asesmen kelas dan peserta', creator: 'ACCA CBT' });
    const zone = options.timeZone || 'Asia/Jakarta';
    const dateText = (value?: string | null, time = false) => value && Number.isFinite(Date.parse(value))
        ? new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'long', ...(time ? { timeStyle: 'short' } : {}) }).format(new Date(value)) : '-';
    const classes = [...new Set(options.attempts.flatMap(attempt => String(attempt.kelas_name || '').split(',').map(name => name.trim()).filter(name => name && name !== '-')))]
        .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
    const scoring = String(options.exam?.scoring_type || 'classical').split(',').map(type => type.trim())
        .map(type => type === 'classical' ? 'Klasik' : type.replace('irt_', 'IRT ').toUpperCase()).join(', ');

    const w = new Writer(pdf, title);
    if (options.profile) {
        const kop = formatKopParts(options.profile);
        const logo = await loadKopLogo(kop.logoUrl).catch(() => null);
        w.y = drawPdfKop(pdf, kop, logo, { left: L, right: R, top: 10 }) + 7;
    }
    generalSection(w, report, {
        title,
        info: [
            ['Mata pelajaran', options.exam?.subject || '-'], ['Kelas', classes.join(', ') || '-'],
            ['Tanggal ujian', dateText(options.exam?.start_time)], ['Model penilaian', scoring],
            ['Jumlah butir', `${report.itemCount} butir dianalisis`], ['Dibuat', `${dateText(new Date().toISOString(), true)} ${getSchoolTimeZoneLabel(zone)}`],
        ],
    });
    appendix(w);
    for (const [index, student] of report.students.entries()) studentSection(w, report, student, title, index);

    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        pdf.setPage(page);
        pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(L, 285, R, 285);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...MUTED);
        pdf.text(pdf.splitTextToSize(pdfSafe(`ACCA CBT  /  Laporan Analisis Hasil  /  ${title}`), W - 36)[0], L, 289.5);
        pdf.text(`Halaman ${page} dari ${pages}`, R, 289.5, { align: 'right' });
    }
    return { pdf, report };
}

export async function exportAnalysisToPdf(options: AnalysisPdfOptions) {
    const { pdf } = await buildAnalysisPdf(options);
    pdf.save(analysisPdfFileName(options.exam?.title || 'Ujian'));
}
