import { optionLabel, optionIndex } from './option-label';
import * as XLSX from 'xlsx';
import { QuestionType } from '@/lib/api/questions';

export interface ParsedQuestion {
    question_text: string;
    type: QuestionType;
    difficulty: 'easy' | 'medium' | 'hard';
    scoreDefault: number;
    options: {
        text: string;
        isCorrect?: boolean;
        is_correct?: boolean;
        order: number;
        weight: number;
        metadata?: any;
    }[];
    metadata: any;
    rowIndex?: number; // Track original row for error reporting
    warnings?: string[];
}

export interface ImportResult {
    success: boolean;
    questions: ParsedQuestion[];
    errors: { row: number; message: string }[];
    warnings: { row: number; message: string }[];
    totalRows: number;
}

interface RawRow {
    [key: string]: string | number | boolean | null | undefined;
}

/**
 * Parse question type string to QuestionType
 */
function parseQuestionType(raw: string | undefined): { type: QuestionType; label: string } {
    if (!raw) return { type: 'mcq', label: 'Pilihan Ganda' };
    const s = String(raw).toUpperCase().trim();

    if (s === 'PG' || s === 'PILIHAN GANDA' || s === 'MCQ') {
        return { type: 'mcq', label: 'Pilihan Ganda' };
    }
    if (s.includes('PGK') || s.includes('COMPLEX') || s.includes('KOMPLEKS')) {
        return { type: 'mcq_complex', label: 'PG Kompleks' };
    }
    if (s.includes('BS') || s.includes('BENAR SALAH') || s === 'B/S' || s === 'TF' || s === 'TRUE/FALSE') {
        return { type: 'true_false', label: 'Benar/Salah' };
    }
    if (s.includes('MJ') || s.includes('MATCHING') || s.includes('MENJODOHKAN')) {
        return { type: 'matching', label: 'Menjodohkan' };
    }
    if (s.includes('CAT') || s.includes('KATEGORISASI') || s.includes('PENGELOMPOKAN')) {
        return { type: 'categorization', label: 'Kategorisasi' };
    }
    if (s.includes('ISIAN') || s.includes('SHORT') || s.includes('ISI SINGKAT') || s === 'SA') {
        return { type: 'short_answer', label: 'Isian Singkat' };
    }
    if (s.includes('ESAI') || s.includes('URAIAN') || s.includes('ESSAY')) {
        return { type: 'essay', label: 'Essay' };
    }
    if (s.includes('SJT') || s.includes('SITUATIONAL')) {
        return { type: 'sjt', label: 'SJT' };
    }
    if (s.includes('URUT') || s.includes('URUTAN') || s.includes('ORDERING') || s.includes('PENGURUTAN')) {
        return { type: 'ordering', label: 'Pengurutan' };
    }
    if (s.includes('LIKERT')) {
        return { type: 'likert', label: 'Skala Likert' };
    }
    if (s.includes('FC') || s.includes('FORCED')) {
        return { type: 'forced_choice', label: 'Forced Choice' };
    }
    if (s.includes('CEK') || s.includes('CHECKLIST')) {
        return { type: 'checklist', label: 'Checklist' };
    }
    if (s.includes('RANK') || s.includes('RANKING')) {
        return { type: 'ranking', label: 'Ranking' };
    }
    if (s.includes('PC') || s.includes('PAIRED')) {
        return { type: 'paired_comparison', label: 'Paired Comparison' };
    }
    return { type: 'mcq', label: 'Pilihan Ganda' };
}

/**
 * Parse difficulty string
 */
function parseDifficulty(raw: string | undefined): 'easy' | 'medium' | 'hard' {
    if (!raw) return 'medium';
    const s = String(raw).toUpperCase().trim();

    if (s.includes('EASY') || s.includes('MUDAH') || s === '1') {
        return 'easy';
    }
    if (s.includes('HARD') || s.includes('SULIT') || s === '3') {
        return 'hard';
    }
    return 'medium';
}

/**
 * Parse score value
 */
function parseScore(raw: string | number | undefined): number {
    if (!raw) return 1;
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
    return isNaN(num) || num <= 0 ? 1 : num;
}

/**
 * Detect if text contains math/LaTeX
 */
