import {
AlignmentType,
BorderStyle,
Document,
Footer,
Header,
ImageRun,
Packer,Paragraph,Table,
TableCell,TableLayoutType,
TableRow,
TextRun,
VerticalAlign,
WidthType
} from 'docx';
import JSZip from 'jszip';
import { optionLabel } from './option-label';
import { attachQuestionArchive } from './question-archive';
import { portableQuestion } from './question-transfer';
import { loadWordImages,wordRuns,type WordImages } from './word-images';
// ─── Constants ────────────────────────────────────────────────────────────────

export const PERSONALITY_TYPES = ['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'] as const;
export type QuestionTypeAny =
    | 'mcq' | 'mcq_complex' | 'true_false' | 'matching' | 'categorization'
    | 'short_answer' | 'essay' | 'sjt' | 'ordering'
    | 'likert' | 'forced_choice' | 'checklist' | 'ranking' | 'paired_comparison';

export type Variant = 'akademik' | 'kepribadian';

interface ExportOptionMetadata {
    match_texts?: string[];
    category_names?: string[];
    dimension_id?: string | null;
}

interface ExportOption {
    id?: string;
    option_text?: string;
    text?: string;
    is_correct?: boolean;
    isCorrect?: boolean;
    order?: number;
    weight?: number;
    dimension_id?: string | null;
    metadata?: ExportOptionMetadata;
}

interface ExportQuestionMetadata {
    blanks?: { answer?: string; variations?: string[] }[];
    correct_order?: string[];
    import_stimulus?: string;
    import_instruction?: string;
    [key: string]: unknown;
}

interface ExportQuestion {
    id?: string;
    type: QuestionTypeAny;
    question_text?: string;
    score_default?: number;
    scoreDefault?: number;
    stimulus_id?: string | null;
    instruction_id?: string | null;
    kisi_kisi_id?: string | null;
    bank_question_options?: ExportOption[];
    options?: ExportOption[];
    metadata?: ExportQuestionMetadata;
    question_dimensions?: { name?: string } | null;
    stimulus?: ExportContentItem | null;
    instruction?: ExportContentItem | null;
}

interface ExportContentItem {
    id: string;
    title?: string | null;
    content?: string | null;
}

interface ExportKisiKisiItem extends ExportContentItem {
    nomor_kd?: string | null;
    kd_cp?: string | null;
    materi?: string | null;
    indikator_soal?: string | null;
    level_kognitif?: string | null;
}

interface ExportDimension {
    id: string;
    name?: string | null;
}

interface ExportBankInfo {
    title?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
    mcq: 'PG',
    mcq_complex: 'PGK',
    true_false: 'BS',
    matching: 'MJ',
    categorization: 'CAT',
    short_answer: 'ISIAN',
    essay: 'ESAI',
    sjt: 'SJT',
    ordering: 'URUT',
    likert: 'LIKERT',
    forced_choice: 'FC',
    checklist: 'CL',
    ranking: 'RANK',
    paired_comparison: 'PC',
};

// Theme colors (extracted from the user's templates)
const THEME = {
    akademik: {
        header: '1E3A8A',
        bandWhite: 'FFFFFF',
        bandGray: 'EFF6FF',
        border: 'BBBBBB',
        title: 'EXPORT SOAL (PENGETAHUAN)',
    },
    kepribadian: {
        header: '4338CA',          // indigo (matches template)
        bandWhite: 'FFFFFF',
        bandGray: 'F1F0FB',
        border: 'BBBBBB',
        title: 'EXPORT SOAL (KEPRIBADIAN)',
    },
} as const;

const TYPE_MAP_QUESTION_KIND: Record<string, 'akademik' | 'kepribadian'> = {
    mcq: 'akademik', mcq_complex: 'akademik', true_false: 'akademik',
    matching: 'akademik', categorization: 'akademik', short_answer: 'akademik',
    essay: 'akademik', ordering: 'akademik',
    sjt: 'kepribadian', likert: 'kepribadian', forced_choice: 'kepribadian',
    checklist: 'kepribadian', ranking: 'kepribadian', paired_comparison: 'kepribadian',
};

