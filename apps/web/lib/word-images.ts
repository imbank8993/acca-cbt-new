import { AlignmentType,BorderStyle,ImageRun,Paragraph,ShadingType,Table,TableCell,TableLayoutType,TableRow,TextRun,VerticalAlign,WidthType } from 'docx';
import { normalizeHtmlStorageUrls } from './safe-url';

/**
 * `width`/`height` = ukuran piksel asli berkas. Ukuran tampil di Word dihitung
 * terpisah (lihat `displaySize`), sehingga resolusi gambar tidak pernah
 * diturunkan: dokumen ekspor yang diimpor kembali menghasilkan gambar yang
 * sama tajamnya dengan aslinya.
 */
export type WordImage = { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number };
export type WordImages = Map<string, WordImage>;
export type LoadedWordImages = WordImages & { failed?: string[] };

const imageTag = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
/** Lebar tampil maksimum di kolom soal Word (px pada 96 dpi ≈ 11 cm). */
export const MAX_DISPLAY_WIDTH = 420;
/** Sisi terpanjang berkas yang ditanam; sama dengan batas unggah gambar soal. */
const MAX_SOURCE_SIDE = 1600;
const KEEP_AS_IS: Record<string, WordImage['type']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif' };
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
            const width = img.naturalWidth || MAX_DISPLAY_WIDTH;
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
    const blob = await response.blob();
    const image = await decode(blob);
    try {
        // PNG/JPEG/GIF yang tidak terlalu besar ditanam apa adanya (byte asli).
        const keepType = KEEP_AS_IS[(blob.type || '').toLowerCase()];
        if (keepType && Math.max(image.width, image.height) <= MAX_SOURCE_SIDE) {
            return { data: new Uint8Array(await blob.arrayBuffer()), type: keepType, width: image.width, height: image.height };
        }
        // WebP/SVG/BMP (tidak didukung Word) atau gambar raksasa: ubah ke PNG
        // pada resolusi penuh (paling panjang MAX_SOURCE_SIDE), bukan selebar kolom.
        const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            value => value ? resolve(value) : reject(new Error('Gagal menyiapkan gambar.')), 'image/png'));
        return { data: new Uint8Array(await png.arrayBuffer()), type: 'png', width: canvas.width, height: canvas.height };
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
    | { kind: 'image'; src: string; width?: number; height?: number };

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
            if (src) tokens.push({ kind: 'image', src: imageKey(src[1]), ...imageTagSize(match[0]) });
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
export function wordRuns(raw: unknown, images: WordImages, clean: (text: unknown) => string, maxImageWidth = MAX_DISPLAY_WIDTH): (TextRun | ImageRun)[] {
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
                ? new ImageRun({ type: image.type, data: image.data, transformation: displaySize(image, token, maxImageWidth) })
                : new TextRun({ ...base, text: '[gambar tidak dapat dimuat]', italics: true, color: 'B91C1C' }));
            continue;
        }
        runs.push(new TextRun({ ...base, ...token.style, text: token.text }));
    }
    return runs.length ? runs : [new TextRun({ ...base, text: '' })];
}

// ─── Ukuran tampil gambar ─────────────────────────────────────────────────────

/** Ukuran tampil dari atribut `width`/`height` atau `style="width:…px"` tag <img>. */
export function imageTagSize(tag: string): { width?: number; height?: number } {
    const attr = (name: string) => {
        const match = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+(?:\\.\\d+)?)(?:px)?["']?`, 'i').exec(tag);
        return match ? Number(match[1]) : undefined;
    };
    const style = /\bstyle\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
    const styleWidth = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
    const width = styleWidth ? Number(styleWidth[1]) : attr('width');
    const height = attr('height');
    return {
        ...(width && width > 0 ? { width } : {}),
        ...(height && height > 0 ? { height } : {}),
    };
}

/**
 * Ukuran gambar di halaman Word: ikut ukuran yang diatur di editor/dokumen asal
 * (atau ukuran asli bila tidak ada), dibatasi selebar kolom soal. Rasio selalu
 * mengikuti berkas sehingga gambar tidak pernah gepeng.
 */