function containsMath(text: string): boolean {
    return /(\$\$.*?\$\$|\$.*?\$|\\\(.*?\\\)|\\\[.*?\\\]|\\frac|\\sqrt|\\int|\\sum)/.test(text);
}

/**
 * Parse correct answer from various formats
 */
function parseCorrectAnswer(raw: string | undefined, optionCount: number): number[] {
    if (!raw) return [];
    const s = String(raw).toUpperCase().trim();

    // Single letter (A, B, C, D, E)
    if (/^[A-Z]+$/i.test(s)) {
        return [optionIndex(s)];
    }

    // Multiple letters (A,B,C or A-B-C)
    const letters = s.split(/[,;|\-\/]/).map(x => x.trim()).filter(Boolean);
    if (letters.every(l => /^[A-Z]+$/i.test(l))) {
        return letters.map(l => optionIndex(l));
    }

    // Number (1, 2, 3)
    const nums = s.split(/[,;|\-\/]/).map(x => parseInt(x.trim())).filter(n => !isNaN(n));
    if (nums.length > 0) {
        return nums.map(n => n - 1).filter(n => n >= 0 && n < optionCount);
    }

    return [];
}

const stripOptionHtml = (text: string) => text ? String(text).trim() : '';

export async function parseExcelToQuestions(file: File): Promise<ImportResult> {
    const result: ImportResult = {
        success: false,
        questions: [],
        errors: [],
        warnings: [],
        totalRows: 0
    };

    try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON with headers
        const rawData = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '' }) as RawRow[];
        result.totalRows = rawData.length;

        if (rawData.length === 0) {
            result.errors.push({ row: 0, message: 'File tidak berisi data' });
            return result;
        }

        // Get headers (case-insensitive)
        const headers = Object.keys(rawData[0]).map(h => h.toLowerCase().trim());
        const headerMap: Record<string, string> = {};
        Object.keys(rawData[0]).forEach((h, idx) => {
            headerMap[h.toLowerCase().trim()] = h; // Map lowercase to actual header
        });

        // Column mapping - flexible header detection
        const getColumn = (patterns: string[]): string | null => {
            for (const pattern of patterns) {
                const found = headers.find(h => h === pattern.toLowerCase());
                if (found && headerMap[found]) {
                    return headerMap[found];
                }
            }
            for (const pattern of patterns.filter(p => p.length > 2)) {
                const found = headers.find(h => h.includes(pattern.toLowerCase()));
                if (found) return headerMap[found];
            }
            return null;
        };

        const colSoal = getColumn(['soal', 'pertanyaan', 'question', 'item', 'teks', 'text', 'no']);
        const colType = getColumn(['tipe', 'type', 'jenis']);
        const colDiff = getColumn(['kesulitan', 'difficulty', 'level', 'tingkat']);
        const colScore = getColumn(['skor', 'score', 'poin', 'point', 'nilai']);
        const colKunci = getColumn(['kunci', 'jawaban', 'answer', 'correct', 'benar']);
        const exactColumn = (names: string[]) => names.map(name => headerMap[name]).find(Boolean) || null;
        const optionColumns = Array.from({ length: Math.max(26, ...headers.filter(h => /^[a-z]{1,3}$/.test(h)).map(h => optionIndex(h) + 1)) }, (_, i) => {
            const letter = optionLabel(i).toLowerCase();
            return exactColumn([letter, `option ${letter}`, `pilihan ${letter}`, `opsi ${letter}`, `pilihan ${i + 1}`]);
        });
        const weightColumns = optionColumns.map((_, i) => {
            const letter = optionLabel(i).toLowerCase();
            return exactColumn([`bobot ${letter}`, `weight ${letter}`, `poin ${letter}`, `bbt ${letter}`, `wt ${letter}`, `bobot_${letter}`]);
        });
        const colStimulus = getColumn(['stimulus', 'stim']);
        const colPetunjuk = getColumn(['petunjuk', 'instruksi', 'instruction', 'ptk']);
        const colKisi = getColumn(['kisi-kisi', 'kisi', 'kisi_kisi', 'indikator', 'kd']);

        // If no question column found, try to detect numbered format
        if (!colSoal) {
            result.errors.push({
                row: 0,
                message: 'Kolom "Soal/Pertanyaan" tidak ditemukan. Pastikan file memiliki header yang benar.'
            });
            return result;
        }

        // Parse each row
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            const rowNum = i + 2; // +2 for 1-based index and header row
            const warnings: string[] = [];

            // Get cell values
            const getValue = (col: string | null): string => {
                if (!col) return '';
                const val = row[col];
                return val !== null && val !== undefined ? String(val).trim() : '';
            };

            const soalText = getValue(colSoal);
            const typeRaw = getValue(colType);
            const diffRaw = getValue(colDiff);
            const scoreRaw = getValue(colScore);
            const kunciRaw = getValue(colKunci);
            const optionValues = optionColumns.map(getValue);
            const optionWeights = weightColumns.map(col => Number(getValue(col)) || 0);
            const stimulusRaw = getValue(colStimulus);
            const petunjukRaw = getValue(colPetunjuk);
            const kisiRaw = getValue(colKisi);

            // Skip empty rows
            if (!soalText && !typeRaw) {
                continue;
            }

            // Skip header row (if somehow included)
            if (soalText.toLowerCase().includes('soal') && typeRaw.toLowerCase().includes('tipe')) {
                continue;
            }

            // Validate required fields
            if (!soalText) {
                result.errors.push({ row: rowNum, message: `Baris ${rowNum}: Teks soal kosong` });
                continue;
            }

            // Parse type
            const { type, label: typeLabel } = parseQuestionType(typeRaw);

            // Parse difficulty
            const difficulty = parseDifficulty(diffRaw);

            // Parse score
            const score = parseScore(scoreRaw);

            // Build options based on question type
            const options: ParsedQuestion['options'] = [];

            if (type === 'essay' || type === 'short_answer') {
                // No options needed for these types
            } else if (type === 'true_false') {
                const statements = optionValues.map((text, index) => ({ text, index })).filter(o => o.text);
                const keys = kunciRaw.toUpperCase().split(/[,;|]/).map(s => s.trim());
                const legacyPair = statements.length === 2 &&
                    /^(BENAR|TRUE)$/i.test(statements[0].text) && /^(SALAH|FALSE)$/i.test(statements[1].text);
                if (legacyPair && keys.length === 1 && ['B', 'S', 'TRUE', 'FALSE'].includes(keys[0])) {
                    const first = ['B', 'TRUE'].includes(keys[0]);
                    options.push(...statements.map((o, order) => ({ text: o.text, order, isCorrect: order === 0 ? first : !first, weight: 1 })));
                } else {
                    if (!statements.length) statements.push({ text: soalText, index: 0 });
                    if (keys.length !== statements.length || keys.some(key => !['B', 'S', 'TRUE', 'FALSE'].includes(key))) {
                        result.errors.push({ row: rowNum, message: `Baris ${rowNum}: isi satu kunci B/S untuk setiap pernyataan, dipisahkan |.` });
                        continue;
                    }
                    statements.forEach((o, order) => options.push({ text: o.text, order, isCorrect: ['B', 'TRUE'].includes(keys[order]), weight: 1 }));
                }
            } else if (type === 'sjt') {
                // SJT: options with weights; highest weight = best answer
                const rawOptions = optionValues.map((text, i) => ({ text, weight: optionWeights[i] }))
                    .filter(o => o.text && o.text.trim().length > 0);

                rawOptions.forEach((optText, idx) => {
                    options.push({
                        text: stripOptionHtml(optText.text),
                        order: idx,
                        weight: optText.weight,
                        isCorrect: false, // best option derived from max weight
                    });
                });
            } else if (type === 'ordering') {
                // Ordering: options in display order, correct_order derived from kunci
                const rawOptions = optionValues.filter(Boolean);
                rawOptions.forEach((optText, idx) => {
                    options.push({
                        text: stripOptionHtml(optText),
                        order: idx,
                        weight: 1,
                        isCorrect: false,
                    });
                });
            } else if (['matching', 'categorization'].includes(type)) {
                const items = optionValues.filter(Boolean);
                const keys = kunciRaw.split('|').map(s => s.trim());
                if (keys.length !== items.length) {
                    result.errors.push({ row: rowNum, message: `Baris ${rowNum}: jumlah pasangan/kategori kunci harus sama dengan opsi; pisahkan dengan |.` });
                    continue;
                }
                items.forEach((text, order) => options.push({ text, order, isCorrect: true, weight: 1,
                    metadata: { [type === 'matching' ? 'match_texts' : 'category_names']: keys[order].split(',').map(s => s.trim()).filter(Boolean) } }));
            } else if (['likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(type)) {
                optionValues.forEach((text, index) => {
                    if (text) options.push({ text, order: options.length, isCorrect: false, weight: optionWeights[index] });
                });
            } else {
                // MCQ and variants
                const optionTexts = optionValues;
                const correctIndices = colKunci?.toLowerCase() === 'indeks jawaban benar'
                    ? kunciRaw.split(/[,;|]/).filter(s => s.trim() !== '').map(Number)
                    : parseCorrectAnswer(kunciRaw, optionTexts.length);

                optionTexts.forEach((optText, idx) => {
                    if (!optText) return;
                    const isCorrect = correctIndices.includes(idx);
                    options.push({
                        text: stripOptionHtml(optText),
                        isCorrect,
                        order: idx,
                        weight: isCorrect ? 1 : 0
                    });
                });
                if (['mcq', 'mcq_complex'].includes(type) &&
                    (!correctIndices.length || correctIndices.some(i => !optionTexts[i]) ||
                    (type === 'mcq' && correctIndices.length !== 1))) {
                    result.errors.push({ row: rowNum, message: `Baris ${rowNum}: kunci jawaban tidak cocok dengan opsi yang tersedia.` });
                    continue;
                }

                // Validate options
                if (options.length < 2 && type === 'mcq') {
                    warnings.push(`Hanya ${options.length} opsi ditemukan. Minimal 2 opsi diperlukan untuk Pilihan Ganda.`);
                }

                if (type === 'mcq_complex' && correctIndices.length < 2) {
                    warnings.push('PG Kompleks memerlukan minimal 2 jawaban benar.');
                }
            }

            // Check for math content
            if (containsMath(soalText)) {
                warnings.push('Teks soal mengandung markup matematika (LaTeX)');
            }

            // Build metadata
            const metadata: any = {};
            if (type === 'mcq_complex') {
                metadata.isComplex = true;
            }
            if (type === 'matching' || type === 'categorization') {
                metadata.categories = []; // User needs to set these after import
            }
            if (stimulusRaw) {
                metadata.import_stimulus = stimulusRaw;
            }
            if (petunjukRaw) {
                metadata.import_instruction = petunjukRaw;
            }
            if (kisiRaw) {
                metadata.kisi_kisi = kisiRaw;
            }

            if (type === 'matching') metadata.right_items = [...new Set(options.flatMap(o => o.metadata.match_texts))];
            if (type === 'categorization') metadata.categories = [...new Set(options.flatMap(o => o.metadata.category_names))];
            if (type === 'short_answer') {
                const blanks = kunciRaw.split('|').map((part, index) => {
                    const vars = part.split(',').map(s => s.trim()).filter(Boolean);
                    if (vars.length === 0) return null;
                    return {
                        id: `blank_${Date.now()}_${index}`,
                        answer: vars[0],
                        variations: vars.length > 1 ? vars.slice(1) : []
                    };
                }).filter(Boolean);
                if (blanks.length > 0) {
                    metadata.blanks = blanks;
                }
            }

            // Ordering: correct sequence from kunci (e.g. "B,A,D,C" = correct order)
            if (type === 'ordering' && kunciRaw) {
                const orderParts = kunciRaw.split(',').map(s => s.trim()).filter(Boolean);
                if (orderParts.length > 0) {
                    const present = optionValues.map((text, i) => text ? i : -1).filter(i => i >= 0);
                    metadata.correct_order = orderParts.map(key => {
                        const index = /^[A-Z]+$/i.test(key) ? optionIndex(key) : Number(key) - 1;
                        return String(present.indexOf(index) + 1);
                    });
                }
            }

            result.questions.push({
                question_text: soalText,
                type,
                difficulty,
                scoreDefault: score,
                options,
                metadata,
                rowIndex: rowNum,
                warnings: warnings.length > 0 ? warnings : undefined
            });

            // Collect warnings
            warnings.forEach(w => {
                result.warnings.push({ row: rowNum, message: w });
            });
        }

        result.success = result.questions.length > 0 || result.errors.length === 0;

    } catch (error: any) {
        result.errors.push({ row: 0, message: `Gagal membaca file: ${error.message}` });
    }

    return result;
}