const LOGO_URL = '/logo-icon.png';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeText(val: unknown): string {
    if (val == null) return '';
    let text = String(val);
    
    // Add spaces for block tags to prevent merging words
    text = text.replace(/<\/p>|<br\s*\/?>|<\/div>|<\/li>/gi, ' ');

    // Strip HTML tags and normalize common entities
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;/gi, "'");

    // Replace newlines/tabs with space to PREVENT Word XML "unreadable content" error
    text = text.replace(/[\r\n\t]+/g, ' ');

    // Remove control characters
    text = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

    return text.replace(/\s+/g, ' ').trim();
}

function border(color = 'BBBBBB') {
    const side = { style: BorderStyle.SINGLE, size: 4, color };
    return { top: side, bottom: side, left: side, right: side };
}

function borderNone() {
    const side = { style: BorderStyle.NONE, size: 0, color: 'auto' };
    return { top: side, bottom: side, left: side, right: side, insideHorizontal: side, insideVertical: side };
}

function headerCell(text: string, widthPct: number, color: string) {
    return new TableCell({
        children: [new Paragraph({
            children: [new TextRun({ text: sanitizeText(text), bold: true, size: 20, color: 'FFFFFF', font: 'Calibri' })],
            alignment: AlignmentType.CENTER,
        })],
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        shading: { fill: color, type: 'clear', color: 'auto' },
        borders: border(),
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
    });
}

function dataCell(text: unknown, widthPct: number, fill: string, align: 'LEFT' | 'CENTER' = 'LEFT', images: WordImages = new Map()) {
    return new TableCell({
        children: [new Paragraph({
            children: wordRuns(text, images, sanitizeText),
            alignment: align === 'CENTER' ? AlignmentType.CENTER : AlignmentType.LEFT,
        })],
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        shading: { fill, type: 'clear', color: 'auto' },
        borders: border(),
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
    });
}

const imageCells = (images: WordImages) => (text: unknown, width: number, fill: string, align: 'LEFT' | 'CENTER' = 'LEFT') => dataCell(text, width, fill, align, images);

const hRow = (cells: TableCell[]) => new TableRow({ tableHeader: true, children: cells, cantSplit: true });
const dRow = (cells: TableCell[]) => new TableRow({ children: cells, cantSplit: false });

// ─── Question-row builders (per type) ─────────────────────────────────────────

type RowSpec = TableCell[];             // one row = array of cells
type RowsForOneQuestion = RowSpec[]; // one question produces N rows

