/**
 * Model bersama untuk "Lembar Ujian (PDF)" dan "Bank Soal (Word)".
 *
 * Modul ini sengaja murni (tanpa DOM) agar dapat dipakai di browser maupun
 * oleh skrip uji Node. Semua keputusan isi dokumen — opsi mana yang tampil,
 * huruf opsinya, skor, urutan acak yang aman, dan peringatan kualitas —
 * dibuat di sini supaya Word dan PDF tidak pernah berbeda pendapat.
 */
import { optionLabel } from './option-label';

export interface PrintOption {
    id?: string;
    option_text?: string;
    text?: string;
    is_correct?: boolean | null;
    isCorrect?: boolean | null;
    order?: number;
    weight?: number;
    match_texts?: string[];
    category_names?: string[];
    metadata?: {
        match_text?: string;
        match_texts?: string[];
        category_name?: string;
        category_names?: string[];
        [key: string]: unknown;
    } | null;
}

export interface PrintQuestion {
    id?: string;
    type: string;
    question_text?: string;
    score_default?: number | null;
    scoreDefault?: number | null;
    bank_question_options?: PrintOption[];
    options?: PrintOption[];
    metadata?: {
        right_items?: string[];
        categories?: string[];
        blanks?: unknown[];
        [key: string]: unknown;
    } | null;
}

// ─── Teks & HTML ──────────────────────────────────────────────────────────────

const ENTITY: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };

/** Teks polos dari HTML (tanpa DOM), untuk mengukur panjang dan mendeteksi isi kosong. */
export function plainText(html: unknown): string {
    return String(html ?? '')
        .replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/gi, (_, name: string) => ENTITY[name.toLowerCase()] ?? ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const MEDIA_TAG = /<(img|math|svg|table|video|audio|iframe)\b/i;

/** Konten dianggap kosong bila tidak punya teks maupun media. */
export function isBlankHtml(html: unknown): boolean {
    const raw = String(html ?? '');
    return !plainText(raw) && !MEDIA_TAG.test(raw);
}

export function optionText(option: PrintOption): string {
    return option.option_text || option.text || '';
}

export function isCorrectOption(option: PrintOption): boolean | null {
    const value = option.is_correct ?? option.isCorrect;
    return value === undefined ? null : value;
}

// ─── Opsi, skor, label ────────────────────────────────────────────────────────

export function sortedOptions<T extends PrintOption>(question: { bank_question_options?: T[]; options?: T[] }): T[] {
    return [...(question.bank_question_options || question.options || [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Opsi yang benar-benar dicetak/diekspor: terurut dan tanpa opsi kosong.
 * Aturan yang sama dipakai importer ("opsi kosong dilewati tanpa menggeser
 * kunci"), sehingga huruf A/B/C di Word, PDF, dan hasil import selalu sama.
 */
export function printableOptions<T extends PrintOption>(question: { bank_question_options?: T[]; options?: T[] }): T[] {
    return sortedOptions(question).filter(option => !isBlankHtml(optionText(option)));
}

export function questionScore(question: PrintQuestion): number {
    const raw = question.score_default ?? question.scoreDefault;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && raw !== null && raw !== undefined ? value : 1;
}

export { optionLabel };

// ─── Acak deterministik ───────────────────────────────────────────────────────

function hashSeed(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(seed: number) {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Acak stabil: soal yang sama selalu tercetak dengan urutan yang sama, dan
 * hasilnya dijamin tidak sama dengan urutan aslinya (urutan asli = kunci).
 */
export function stableShuffle<T>(items: T[], seed: string): T[] {
    const out = [...items];
    if (out.length < 2) return out;
    const random = mulberry32(hashSeed(seed));
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.every((item, index) => item === items[index])) out.push(out.shift() as T);
    return out;
}

function seedOf(question: PrintQuestion, salt: string, index: number): string {
    return `${question.id || `q${index}`}:${salt}`;
}

// ─── Data per tipe ────────────────────────────────────────────────────────────

/** Pilihan kanan menjodohkan, dengan cadangan dari kunci opsi seperti tampilan ujian. */
export function matchingRightItems(question: PrintQuestion): string[] {
    const fromMeta = (question.metadata?.right_items || []).filter(item => !isBlankHtml(item));
    const raw = fromMeta.length > 0
        ? fromMeta
        : sortedOptions(question).flatMap(option => option.metadata?.match_texts
            || option.match_texts
            || (option.metadata?.match_text ? [option.metadata.match_text] : []));
    const seen = new Set<string>();
    return raw.map(item => String(item ?? '').trim()).filter(item => {
        const key = plainText(item) || item;
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function categorizationCategories(question: PrintQuestion): string[] {
    const fromMeta = (question.metadata?.categories || []).map(item => String(item ?? '').trim()).filter(Boolean);
    if (fromMeta.length > 0) return fromMeta;
    const set = new Set<string>();
    sortedOptions(question).forEach(option => {
        (option.metadata?.category_names || option.category_names || (option.metadata?.category_name ? [option.metadata.category_name] : []))
            .forEach(name => { const clean = String(name ?? '').trim(); if (clean) set.add(clean); });
    });
    return [...set];
}

/**
 * Tata letak opsi pilihan ganda: opsi pendek disusun berdampingan agar
 * hemat kertas; opsi panjang atau bergambar tetap satu kolom.
 */
export function optionColumns(options: PrintOption[]): 1 | 2 | 3 | 4 | 5 {
    if (options.length < 2) return 1;
    if (options.some(option => /<(img|table|video|iframe|svg)\b/i.test(optionText(option)) || /\$\$|\\\[/.test(optionText(option)))) return 1;
    const lengths = options.map(option => {
        const raw = optionText(option);
        // Rumus inline lebih lebar daripada teks sumbernya, beri bobot tambahan.
        const mathBonus = (raw.match(/\$[^$]+\$|\\\(.+?\\\)/g) || []).join('').length * 0.4;
        return plainText(raw).length + mathBonus;
    });
    const longest = Math.max(...lengths);
    const count = options.length;
    if (longest <= 14 && count <= 5) return count as 2 | 3 | 4 | 5;
    if (longest <= 22 && count % 3 === 0) return 3;
    if (longest <= 36) return 2;
    return 1;
}

export interface PrintItem<Q extends PrintQuestion = PrintQuestion> {
    question: Q;
    number: number;
    options: PrintOption[];
    /** Untuk menjodohkan: pilihan kanan, sudah diacak. */
    rightItems: string[];
    categories: string[];
    columns: 1 | 2 | 3 | 4 | 5;
}

export const ORDER_TYPES = ['ordering', 'ranking'];

/** Satu sumber kebenaran untuk apa yang dicetak di lembar ujian. */
export function buildPrintItems<Q extends PrintQuestion>(questions: Q[]): PrintItem<Q>[] {
    return questions.map((question, index) => {
        const visible = printableOptions(question);
        // Urutan tersimpan pengurutan = kuncinya, jadi wajib diacak di kertas.
        const options = ORDER_TYPES.includes(question.type)
            ? stableShuffle(visible, seedOf(question, 'options', index))
            : visible;
        const rightItems = question.type === 'matching'
            ? stableShuffle(matchingRightItems(question), seedOf(question, 'right', index))
            : [];
        return {
            question,
            number: index + 1,
            options,
            rightItems,
            categories: question.type === 'categorization' ? categorizationCategories(question) : [],
            columns: ['mcq', 'sjt', 'mcq_complex'].includes(question.type) ? optionColumns(options) : 1,
        };
    });
}

export function totalScore(questions: PrintQuestion[]): number {
    return questions.reduce((sum, question) => sum + questionScore(question), 0);
}

// ─── Pemeriksaan kualitas ─────────────────────────────────────────────────────

export interface PrintIssue {
    level: 'warning' | 'info';
    numbers: number[];
    message: string;
}

const OPTION_TYPES = ['mcq', 'mcq_complex', 'sjt', 'true_false', 'matching', 'categorization', 'ordering', 'ranking', 'checklist', 'forced_choice', 'paired_comparison'];

/** Masalah isi yang perlu diketahui guru sebelum mencetak. */
export function analyzePrintQuestions(questions: PrintQuestion[]): PrintIssue[] {
    const groups = new Map<string, PrintIssue>();
    const add = (level: PrintIssue['level'], message: string, number: number) => {
        const key = `${level}:${message}`;
        const issue = groups.get(key) || { level, message, numbers: [] };
        issue.numbers.push(number);
        groups.set(key, issue);
    };
    questions.forEach((question, index) => {
        const number = index + 1;
        const all = sortedOptions(question);
        const visible = printableOptions(question);
        if (isBlankHtml(question.question_text)) add('warning', 'Teks soal kosong', number);
        if (OPTION_TYPES.includes(question.type) && visible.length === 0) add('warning', 'Tidak ada pilihan jawaban', number);
        if (all.length > visible.length) add('info', 'Opsi kosong disembunyikan', number);
        if (question.type === 'matching' && matchingRightItems(question).length === 0) add('warning', 'Pilihan kanan menjodohkan belum ada', number);
        if (question.type === 'categorization' && categorizationCategories(question).length === 0) add('warning', 'Kategori belum ditentukan', number);
        const html = [question.question_text, ...all.map(optionText)].join(' ');
        if (/<(video|audio|iframe)\b|data-video/i.test(html)) add('info', 'Berisi video/audio yang tidak dapat dicetak', number);
    });
    return [...groups.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1));
}

/** "1, 2, 3, 7" → "1–3, 7" */
export function formatNumberList(numbers: number[]): string {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const start = sorted[i];
        while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
        parts.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
    }
    return parts.join(', ');
}

// ─── Identitas dokumen ────────────────────────────────────────────────────────

export const DEFAULT_APP_HOST = 'acca.icgowa.sch.id';

/** Host aplikasi yang sedang dipakai, kecuali saat pengembangan lokal. */
export function documentHost(): string {
    if (typeof window === 'undefined' || !window.location?.hostname) return DEFAULT_APP_HOST;
    const { hostname, host } = window.location;
    const local = hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.endsWith('.local');
    return local ? DEFAULT_APP_HOST : host;
}

/** Tanggal lokal YYYY-MM-DD untuk nama file (mudah dibaca dan terurut). */
export function fileDateStamp(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Judul bank yang aman dipakai di nama file. */
export function bankFileTitle(title: string | null | undefined): string {
    return safeFileName(title || '', 'Tanpa_Judul');
}

/** Nama dasar file ekspor, seragam untuk PDF dan Word. */
export function exportBaseName(kind: 'sheet' | 'bank', title: string | null | undefined): string {
    return `${kind === 'sheet' ? 'Lembar_Ujian' : 'Bank_Soal'}_${bankFileTitle(title)}`;
}

/** Nama file aman untuk Windows/macOS/Android. */
export function safeFileName(value: string, fallback = 'bank'): string {
    const clean = String(value || '')
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
        .replace(/\s+/g, '_')
        .replace(/^[._]+|[._]+$/g, '')
        .slice(0, 80);
    return clean || fallback;
}