/**
 * Generate sample Excel template
 */
export function generateTemplateData(): {
    headers: string[];
    sampleRows: (string | number)[][];
} {
    return {
        headers: [
            'Soal', 'Tipe', 'Kesulitan', 'Skor', 'Kunci',
            'A', 'Bobot A', 'B', 'Bobot B', 'C', 'Bobot C', 'D', 'Bobot D', 'E', 'Bobot E',
        ],
        sampleRows: [
            [
                'Apa ibu kota Indonesia?',
                'PG',
                'Mudah',
                1,
                'A',
                'Jakarta', 1,
                'Bandung', 0,
                'Surabaya', 0,
                'Yogyakarta', 0,
                'Semarang', 0,
            ],
            [
                'Tentukan himpunan penyelesaian dari x² - 4 = 0',
                'PG',
                'Sedang',
                2,
                'A',
                'x = ±2', 1,
                'x = ±4', 0,
                'x = 2', 0,
                'x = 4', 0,
                'Tidak ada', 0,
            ],
            [
                'Benda berikut yang dapat menghantarkan listrik adalah...',
                'PGK',
                'Sedang',
                2,
                'A,C',
                'Air laut', 0,
                'Minyak goreng', 0,
                'Larutan gula', 0,
                'Kayu kering', 0,
                'Plastik', 0,
            ],
            [
                'Pernyataan "地球 berbentuk bulat" adalah...',
                'BS',
                'Mudah',
                1,
                'B',
                'Benar', 0,
                'Salah', 0,
                '', 0,
                '', 0,
                '', 0,
            ],
            [
                'Jelaskan proses fotosintesis pada tumbuhan!',
                'Essay',
                'Sulit',
                5,
                '',
                '', 0,
                '', 0,
                '', 0,
                '', 0,
                '', 0,
            ],
            [
                'Kata "buku" dalam bahasa Inggris adalah...',
                'Isian',
                'Mudah',
                1,
                'Book',
                '', 0,
                '', 0,
                '', 0,
                '', 0,
                '', 0,
            ],
            // ── SJT: soal + bobot per opsi ──────────────────────────────────────
            [
                'Situasi: Anda mendapat tugas mendadak saat deadline mendekali. Tindakan terbaik Anda?',
                'SJT',
                'Sedang',
                2,
                '',
                'Langsung kerjakan tanpa prioritas', 1,
                'Minta perpanjangan deadline ke atasan', 4,
                'Selesaikan bagian paling penting dulu', 3,
                'Serahkan tugas asal-asalan', 0,
                'Abaikan tugas tersebut', 0,
            ],
            [
                'Anda melihat rekan kerja mengambil barang kantor untuk keperluan pribadi. Apa yang Anda lakukan?',
                'SJT',
                'Sulit',
                2,
                '',
                'Langsung melapor ke manajemen', 2,
                'Mengabaikan karena bukan tanggung jawab saya', 1,
                'Membicarakan ke rekan kerja lain', 1,
                'Memastikan bukti dan melaporkan ke atasan', 4,
                'Mengambil barang yang sama agar seimbang', 0,
            ],
            // ── Ordering: susun urutan (Kunci = posisi urutan benar, A-E = pernyataan) ──
            [
                'Urutkan langkah-langkah proses admission pasien baru:',
                'Urut',
                'Sulit',
                2,
                '2,4,1,3',   // ← Kunci: urutan posisi (kolom ke berapa = posisi ke-N)
                'Pasien tiba di lobby', 0,
                'Verifikasi data & asuransi', 0,
                'Pemberian gelang identitas', 0,
                'Penjemputan ke ruangan', 0,
                '', 0,
            ],
        ],
    };
}