function buildAkademikRows(question: ExportQuestion, idx: number, images: WordImages = new Map()): RowsForOneQuestion {
    const dataCell = imageCells(images);
    const opts = [...(question.bank_question_options || question.options || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const typeLabel = TYPE_LABEL[question.type] || 'PG';
    const qNo = String(idx + 1);
    const score = String(question.score_default ?? question.scoreDefault ?? 1);
    const fill = (row: number) => (row % 2 === 0 ? 'FFFFFF' : 'EFF6FF');

    const out: RowsForOneQuestion = [];
    let row = 0;

    if (question.type === 'mcq' || question.type === 'mcq_complex') {
        const correctOpts = opts.filter((o) => o.is_correct || o.isCorrect);
        const correctIdx = correctOpts.map((o) => opts.indexOf(o));
        const kunci = correctIdx.map((i: number) => optionLabel(i)).join(',') || '';
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell(kunci, 13, fill(row - 1), 'CENTER'),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt, oi) => {
            const letter = optionLabel(oi);
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell(letter, 8, fill(row), 'CENTER'),
                dataCell(opt.option_text || opt.text || '', 64, fill(row)),
                dataCell('', 13, fill(row)),
                dataCell('', 10, fill(row)),
            ]);
            row++;
        });
    } else if (question.type === 'true_false') {
        const kunciArr = opts.map((o) => (o.is_correct || o.isCorrect) ? 'B' : 'S');
        const kunci = kunciArr.join('|');
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell(kunci, 13, fill(row - 1), 'CENTER'),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt, oi) => {
            const key = (opt.is_correct || opt.isCorrect) ? 'B' : 'S';
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell(`P${oi + 1}`, 8, fill(row), 'CENTER'),
                dataCell(opt.option_text || opt.text || '', 64, fill(row)),
                dataCell(key, 13, fill(row), 'CENTER'),
                dataCell('', 10, fill(row)),
            ]);
            row++;
        });
    } else if (question.type === 'matching') {
        const kunciArr = opts.map((o) => (o.metadata?.match_texts || []).join(' | '));
        const kunci = kunciArr.join(' | ');
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell(kunci, 13, fill(row - 1)),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt, oi) => {
            const match = (opt.metadata?.match_texts || []).join(' | ');
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell(`MJ${oi + 1}`, 8, fill(row), 'CENTER'),
                dataCell(opt.option_text || opt.text || '', 64, fill(row)),
                dataCell(match, 13, fill(row)),
                dataCell('', 10, fill(row)),
            ]);
            row++;
        });
    } else if (question.type === 'categorization') {
        const kunciArr = opts.map((o) => (o.metadata?.category_names || []).join(', '));
        const kunci = kunciArr.join(' | ');
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell(kunci, 13, fill(row - 1)),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt, oi) => {
            const cat = (opt.metadata?.category_names || []).join(', ');
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell(`CAT${oi + 1}`, 8, fill(row), 'CENTER'),
                dataCell(opt.option_text || opt.text || '', 64, fill(row)),
                dataCell(cat, 13, fill(row)),
                dataCell('', 10, fill(row)),
            ]);
            row++;
        });
    } else if (question.type === 'short_answer') {
        const blanks = question.metadata?.blanks || [];
        const kunci = blanks.map((b) => {
            let ans = b.answer || '';
            if (b.variations && b.variations.length > 0) {
                ans += ', ' + b.variations.join(', ');
            }
            return ans;
        }).join(' | ');
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell(kunci, 13, fill(row - 1)),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
    } else if (question.type === 'essay') {
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell('', 13, fill(row - 1)),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
    } else if (question.type === 'ordering') {
        const correctOrder: string[] = portableQuestion(question).metadata.correct_order;
        const kunci = correctOrder.join(' | ');
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 8, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 64, fill(row - 1)),
            dataCell(kunci, 13, fill(row - 1), 'CENTER'),
            dataCell(score, 10, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt, oi) => {
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell(String(oi + 1), 8, fill(row), 'CENTER'),
                dataCell(opt.option_text || opt.text || '', 64, fill(row)),
                dataCell(String(oi + 1), 13, fill(row), 'CENTER'),
                dataCell('', 10, fill(row)),
            ]);
            row++;
        });
    }
    return out;
}

function buildKepribadianRows(question: ExportQuestion, idx: number, dimensionsList: ExportDimension[] = [], images: WordImages = new Map()): RowsForOneQuestion {
    const dataCell = imageCells(images);
    const opts = [...(question.bank_question_options || question.options || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const typeLabel = TYPE_LABEL[question.type] || 'SJT';
    const qNo = String(idx + 1);
    const fill = (row: number) => (row % 2 === 0 ? 'FFFFFF' : 'F1F0FB');

    const out: RowsForOneQuestion = [];
    let row = 0;

    if (question.type === 'sjt') {
        // SJT: row contains question text + each option in subsequent rows
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 10, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 50, fill(row - 1)),
            dataCell(question.question_dimensions?.name || '-', 20, fill(row - 1), 'CENTER'),
            dataCell('', 15, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt, oi) => {
            const dimId = opt.metadata?.dimension_id || opt.dimension_id;
            const dimName = dimensionsList.find((d) => d.id === dimId)?.name || '-';
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell(optionLabel(oi), 10, fill(row)),
                dataCell(opt.option_text || opt.text || '', 50, fill(row)),
                dataCell(dimName, 20, fill(row), 'CENTER'),
                dataCell(String(opt.weight ?? 0), 15, fill(row), 'CENTER'),
            ]);
            row++;
        });
    } else {
        // Likert, forced_choice, checklist, ranking, paired_comparison → simple 5-col
        // Each option gets its own row with dimension + bobot
        out.push([
            dataCell(qNo, 5, fill(row++), 'CENTER'),
            dataCell(typeLabel, 10, fill(row - 1), 'CENTER'),
            dataCell(question.question_text || '', 50, fill(row - 1)),
            dataCell(question.question_dimensions?.name || '-', 20, fill(row - 1), 'CENTER'),
            dataCell('', 15, fill(row - 1), 'CENTER'),
        ]);
        opts.forEach((opt) => {
            const dimId = opt.metadata?.dimension_id || opt.dimension_id;
            const dimName = dimensionsList.find((d) => d.id === dimId)?.name || '-';
            out.push([
                dataCell('', 5, fill(row), 'CENTER'),
                dataCell('', 10, fill(row)),
                dataCell(opt.option_text || opt.text || '', 50, fill(row)),
                dataCell(dimName, 20, fill(row), 'CENTER'),
                dataCell(String(opt.weight ?? 0), 15, fill(row), 'CENTER'),
            ]);
            row++;
        });
    }
    return out;
}