export function displaySize(image: Pick<WordImage, 'width' | 'height'>, requested: { width?: number; height?: number } = {}, maxWidth = MAX_DISPLAY_WIDTH) {
    const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 0.6;
    let width = requested.width ?? (requested.height && ratio ? requested.height / ratio : image.width);
    width = Math.max(1, Math.min(width || maxWidth, maxWidth));
    return { width: Math.round(width), height: Math.max(1, Math.round(width * ratio)) };
}

// ─── HTML → blok Word (paragraf + tabel asli) ────────────────────────────────

type HtmlElement = { tag: string; attrs: string; inner: string };

/**
 * Elemen `tags` yang berada langsung di `html` (tidak di dalam tabel bersarang).
 * Pemindai sederhana berbasis tag — cukup untuk HTML editor soal yang rapi.
 */
function topLevelElements(html: string, tags: string[]): HtmlElement[] {
    const out: HtmlElement[] = [];
    const pattern = /<(\/?)(table|tr|td|th)\b([^>]*)>/gi;
    let tableDepth = 0;
    let open: { tag: string; attrs: string; start: number; depth: number } | null = null;
    for (const match of html.matchAll(pattern)) {
        const closing = match[1] === '/';
        const tag = match[2].toLowerCase();
        const index = match.index!;
        if (!closing) {
            if (!open && tableDepth === 0 && tags.includes(tag)) {
                open = { tag, attrs: match[3] || '', start: index + match[0].length, depth: tableDepth };
            }
            if (tag === 'table') tableDepth++;
        } else {
            if (tag === 'table') tableDepth = Math.max(0, tableDepth - 1);
            if (open && tag === open.tag && tableDepth === open.depth) {
                out.push({ tag: open.tag, attrs: open.attrs, inner: html.slice(open.start, index) });
                open = null;
            }
        }
    }
    if (open) out.push({ tag: open.tag, attrs: open.attrs, inner: html.slice(open.start) });
    return out;
}

/** Potong HTML menjadi bagian teks dan bagian <table> tingkat atas. */
function splitTables(html: string): ({ kind: 'html'; html: string } | { kind: 'table'; html: string })[] {
    const parts: ({ kind: 'html'; html: string } | { kind: 'table'; html: string })[] = [];
    const pattern = /<(\/?)table\b[^>]*>/gi;
    let depth = 0;
    let start = -1;
    let last = 0;
    for (const match of html.matchAll(pattern)) {
        if (match[1] !== '/') {
            if (depth === 0) {
                if (match.index! > last) parts.push({ kind: 'html', html: html.slice(last, match.index) });
                start = match.index!;
            }
            depth++;
        } else if (depth > 0) {
            depth--;
            if (depth === 0) {
                const end = match.index! + match[0].length;
                parts.push({ kind: 'table', html: html.slice(start, end) });
                last = end;
            }
        }
    }
    if (depth > 0 && start >= 0) parts.push({ kind: 'table', html: html.slice(start) });
    else if (last < html.length) parts.push({ kind: 'html', html: html.slice(last) });
    return parts;
}

const spanOf = (attrs: string, name: string) => {
    const value = Number(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs)?.[1] || 1);
    return Number.isFinite(value) && value > 1 ? Math.min(value, 20) : 1;
};
const cellAlignment = (attrs: string, inner: string) => {
    const text = `${attrs} ${(/<p\b[^>]*>/i.exec(inner) || [''])[0]}`;
    if (/text-align\s*:\s*center/i.test(text)) return AlignmentType.CENTER;
    if (/text-align\s*:\s*right/i.test(text)) return AlignmentType.RIGHT;
    return AlignmentType.LEFT;
};

/** Word menolak sel yang kosong atau diakhiri tabel: selalu tutup dengan paragraf. */
export function closeCellBlocks(blocks: (Paragraph | Table)[]): (Paragraph | Table)[] {
    if (!blocks.length || blocks[blocks.length - 1] instanceof Table) return [...blocks, new Paragraph({ children: [] })];
    return blocks;
}

