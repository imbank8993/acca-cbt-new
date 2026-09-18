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

    if (s.includes('PG ') || s === 'PG' || s.includes('PILIHAN GANDA') || s === 'MCQ') {
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
    if (!raw) return [0];
    const s = String(raw).toUpperCase().trim();

    // Single letter (A, B, C, D, E)
    if (/^[A-E]$/i.test(s)) {
        return [s.toUpperCase().charCodeAt(0) - 65];
    }

    // Multiple letters (A,B,C or A-B-C)
    const letters = s.split(/[,;|\-\/]/).map(x => x.trim()).filter(Boolean);
    if (letters.every(l => /^[A-E]$/i.test(l))) {
        return letters.map(l => l.toUpperCase().charCodeAt(0) - 65);
    }

    // Number (1, 2, 3)
    const nums = s.split(/[,;|\-\/]/).map(x => parseInt(x.trim())).filter(n => !isNaN(n));
    if (nums.length > 0) {
        return nums.map(n => n - 1).filter(n => n >= 0 && n < optionCount);
    }

    return [0];
}

const stripOptionHtml = (text: string) => text ? String(text).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() : '';

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
                const found = headers.find(h =>
                    h === pattern.toLowerCase() ||
                    h.includes(pattern.toLowerCase())
                );
                if (found && headerMap[found]) {
                    return headerMap[found];
                }
            }
            return null;
        };

        const colSoal = getColumn(['soal', 'pertanyaan', 'question', 'item', 'teks', 'text', 'no']);
        const colType = getColumn(['tipe', 'type', 'jenis']);
        const colDiff = getColumn(['kesulitan', 'difficulty', 'level', 'tingkat']);
        const colScore = getColumn(['skor', 'score', 'poin', 'point', 'nilai']);
        const colKunci = getColumn(['kunci', 'jawaban', 'answer', 'correct', 'benar']);
        const colOptA = getColumn(['a', 'option a', 'pilihan a', 'opsi a']);
        const colOptB = getColumn(['b', 'option b', 'pilihan b', 'opsi b']);
        const colOptC = getColumn(['c', 'option c', 'pilihan c', 'opsi c']);
        const colOptD = getColumn(['d', 'option d', 'pilihan d', 'opsi d']);
        const colOptE = getColumn(['e', 'option e', 'pilihan e', 'opsi e']);
        // SJT-specific weight columns (each option's weight value)
        const colWtA = getColumn(['bobot a', 'weight a', 'poin a', 'bbt a', 'wt a', 'bobot_a']);
        const colWtB = getColumn(['bobot b', 'weight b', 'poin b', 'bbt b', 'wt b', 'bobot_b']);
        const colWtC = getColumn(['bobot c', 'weight c', 'poin c', 'bbt c', 'wt c', 'bobot_c']);
        const colWtD = getColumn(['bobot d', 'weight d', 'poin d', 'bbt d', 'wt d', 'bobot_d']);
        const colWtE = getColumn(['bobot e', 'weight e', 'poin e', 'bbt e', 'wt e', 'bobot_e']);
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
            const optA = getValue(colOptA);
            const optB = getValue(colOptB);
            const optC = getValue(colOptC);
            const optD = getValue(colOptD);
            const optE = getValue(colOptE);
            // SJT weight columns
            const wtA = getValue(colWtA);
            const wtB = getValue(colWtB);
            const wtC = getValue(colWtC);
            const wtD = getValue(colWtD);
            const wtE = getValue(colWtE);
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
                options.push({
                    text: 'Benar',
                    isCorrect: kunciRaw.toUpperCase().includes('B') || kunciRaw === '1' || kunciRaw.toUpperCase().includes('T'),
                    order: 0,
                    weight: kunciRaw.toUpperCase().includes('B') || kunciRaw === '1' || kunciRaw.toUpperCase().includes('T') ? 1 : 0
                });
                options.push({
                    text: 'Salah',
                    isCorrect: kunciRaw.toUpperCase().includes('S') || kunciRaw === '2' || kunciRaw.toUpperCase().includes('F'),
                    order: 1,
                    weight: kunciRaw.toUpperCase().includes('S') || kunciRaw === '2' || kunciRaw.toUpperCase().includes('F') ? 1 : 0
                });
            } else if (type === 'sjt') {
                // SJT: options with weights; highest weight = best answer
                const rawOptions = [
                    { text: optA, weight: parseFloat(wtA) || 0 },
                    { text: optB, weight: parseFloat(wtB) || 0 },
                    { text: optC, weight: parseFloat(wtC) || 0 },
                    { text: optD, weight: parseFloat(wtD) || 0 },
                    { text: optE, weight: parseFloat(wtE) || 0 },
                ].filter(o => o.text && o.text.trim().length > 0);

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
                const rawOptions = [optA, optB, optC, optD, optE].filter(Boolean);
                rawOptions.forEach((optText, idx) => {
                    options.push({
                        text: stripOptionHtml(optText),
                        order: idx,
                        weight: 1,
                        isCorrect: false,
                    });
                });
            } else {
                // MCQ and variants
                const optionTexts = [optA, optB, optC, optD, optE].filter(Boolean);
                const correctIndices = parseCorrectAnswer(kunciRaw, optionTexts.length);

                optionTexts.forEach((optText, idx) => {
                    const isCorrect = correctIndices.includes(idx);
                    options.push({
                        text: stripOptionHtml(optText),
                        isCorrect,
                        order: idx,
                        weight: isCorrect ? 1 : 0
                    });
                });

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
                    metadata.correct_order = orderParts;
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
                'B',
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
            const correctCount = q.options.filter(o => o.isCorrect).length;
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