// ─── Section builders (Stimulus, Petunjuk) ────────────────────────────────────

function buildStimulusSection(stimuli: ExportContentItem[], questions: ExportQuestion[], images: WordImages = new Map()): (Paragraph | Table)[] {
    const dataCell = imageCells(images);
    if (!stimuli || stimuli.length === 0) return [];
    const headerColor = '1E3A8A';
    const rows: TableRow[] = [
        hRow([
            headerCell('Nomor Soal', 15, headerColor),
            headerCell('Judul', 20, headerColor),
            headerCell('Isi Stimulus', 65, headerColor),
        ]),
    ];
    let rowIdx = 0;
    const fill = (i: number) => (i % 2 === 0 ? 'FFFFFF' : 'EFF6FF');

    stimuli.forEach((s) => {
        const qNos = questions
            .map((q, i) => (q.stimulus_id === s.id ? i + 1 : null))
            .filter(Boolean)
            .join(', ');
        rows.push(dRow([
            dataCell(qNos, 15, fill(rowIdx++), 'CENTER'),
            dataCell(s.title || '-', 20, fill(rowIdx - 1)),
            dataCell(s.content || '', 65, fill(rowIdx - 1)),
        ]));
    });

    const metaStimuli = new Map<string, number[]>();
    questions.forEach((q, i) => {
        if (!q.stimulus_id && q.metadata?.import_stimulus) {
            const text = q.metadata.import_stimulus;
            if (!metaStimuli.has(text)) metaStimuli.set(text, []);
            metaStimuli.get(text)!.push(i + 1);
        }
    });
    metaStimuli.forEach((qNos, text) => {
        rows.push(dRow([
            dataCell(qNos.join(', '), 15, fill(rowIdx++), 'CENTER'),
            dataCell('-', 20, fill(rowIdx - 1)),
            dataCell(text, 65, fill(rowIdx - 1)),
        ]));
    });

    return [
        new Paragraph({ children: [], spacing: { before: 400, after: 200 } }),
        new Paragraph({
            children: [new TextRun({ text: 'DAFTAR STIMULUS', bold: true, size: 26, color: '1E3A8A', font: 'Calibri' })],
            spacing: { after: 200 },
        }),
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
            borders: border(),
        }),
    ];
}