/**
 * Export template as downloadable file
 */
export function downloadTemplate(format: 'xlsx' | 'csv' = 'xlsx'): void {
    const { headers, sampleRows } = generateTemplateData();

    if (format === 'csv') {
        // Generate CSV
        const csvContent = [
            headers.join(','),
            ...sampleRows.map(row =>
                row.map(cell =>
                    `"${String(cell).replace(/"/g, '""')}"`
                ).join(',')
            )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'template_import_soal.csv';
        link.click();
        URL.revokeObjectURL(url);
    } else {
        // Generate XLSX
        const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

        // Set column widths
        ws['!cols'] = [
            { wch: 55 }, // Soal
            { wch: 10 }, // Tipe
            { wch: 12 }, // Kesulitan
            { wch: 8 },  // Skor
            { wch: 12 }, // Kunci
            { wch: 30 }, // A
            { wch: 8 },  // Bobot A
            { wch: 30 }, // B
            { wch: 8 },  // Bobot B
            { wch: 30 }, // C
            { wch: 8 },  // Bobot C
            { wch: 30 }, // D
            { wch: 8 },  // Bobot D
            { wch: 30 }, // E
            { wch: 8 },  // Bobot E
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template Soal');
        XLSX.writeFile(wb, 'template_import_soal.xlsx');
    }
}

/**
 * Validate questions before import
 */
export function validateQuestions(questions: ParsedQuestion[]): {
    valid: ParsedQuestion[];
    invalid: { question: ParsedQuestion; errors: string[] }[];
} {
    const valid: ParsedQuestion[] = [];
    const invalid: { question: ParsedQuestion; errors: string[] }[] = [];

    for (const q of questions) {
        const errors: string[] = [];

        // Check question text
        if (!q.question_text || q.question_text.trim().length === 0) {
            errors.push('Teks soal kosong');
        }

        // Check options for MCQ types
        if (['mcq', 'mcq_complex'].includes(q.type)) {
            if (q.options.length < 2) {
                errors.push(`Hanya ${q.options.length} opsi (minimal 2)`);
            }
            const correctCount = q.options.filter(o => o.isCorrect ?? o.is_correct).length;
            if (q.type === 'mcq' && correctCount !== 1) errors.push('PG memerlukan tepat satu jawaban benar');
            if (correctCount === 0) {
                errors.push('Tidak ada jawaban yang ditandai benar');
            }
            if (q.type === 'mcq_complex' && correctCount < 2) {
                errors.push('PG Kompleks memerlukan minimal 2 jawaban benar');
            }
        }

        if (q.type === 'sjt') {
            if (q.options.length < 2) {
                errors.push(`Hanya ${q.options.length} opsi (minimal 2)`);
            }
            const hasWeight = q.options.some(o => (o as any).weight > 0);
            if (!hasWeight) {
                errors.push('SJT memerlukan setidaknya satu opsi dengan bobot > 0');
            }
        }

        if (q.type === 'ordering') {
            if (q.options.length < 2) {
                errors.push(`Hanya ${q.options.length} pernyataan (minimal 2)`);
            }
        }

        if (['true_false', 'matching', 'categorization'].includes(q.type) && !q.options.length) errors.push('Pernyataan/opsi tidak ditemukan');
        if (q.type === 'matching' && q.options.some(o => !Array.isArray(o.metadata?.match_texts))) errors.push('Pasangan jawaban belum lengkap');
        if (q.type === 'categorization' && q.options.some(o => !Array.isArray(o.metadata?.category_names))) errors.push('Kategori jawaban belum lengkap');
        if (q.type === 'short_answer' && !q.metadata?.blanks?.length) errors.push('Kunci isian belum diisi');
        if (q.type === 'ordering') {
            const keys = q.metadata?.correct_order || q.options.map((_, i) => String(i + 1));
            const indexes = keys.map((key: unknown) => Number(key) - 1);
            if (indexes.length !== q.options.length || new Set(indexes).size !== q.options.length ||
                indexes.some((i: number) => !Number.isInteger(i) || !q.options[i])) errors.push('Urutan kunci tidak cocok dengan opsi');
        }

        // Check score
        if (!q.scoreDefault || q.scoreDefault <= 0) {
            errors.push('Skor harus lebih dari 0');
        }

        if (errors.length > 0) {
            invalid.push({ question: q, errors });
        } else {
            valid.push(q);
        }
    }

    return { valid, invalid };
}
