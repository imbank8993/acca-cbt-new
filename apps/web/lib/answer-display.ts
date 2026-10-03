/**
 * Format jawaban siswa & kunci jawaban menjadi daftar baris teks yang mudah
 * dibaca, untuk panel perbandingan "Respons Anda vs Kunci Jawaban" (detail
 * hasil siswa) dan tampilan analisis guru.
 *
 * Konvensi penyimpanan (lihat ExamPage.handleAnswerSelect / submitExamAction):
 * - mcq / sjt / forced_choice / paired_comparison → selected_option_id (uuid)
 * - tipe kompleks (mcq_complex, true_false, matching, categorization,
 *   short_answer, checklist, ordering, ranking, likert, essay) → essay_answer
 *   berisi teks atau JSON.
 */

export interface DisplayMetadata {
    match_text?: string;
    match_texts?: string[];
    category_name?: string;
    category_names?: string[];
    blanks?: Array<{ variations?: string[] }>;
    [key: string]: unknown;
}

export interface DisplayOption {
    id: string;
    option_text?: string;
    text?: string;
    is_correct?: boolean;
    weight?: number;
    order?: number;
    metadata?: DisplayMetadata | null;
    category_names?: string[];
}

export interface DisplayQuestion {
    type: string;
    question_text?: string;
    metadata?: DisplayMetadata | string | null;
    options?: DisplayOption[];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Buang tag HTML agar teks opsi aman ditampilkan sebagai baris ringkas. */
export function stripHtml(html: string): string {
    return (html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    const s = value.trim();
    if (s === '') return null;
    if (s.startsWith('{') || s.startsWith('[')) {
        try { return JSON.parse(s); } catch { return s; }
    }
    return s;
}

function optionText(opt: DisplayOption | undefined): string {
    if (!opt) return '';
    return stripHtml(opt.option_text || opt.text || '');
}

function optionLabel(options: DisplayOption[], opt: DisplayOption): string {
    const idx = options.findIndex(o => o.id === opt.id);
    const letter = idx >= 0 && idx < LETTERS.length ? `${LETTERS[idx]}. ` : '';
    return `${letter}${optionText(opt)}`;
}

function normalizedMetadata(q: DisplayQuestion): DisplayMetadata {
    const raw = q?.metadata;
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            return isRecord(parsed) ? parsed : {};
        } catch { return {}; }
    }
    return isRecord(raw) ? raw : {};
}

/**
 * Jawaban yang DIPILIH / DIKETIK siswa sebagai daftar baris teks.
 * Mengembalikan [] jika tidak menjawab.
 */
export function formatStudentAnswer(
    question: DisplayQuestion,
    selectedOptionId?: string | null,
    essayAnswer?: unknown
): string[] {
    const type = (question?.type || '').toLowerCase();
    const options = question?.options || [];

    // Tipe berbasis satu opsi terpilih
    if (selectedOptionId) {
        const opt = options.find(o => o.id === selectedOptionId);
        if (opt) return [optionLabel(options, opt)];
        return ['(Opsi yang dipilih sudah tidak tersedia)'];
    }

    const parsed = parseMaybeJson(essayAnswer);
    if (parsed === null || parsed === undefined || parsed === '') return [];

    if (['essay', 'esay', 'uraian'].includes(type)) {
        if (isRecord(parsed)) {
            const lines: string[] = [];
            if (typeof parsed.text === 'string' && parsed.text) lines.push(parsed.text);
            const fileCount = Array.isArray(parsed.fileUrls) ? parsed.fileUrls.length : 0;
            if (fileCount > 0) lines.push(`📎 ${fileCount} lampiran file`);
            if (typeof parsed.videoUrl === 'string' && parsed.videoUrl) lines.push(`🎥 Link video: ${parsed.videoUrl}`);
            return lines;
        }
        return [String(parsed)];
    }

    if (type === 'mcq_complex') {
        const ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string')
            : typeof parsed === 'string' ? parsed.split(',').map(id => id.trim()).filter(Boolean) : [];
        return ids.map(id => {
            const opt = options.find(o => o.id === id);
            return opt ? optionLabel(options, opt) : '(Opsi tidak tersedia)';
        });
    }

    if (type === 'true_false' || type === 'checklist') {
        if (!isRecord(parsed)) return [String(parsed)];
        return options
            .filter(o => parsed[o.id] !== undefined && parsed[o.id] !== '')
            .map(o => `${optionText(o)} → ${String(parsed[o.id]).toUpperCase()}`);
    }

    if (type === 'matching' || type === 'categorization') {
        if (!isRecord(parsed)) return [String(parsed)];
        return options.flatMap((option) => {
            const matches = parsed[option.id];
            return Array.isArray(matches) && matches.length > 0
                ? [`${optionText(option)} → ${matches.map(String).join(', ')}`]
                : [];
        });
    }

    if (type === 'short_answer') {
        const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        return arr
            .map((v, i) => ({ v: String(v ?? '').trim(), i }))
            .filter(x => x.v !== '')
            .map(x => (arr.length > 1 ? `Isian ${x.i + 1}: ${x.v}` : x.v));
    }

    if (type === 'ordering' || type === 'ranking') {
        if (Array.isArray(parsed)) {
            return parsed.map((value: unknown, i: number) => {
                const id = typeof value === 'string' ? value : '';
                const opt = options.find(o => o.id === id);
                return `${i + 1}. ${optionText(opt)}`;
            });
        }
        if (isRecord(parsed)) {
            return options
                .filter(o => parsed[o.id] !== undefined && String(parsed[o.id]).trim() !== '')
                .map(o => `${optionText(o)} → urutan ${parsed[o.id]}`);
        }
        return [String(parsed)];
    }

    if (type === 'likert') {
        return [`Skala: ${String(parsed)} / 5`];
    }

    if (typeof parsed === 'object') return [JSON.stringify(parsed)];
    return [String(parsed)];
}

