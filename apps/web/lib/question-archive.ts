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
export async function attachQuestionArchive(blob: Blob, questions: ParsedQuestion[]): Promise<Blob> {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    zip.file(ENTRY, JSON.stringify({ version: 1, digest: await documentDigest(zip), questions }));
    const types = await zip.file('[Content_Types].xml')!.async('string');
    if (!types.includes('Extension="json"')) zip.file('[Content_Types].xml', types.replace('</Types>', '<Default Extension="json" ContentType="application/json"/></Types>'));
    return zip.generateAsync({ type: 'blob', mimeType: blob.type });
}
export async function readQuestionArchive(buffer: ArrayBuffer): Promise<ParsedQuestion[] | null> {
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
    return data.questions as ParsedQuestion[];
}