function htmlTable(html: string, images: WordImages, clean: (text: unknown) => string, availableWidth: number): Table | null {
    const inner = /^<table\b[^>]*>([\s\S]*?)(?:<\/table>)?$/i.exec(html.trim())?.[1] ?? html;
    const rows = topLevelElements(inner, ['tr']);
    const cellsByRow = rows.map(row => topLevelElements(row.inner, ['td', 'th']));
    const columns = Math.max(1, ...cellsByRow.map(cells => cells.reduce((sum, cell) => sum + spanOf(cell.attrs, 'colspan'), 0)));
    if (!rows.length || cellsByRow.every(cells => cells.length === 0)) return null;
    const columnWidth = Math.max(300, Math.floor(availableWidth / columns));
    const side = { style: BorderStyle.SINGLE, size: 4, color: '94A3B8' };
    return new Table({
        width: { size: columnWidth * columns, type: WidthType.DXA },
        columnWidths: Array.from({ length: columns }, () => columnWidth),
        layout: TableLayoutType.FIXED,
        borders: { top: side, bottom: side, left: side, right: side, insideHorizontal: side, insideVertical: side },
        rows: cellsByRow.filter(cells => cells.length).map(cells => new TableRow({
            children: cells.map(cell => {
                const header = cell.tag === 'th';
                const colSpan = spanOf(cell.attrs, 'colspan');
                const content = header ? `<strong>${cell.inner}</strong>` : cell.inner;
                return new TableCell({
                    children: closeCellBlocks(wordBlocks(content, images, clean, {
                        alignment: cellAlignment(cell.attrs, cell.inner),
                        availableWidth: columnWidth * colSpan - 200,
                    })),
                    columnSpan: colSpan > 1 ? colSpan : undefined,
                    rowSpan: spanOf(cell.attrs, 'rowspan') > 1 ? spanOf(cell.attrs, 'rowspan') : undefined,
                    width: { size: columnWidth * colSpan, type: WidthType.DXA },
                    shading: header ? { fill: 'F1F5F9', type: ShadingType.CLEAR, color: 'auto' } : undefined,
                    verticalAlign: VerticalAlign.CENTER,
                    margins: { top: 40, bottom: 40, left: 80, right: 80 },
                });
            }),
        })),
    });
}

/**
 * Ubah HTML konten soal menjadi blok Word. Teks, format, dan gambar menjadi
 * paragraf (lihat `wordRuns`); setiap <table> menjadi tabel Word asli di dalam
 * sel, sehingga importer (mammoth) membacanya kembali sebagai <table> yang sama.
 */
export function wordBlocks(
    raw: unknown,
    images: WordImages,
    clean: (text: unknown) => string,
    options: { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; availableWidth?: number } = {},
): (Paragraph | Table)[] {
    const html = String(raw ?? '');
    const availableWidth = options.availableWidth ?? 5800;
    // 1 px (96 dpi) = 15 twip; gambar tidak boleh lebih lebar dari ruang yang tersedia.
    const maxImageWidth = Math.max(40, Math.min(MAX_DISPLAY_WIDTH, Math.floor(availableWidth / 15)));
    const paragraph = (part: string) => new Paragraph({ children: wordRuns(part, images, clean, maxImageWidth), alignment: options.alignment });
    if (!/<table\b/i.test(html)) return [paragraph(html)];
    const blocks: (Paragraph | Table)[] = [];
    for (const part of splitTables(html)) {
        if (part.kind === 'table') {
            const table = htmlTable(part.html, images, clean, availableWidth);
            if (table) blocks.push(table);
            else blocks.push(paragraph(part.html));
        } else if (part.html.replace(/<(?!img\b)[^>]*>|&nbsp;|\s/gi, '').length > 0) {
            blocks.push(paragraph(part.html));
        }
    }
    return blocks.length ? blocks : [paragraph('')];
}