/**
 * Kunci jawaban sebagai daftar baris teks. Mengembalikan [] untuk tipe yang
 * tidak punya kunci objektif (esai, tipe kepribadian).
 */
export function formatAnswerKey(question: DisplayQuestion): string[] {
    const type = (question?.type || '').toLowerCase();
    const options = question?.options || [];
    const metadata = normalizedMetadata(question);

    if (['essay', 'esay', 'uraian', 'likert', 'forced_choice', 'paired_comparison', 'checklist', 'ranking'].includes(type)) {
        return [];
    }

    if (type === 'mcq') {
        return options.filter(o => o.is_correct).map(o => optionLabel(options, o));
    }

    if (type === 'sjt') {
        const maxWeight = Math.max(...options.map(o => o.weight ?? 0));
        return options.filter(o => (o.weight ?? 0) === maxWeight).map(o => optionLabel(options, o));
    }

    if (type === 'mcq_complex') {
        return options.filter(o => o.is_correct).map(o => optionLabel(options, o));
    }

    if (type === 'true_false') {
        return options.map(o => `${optionText(o)} → ${o.is_correct ? 'BENAR' : 'SALAH'}`);
    }

    if (type === 'matching') {
        return options
            .map(o => {
                const matches = Array.isArray(o.metadata?.match_texts)
                    ? o.metadata.match_texts.filter((value): value is string => typeof value === 'string')
                    : (typeof o.metadata?.match_text === 'string' ? [o.metadata.match_text] : []);
                return matches.length > 0 ? `${optionText(o)} → ${matches.join(', ')}` : '';
            })
            .filter(Boolean);
    }

    if (type === 'categorization') {
        return options
            .map(o => {
                const cats = Array.isArray(o.category_names)
                    ? o.category_names
                    : Array.isArray(o.metadata?.category_names)
                        ? o.metadata.category_names.filter((value): value is string => typeof value === 'string')
                        : (typeof o.metadata?.category_name === 'string' ? [o.metadata.category_name] : []);
                return cats.length > 0 ? `${optionText(o)} → ${cats.join(', ')}` : '';
            })
            .filter(Boolean);
    }

    if (type === 'short_answer') {
        const blanks = Array.isArray(metadata.blanks) ? metadata.blanks : [];
        return blanks
            .map((b, i) => {
                const vars: string[] = b?.variations || [];
                return vars.length > 0 ? (blanks.length > 1 ? `Isian ${i + 1}: ${vars.join(' / ')}` : vars.join(' / ')) : '';
            })
            .filter(Boolean);
    }

    if (type === 'ordering') {
        return [...options]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((o, i) => `${i + 1}. ${optionText(o)}`);
    }

    return [];
}
