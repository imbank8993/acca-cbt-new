import { ImageRun,TextRun } from 'docx';
import { normalizeHtmlStorageUrls } from './safe-url';

export type WordImage = { data: Uint8Array; width: number; height: number };
export type WordImages = Map<string, WordImage>;
export type LoadedWordImages = WordImages & { failed?: string[] };

const imageTag = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const MAX_IMAGE_WIDTH = 420;
const CONCURRENCY = 4;
const CELL_SEPARATOR = ' | ';

/** Kunci peta gambar: URL yang sudah dinormalkan (r2.dev → /api/storage/file). */
export function imageKey(src: string): string {
    return normalizeHtmlStorageUrls(src.replace(/&amp;/g, '&'));
}

export function collectImageUrls(contents: unknown[]): string[] {
    const urls = new Set<string>();
    const collect = (value: unknown) => {
        if (typeof value === 'object' && value !== null) {
            Object.values(value).forEach(collect);
            return;
        }
        const text = typeof value === 'string' ? value : '';
        for (const match of (text || '').matchAll(imageTag)) urls.add(imageKey(match[1]));
    };
    contents.forEach(collect);
    return [...urls];
}

/** Daftar URL gambar yang dipakai sebuah konten (untuk memetakan gambar gagal ke nomor soal). */
export function imageUrlsIn(value: unknown): string[] {
    return collectImageUrls([value]);
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
    try {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
        // SVG dan sebagian format tidak dapat dibaca createImageBitmap.
        const url = URL.createObjectURL(blob);
        try {
            const img = new Image();
            img.decoding = 'async';
            img.src = url;
            await img.decode();
            const width = img.naturalWidth || MAX_IMAGE_WIDTH;
            const height = img.naturalHeight || Math.round(width * 0.6);
            return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
        } catch (err) {
            URL.revokeObjectURL(url);
            throw err;
        }
    }
}

async function loadOne(url: string): Promise<WordImage> {
    if (!/^(https?:|data:image\/|\/)/i.test(url)) throw new Error('Alamat gambar tidak didukung.');
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const image = await decode(await response.blob());
    try {
        const scale = Math.min(1, MAX_IMAGE_WIDTH / image.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            value => value ? resolve(value) : reject(new Error('Gagal menyiapkan gambar.')), 'image/png'));
        return { data: new Uint8Array(await png.arrayBuffer()), width: canvas.width, height: canvas.height };
    } finally {
        image.close();
    }
}

/**
 * Muat semua gambar sebelum sel Word dibuat (paralel, maksimal 4 sekaligus).
 * Gambar yang gagal tidak langsung menggagalkan ekspor: URL-nya dikembalikan
 * di `failed`, dan pemanggil memutuskan apakah ekspor dilanjutkan.
 */
export async function loadWordImages(contents: unknown[]): Promise<LoadedWordImages> {
    const urls = collectImageUrls(contents);
    const result: LoadedWordImages = new Map();
    const failed: string[] = [];
    let cursor = 0;
    const worker = async () => {
        while (cursor < urls.length) {
            const url = urls[cursor++];
            try {
                result.set(url, await loadOne(url));
            } catch {
                failed.push(url);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
    result.failed = failed;
    return result;
}

// ─── HTML → run Word (format dasar dipertahankan) ─────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", times: '×', divide: '÷',
    minus: '−', plusmn: '±', le: '≤', ge: '≥', ne: '≠', deg: '°', hellip: '…', ndash: '–', mdash: '—',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', frac12: '½', frac14: '¼', frac34: '¾',
    sup2: '²', sup3: '³', pi: 'π', alpha: 'α', beta: 'β', theta: 'θ', radic: '√', infin: '∞',
};

export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
        if (name[0] === '#') {
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        }
        return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    });
}

// Karakter kontrol membuat Word menolak dokumen ("unreadable content").
const CONTROL = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

type Style = { bold?: boolean; italics?: boolean; underline?: object; strike?: boolean; superScript?: boolean; subScript?: boolean };
type Token =
    | { kind: 'text'; text: string; style: Style; separator?: boolean }
    | { kind: 'break' }
    | { kind: 'image'; src: string };

const STYLE_TAGS: Record<string, keyof Style> = {
    b: 'bold', strong: 'bold', i: 'italics', em: 'italics', u: 'underline',
    s: 'strike', strike: 'strike', del: 'strike', sup: 'superScript', sub: 'subScript',
};
const BLOCK_TAGS = /^(p|div|li|tr|h[1-6]|blockquote|ul|ol|table|tbody|thead|section|pre)$/;
const SKIP_CONTENT = /^(script|style|annotation)$/;