function buildInstructionSection(instructions: ExportContentItem[], questions: ExportQuestion[], images: WordImages = new Map()): (Paragraph | Table)[] {
    const dataCell = imageCells(images);
    if (!instructions || instructions.length === 0) return [];
    const headerColor = '1E3A8A';
    const rows: TableRow[] = [
        hRow([
            headerCell('Nomor Soal', 15, headerColor),
            headerCell('Judul', 20, headerColor),
            headerCell('Isi Petunjuk', 65, headerColor),
        ]),
    ];
    let rowIdx = 0;
    const fill = (i: number) => (i % 2 === 0 ? 'FFFFFF' : 'EFF6FF');

    instructions.forEach((ins) => {
        const qNos = questions
            .map((q, i) => (q.instruction_id === ins.id ? i + 1 : null))
            .filter(Boolean)
            .join(', ');
        rows.push(dRow([
            dataCell(qNos, 15, fill(rowIdx++), 'CENTER'),
            dataCell(ins.title || '-', 20, fill(rowIdx - 1)),
            dataCell(ins.content || '', 65, fill(rowIdx - 1)),
        ]));
    });

    const metaInstructions = new Map<string, number[]>();
    questions.forEach((q, i) => {
        if (!q.instruction_id && q.metadata?.import_instruction) {
            const text = q.metadata.import_instruction;
            if (!metaInstructions.has(text)) metaInstructions.set(text, []);
            metaInstructions.get(text)!.push(i + 1);
        }
    });
    metaInstructions.forEach((qNos, text) => {
        rows.push(dRow([
            dataCell(qNos.join(', '), 15, fill(rowIdx++), 'CENTER'),
            dataCell('-', 20, fill(rowIdx - 1)),
            dataCell(text, 65, fill(rowIdx - 1)),
        ]));
    });

    return [
        new Paragraph({ children: [], spacing: { before: 400, after: 200 } }),
        new Paragraph({
            children: [new TextRun({ text: 'DAFTAR PETUNJUK', bold: true, size: 26, color: '1E3A8A', font: 'Calibri' })],
            spacing: { after: 200 },
        }),
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
            borders: border(),
        }),
    ];
}

function buildKisiKisiSection(kisiKisiList: ExportKisiKisiItem[], questions: ExportQuestion[], images: WordImages = new Map()): (Paragraph | Table)[] {
    const dataCell = imageCells(images);
    if (!kisiKisiList || kisiKisiList.length === 0) return [];
    const headerColor = '1E3A8A';
    const rows: TableRow[] = [
        hRow([
            headerCell('Nomor Soal', 12, headerColor),
            headerCell('No. KD/CP', 12, headerColor),
            headerCell('KD / CP', 20, headerColor),
            headerCell('Materi', 20, headerColor),
            headerCell('Indikator Soal', 26, headerColor),
            headerCell('Level', 10, headerColor),
        ]),
    ];
    let rowIdx = 0;
    const fill = (i: number) => (i % 2 === 0 ? 'FFFFFF' : 'EFF6FF');

    kisiKisiList.forEach((kisi) => {
        const qNos = questions
            .map((q, i) => (q.kisi_kisi_id === kisi.id ? i + 1 : null))
            .filter(Boolean)
            .join(', ');
        
        // Even if no questions use it, we might still want to print the kisi-kisi in the document.
        rows.push(dRow([
            dataCell(qNos || '-', 12, fill(rowIdx++), 'CENTER'),
            dataCell(kisi.nomor_kd || '-', 12, fill(rowIdx - 1), 'CENTER'),
            dataCell(kisi.kd_cp || '-', 20, fill(rowIdx - 1)),
            dataCell(kisi.materi || '-', 20, fill(rowIdx - 1)),
            dataCell(kisi.indikator_soal || '-', 26, fill(rowIdx - 1)),
            dataCell(kisi.level_kognitif || '-', 10, fill(rowIdx - 1), 'CENTER'),
        ]));
    });

    return [
        new Paragraph({ children: [], spacing: { before: 400, after: 200 } }),
        new Paragraph({
            children: [new TextRun({ text: 'KISI-KISI SOAL', bold: true, size: 26, color: '1E3A8A', font: 'Calibri' })],
            spacing: { after: 200 },
        }),
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
            borders: border(),
        }),
    ];
}

// ─── Header & Footer factories ────────────────────────────────────────────────

