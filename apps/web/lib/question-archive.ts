import JSZip from 'jszip';
import type { ParsedQuestion } from './excel-parser';

// Supplemental data preserves rich HTML, metadata, and keys that Word tables
// cannot represent. It is only read when the visible document is unchanged.
const ENTRY = 'cbt/questions.json';
async function digest(xml: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xml));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
async function documentDigest(zip: JSZip) {
    const parts: string[] = [];
    for (const name of Object.keys(zip.files).filter(name => name.startsWith('word/') && !zip.files[name].dir).sort()) {
        const hash = await crypto.subtle.digest('SHA-256', await zip.files[name].async('arraybuffer'));
        parts.push(name, Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''));
    }
    return digest(parts.join('\n'));
}
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

/**
 * Peta URL gambar → berkas `word/media/…` yang isinya identik. Dipakai saat
 * impor ulang bila berkas di penyimpanan sudah tidak ada (mis. dibersihkan
 * lewat "Bersihkan gambar tak terpakai"): gambarnya diambil dari dokumen.
 */
async function mediaIndex(zip: JSZip, images?: Map<string, { data: Uint8Array }>): Promise<Record<string, string>> {
    if (!images?.size) return {};
    const byHash = new Map<string, string>();
    for (const name of Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !zip.files[name].dir)) {
        byHash.set(hex(await crypto.subtle.digest('SHA-256', await zip.files[name].async('arraybuffer'))), name);
    }
    const out: Record<string, string> = {};
    for (const [url, image] of images) {
        const bytes = image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength) as ArrayBuffer;
        const path = byHash.get(hex(await crypto.subtle.digest('SHA-256', bytes)));
        if (path) out[url] = path;
    }
    return out;
}

export async function attachQuestionArchive(
    blob: Blob,
    questions: ParsedQuestion[],
    images?: Map<string, { data: Uint8Array }>,
): Promise<Blob> {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const media = await mediaIndex(zip, images);
    zip.file(ENTRY, JSON.stringify({
        version: 1, digest: await documentDigest(zip), questions,
        ...(Object.keys(media).length ? { media } : {}),
    }));
    const types = await zip.file('[Content_Types].xml')!.async('string');
    if (!types.includes('Extension="json"')) zip.file('[Content_Types].xml', types.replace('</Types>', '<Default Extension="json" ContentType="application/json"/></Types>'));
    return zip.generateAsync({ type: 'blob', mimeType: blob.type });
}
const MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
};

/** Di peramban: apakah gambar penyimpanan masih dapat dibuka pengguna ini. */
async function storageImageAvailable(url: string): Promise<boolean> {
    if (!url.startsWith('/')) return true;
    try {
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        await response.body?.cancel().catch(() => undefined);
        return response.ok;
    } catch {
        return false;
    }
}

export interface ReadArchiveOptions {
    /** Pemeriksa ketersediaan gambar; bawaan memeriksa lewat fetch di peramban dan dilewati di server. */
    isAvailable?: ((url: string) => Promise<boolean>) | null;
}

export async function readQuestionArchive(buffer: ArrayBuffer, options: ReadArchiveOptions = {}): Promise<ParsedQuestion[] | null> {
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file(ENTRY);
    if (!entry) return null;
    const parsed: unknown = JSON.parse(await entry.async('string'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Data bank soal di dokumen tidak valid.');
    }
    const data = parsed as Record<string, unknown>;
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml || data.version !== 1 || data.digest !== await documentDigest(zip)) return null;
    if (!Array.isArray(data.questions) || data.questions.some((question) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) return true;
        const record = question as Record<string, unknown>;
        return typeof record.question_text !== 'string' || !Array.isArray(record.options);
    })) {
        throw new Error('Data bank soal di dokumen tidak valid.');
    }
    const questions = data.questions as ParsedQuestion[];
    const media = data.media && typeof data.media === 'object' && !Array.isArray(data.media)
        ? data.media as Record<string, unknown> : {};
    const isAvailable = options.isAvailable !== undefined ? options.isAvailable
        : typeof window === 'undefined' ? null : storageImageAvailable;
    if (!isAvailable || Object.keys(media).length === 0) return questions;

    // Gambar yang sudah tidak ada di penyimpanan diganti salinan di dokumen ini
    // (data URI). Pengimpor lalu mengunggahnya kembali sebagai berkas baru.
    let json = JSON.stringify(questions);
    for (const [url, path] of Object.entries(media)) {
        if (typeof path !== 'string' || !path.startsWith('word/media/') || !json.includes(url)) continue;
        if (await isAvailable(url)) continue;
        const file = zip.file(path);
        if (!file) continue;
        const extension = (path.split('.').pop() || '').toLowerCase();
        const dataUri = `data:${MIME_BY_EXTENSION[extension] || 'image/png'};base64,${await file.async('base64')}`;
        json = json.split(url).join(dataUri);
    }
    return JSON.parse(json) as ParsedQuestion[];
}