function tokenize(html: string): Token[] {
    const tokens: Token[] = [];
    const stack: string[] = [];
    let skipping: string | null = null;
    const style = (): Style => {
        const out: Style = {};
        stack.forEach(tag => {
            const key = STYLE_TAGS[tag];
            if (key === 'underline') out.underline = {};
            else if (key) out[key] = true;
        });
        return out;
    };
    const pushBreak = () => {
        const last = tokens[tokens.length - 1];
        if (last && last.kind !== 'break') tokens.push({ kind: 'break' });
    };
    const pushText = (text: string) => {
        if (skipping) return;
        const clean = decodeEntities(text).replace(CONTROL, '').replace(/[\r\n\t ]+/g, ' ');
        if (clean) tokens.push({ kind: 'text', text: clean, style: style() });
    };
    const tagPattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>|<!--[\s\S]*?-->/gi;
    let offset = 0;
    for (const match of html.matchAll(tagPattern)) {
        pushText(html.slice(offset, match.index));
        offset = match.index! + match[0].length;
        const tag = (match[1] || '').toLowerCase();
        if (!tag) continue;
        const closing = match[0][1] === '/';
        if (skipping) {
            if (closing && tag === skipping) skipping = null;
            continue;
        }
        if (SKIP_CONTENT.test(tag) && !closing) {
            skipping = tag;
        } else if (tag === 'img') {
            const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[0]);
            if (src) tokens.push({ kind: 'image', src: imageKey(src[1]) });
        } else if (tag === 'br') {
            tokens.push({ kind: 'break' });
        } else if (STYLE_TAGS[tag]) {
            if (closing) {
                const at = stack.lastIndexOf(tag);
                if (at >= 0) stack.splice(at, 1);
            } else if (!match[0].endsWith('/>')) {
                stack.push(tag);
            }
        } else if (tag === 'li' && !closing) {
            pushBreak();
            tokens.push({ kind: 'text', text: '• ', style: {} });
        } else if ((tag === 'td' || tag === 'th') && closing) {
            tokens.push({ kind: 'text', text: CELL_SEPARATOR, style: {}, separator: true });
        } else if (BLOCK_TAGS.test(tag)) {
            pushBreak();
        }
    }
    pushText(html.slice(offset));

    // Rapikan: pemisah sel di ujung baris, jeda di awal/akhir, spasi tepi baris.
    const out: Token[] = [];
    tokens.forEach((token, i) => {
        if (token.kind === 'text' && token.separator) {
            const next = tokens[i + 1];
            if (!next || next.kind === 'break') return;
        }
        out.push(token);
    });
    while (out[0]?.kind === 'break') out.shift();
    while (out[out.length - 1]?.kind === 'break') out.pop();
    out.forEach((token, i) => {
        if (token.kind !== 'text') return;
        if (i === 0 || out[i - 1].kind === 'break') token.text = token.text.replace(/^\s+/, '');
        if (i === out.length - 1 || out[i + 1].kind === 'break') token.text = token.text.replace(/\s+$/, '');
    });
    return out.filter(token => token.kind !== 'text' || token.text.length > 0);
}

/**
 * Ubah HTML konten soal menjadi run Word: tebal/miring/garis bawah,
 * pangkat/indeks, baris baru, daftar, tabel sederhana, dan gambar ikut terbawa.
 */
export function wordRuns(raw: unknown, images: WordImages, clean: (text: unknown) => string): (TextRun | ImageRun)[] {
    const html = String(raw ?? '');
    const base = { size: 20, font: 'Calibri' };
    if (!/[<&]/.test(html)) return [new TextRun({ ...base, text: clean(html) })];

    const runs: (TextRun | ImageRun)[] = [];
    let pendingBreak = false;
    for (const token of tokenize(html)) {
        if (token.kind === 'break') {
            pendingBreak = true;
            continue;
        }
        if (pendingBreak) runs.push(new TextRun({ ...base, text: '', break: 1 }));
        pendingBreak = false;
        if (token.kind === 'image') {
            const image = images.get(token.src);
            runs.push(image
                ? new ImageRun({ type: 'png', data: image.data, transformation: { width: image.width, height: image.height } })
                : new TextRun({ ...base, text: '[gambar tidak dapat dimuat]', italics: true, color: 'B91C1C' }));
            continue;
        }
        runs.push(new TextRun({ ...base, ...token.style, text: token.text }));
    }
    return runs.length ? runs : [new TextRun({ ...base, text: '' })];
}