function makeHeader(variant: Variant, logoBuffer: ArrayBuffer | Uint8Array | null): Header {
    const color = THEME[variant].header;
    const logoImage: ImageRun | null = logoBuffer
        ? new ImageRun({
            type: 'png',
            data: logoBuffer,
            transformation: { width: 56, height: 56 },
        })
        : null;

    const logoCell = new TableCell({
        children: [new Paragraph({
            children: logoImage ? [logoImage] : [new TextRun({ text: 'ACCA', bold: true, size: 24, color, font: 'Calibri' })],
            alignment: AlignmentType.LEFT,
        })],
        width: { size: 15, type: WidthType.PERCENTAGE },
        borders: borderNone(),
        verticalAlign: VerticalAlign.CENTER,
    });

    const textCell = new TableCell({
        children: [
            new Paragraph({
                children: [new TextRun({ text: 'ACCA', bold: true, size: 28, color: '374151', font: 'Calibri' })],
                alignment: AlignmentType.LEFT,
            })
        ],
        width: { size: 85, type: WidthType.PERCENTAGE },
        borders: borderNone(),
        verticalAlign: VerticalAlign.CENTER,
    });

    return new Header({
        children: [
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: borderNone(),
                rows: [new TableRow({ children: [logoCell, textCell] })],
            }),
            new Paragraph({
                children: [new TextRun({ text: '', size: 4 })],
                border: { bottom: { color, space: 1, style: BorderStyle.SINGLE, size: 8 } },
            }),
        ],
    });
}

function makeFooter(): Footer {
    return new Footer({
        children: [new Paragraph({
            children: [new TextRun({ text: 'acca-cbt.icgowa.sch.id', bold: true, size: 24, color: '1E3A8A', font: 'Calibri' })],
            alignment: AlignmentType.CENTER,
        })],
    });
}

// ─── Title paragraph ──────────────────────────────────────────────────────────

function makeTitleParagraph(variant: Variant, bankTitle: string): Paragraph[] {
    const color = THEME[variant].header;
    return [
        new Paragraph({ children: [], spacing: { before: 200, after: 100 } }),
        new Paragraph({
            children: [new TextRun({ text: THEME[variant].title, bold: true, size: 32, color, font: 'Calibri' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
        }),
        new Paragraph({
            children: [new TextRun({ text: bankTitle || '-', size: 22, color: '6B7280', font: 'Calibri' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
        }),
    ];
}

// ─── Document factory ─────────────────────────────────────────────────────────

function buildQuestionTable(variant: Variant, questions: ExportQuestion[], dimensionsList: ExportDimension[] = [], images: WordImages = new Map()): Table {
    const color = THEME[variant].header;
    const headerCols = variant === 'akademik'
        ? [
            headerCell('No', 5, color),
            headerCell('Tipe', 8, color),
            headerCell('Soal / Pertanyaan / Opsi', 64, color),
            headerCell('Kunci', 13, color),
            headerCell('Poin', 10, color),
        ]
        : [
            headerCell('No', 5, color),
            headerCell('Tipe', 10, color),
            headerCell('Pernyataan / Opsi', 50, color),
            headerCell('Dimensi', 20, color),
            headerCell('Bobot', 15, color),
        ];

    const rows: TableRow[] = [hRow(headerCols)];

    questions.forEach((q, idx) => {
        const produced: RowsForOneQuestion = variant === 'akademik'
            ? buildAkademikRows(q, idx, images)
            : buildKepribadianRows(q, idx, dimensionsList, images);
        produced.forEach((cells: RowSpec) => {
            rows.push(dRow(cells));
        });
    });

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
        borders: border(),
        layout: TableLayoutType.AUTOFIT,
    });
}

async function fetchLogoBuffer(): Promise<ArrayBuffer | null> {
    if (typeof window === 'undefined') return null; // SSR safety
    try {
        const res = await fetch(LOGO_URL, { cache: 'force-cache' });
        if (!res.ok) return null;
        return await res.arrayBuffer();
    } catch {
        return null;
    }
}

export async function buildAkademikDoc(
    questions: ExportQuestion[],
    bankInfo: ExportBankInfo,
    stimuli: ExportContentItem[] = [],
    instructions: ExportContentItem[] = [],
    kisiKisiList: ExportKisiKisiItem[] = []
): Promise<Blob> {
    const logoBuffer = await fetchLogoBuffer();
    const images = await loadWordImages([questions, stimuli, instructions, kisiKisiList]);
    const doc = new Document({
        creator: 'adaCode CBT',
        title: THEME.akademik.title,
        styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
        sections: [{
            properties: { page: { margin: { top: 1100, bottom: 1100, left: 800, right: 800 } } },
            headers: { default: makeHeader('akademik', logoBuffer) },
            footers: { default: makeFooter() },
            children: [
                ...makeTitleParagraph('akademik', bankInfo?.title || '-'),
                buildQuestionTable('akademik', questions, [], images),
                ...buildStimulusSection(stimuli, questions, images),
                ...buildInstructionSection(instructions, questions, images),
                ...buildKisiKisiSection(kisiKisiList, questions, images),
            ],
        }],
    });

    return attachQuestionArchive(await Packer.toBlob(doc), questions.map(q => portableQuestion(q, {
        stimuli, instructions, kisiKisi: kisiKisiList,
    })));
}

export async function buildKepribadianDoc(
    questions: ExportQuestion[],
    bankInfo: ExportBankInfo,
    dimensionsList: ExportDimension[] = []
): Promise<Blob> {
    const logoBuffer = await fetchLogoBuffer();
    const images = await loadWordImages(questions);
    const doc = new Document({
        creator: 'adaCode CBT',
        title: THEME.kepribadian.title,
        styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
        sections: [{
            properties: { page: { margin: { top: 1100, bottom: 1100, left: 800, right: 800 } } },
            headers: { default: makeHeader('kepribadian', logoBuffer) },
            footers: { default: makeFooter() },
            children: [
                ...makeTitleParagraph('kepribadian', bankInfo?.title || '-'),
                buildQuestionTable('kepribadian', questions, dimensionsList, images),
            ],
        }],
    });

    return attachQuestionArchive(await Packer.toBlob(doc), questions.map(q => portableQuestion(q, { dimensions: dimensionsList })));
}

// ─── Public dispatcher (kept for backwards compatibility) ─────────────────────

export type ExportResult = {
    kind: 'single' | 'zip';
    blob: Blob;
    filename: string;
};

export async function exportQuestionsToWord(
    questions: ExportQuestion[],
    bankInfo: ExportBankInfo,
    stimuli: ExportContentItem[] = [],
    instructions: ExportContentItem[] = [],
    kisiKisiList: ExportKisiKisiItem[] = [],
    dimensionsList: ExportDimension[] = []
): Promise<ExportResult> {
    // Group questions by variant
    const akademikQuestions = questions.filter(q => TYPE_MAP_QUESTION_KIND[q.type] === 'akademik');
    const kepribadianQuestions = questions.filter(q => TYPE_MAP_QUESTION_KIND[q.type] === 'kepribadian');

    const hasAkademik = akademikQuestions.length > 0;
    const hasKepribadian = kepribadianQuestions.length > 0;
    const safeTitle = (bankInfo?.title || 'bank').replace(/\s+/g, '_');

    if (hasAkademik && hasKepribadian) {
        // Mixed → produce two .docx and zip them
        const akBlob = await buildAkademikDoc(akademikQuestions, bankInfo, stimuli, instructions, kisiKisiList);
        const kpBlob = await buildKepribadianDoc(kepribadianQuestions, bankInfo, dimensionsList);

        const zip = new JSZip();
        zip.file(`Bank_Soal_Pengetahuan_${safeTitle}.docx`, akBlob);
        zip.file(`Bank_Soal_Kepribadian_${safeTitle}.docx`, kpBlob);
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        return {
            kind: 'zip',
            blob: zipBlob,
            filename: `Bank_Soal_Lengkap_${safeTitle}_${Date.now()}.zip`,
        };
    }

    if (hasKepribadian) {
        const blob = await buildKepribadianDoc(kepribadianQuestions, bankInfo, dimensionsList);
        return { kind: 'single', blob, filename: `bank_soal_${safeTitle}_${Date.now()}.docx` };
    }

    // Default: akademik (or empty)
    const blob = await buildAkademikDoc(akademikQuestions, bankInfo, stimuli, instructions, kisiKisiList);
    return { kind: 'single', blob, filename: `bank_soal_${safeTitle}_${Date.now()}.docx` };
}
