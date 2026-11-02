import { convertLearningFile } from './learning-converter';
import { deleteMaterial, learningRequest, type LearningMaterial } from './learning-api';

/** Satu baris rencana unggah massal: satu berkas = satu subbab. */
export interface BulkDraft { key: string; file: File; title: string; order: number }

// "01 ", "3.2 ", "2_", "Subbab 4 -", "Bagian 1:", "Pertemuan 05)" di awal nama berkas.
const LEADING_NUMBER = /^\s*(?:(?:sub\s*bab|subbab|bagian|part|materi|pertemuan|topik|bab)\s*)?(\d{1,3}(?:[._]\d{1,3})*)(?=[\s._)\]:-]|$)[\s._)\]:-]*/i;

/** Tebak urutan dan judul subbab dari nama berkas. */
export function parseSubchapterFileName(name: string): { number: number | null; title: string } {
    const base = name.replace(/\.[^.]+$/, '');
    const match = base.match(LEADING_NUMBER);
    // "3.2" = BAB 3 subbab 2 → urutan subbab memakai angka terakhir.
    const number = match ? Number(match[1].split(/[._]/).pop()) : null;
    const rest = (match ? base.slice(match[0].length) : base)
        .replace(/[_]+/g, ' ').replace(/\s*-{2,}\s*/g, ' - ').replace(/\s+/g, ' ').replace(/^[\s.\-:)]+|[\s.\-:(]+$/g, '').trim();
    const title = rest || base.replace(/[_]+/g, ' ').trim() || 'Subbab';
    return { number: number && number > 0 ? number : null, title: title.charAt(0).toLocaleUpperCase('id-ID') + title.slice(1) };
}

/**
 * Susun rencana unggah. Bila setiap berkas bernomor unik dan tidak bertabrakan dengan
 * subbab yang sudah ada (≥ startOrder), nomor itu dipakai; selain itu urutan dilanjutkan
 * dari subbab terakhir mengikuti urutan alami nama berkas.
 */
export function planBulkDrafts(files: File[], startOrder: number): BulkDraft[] {
    const parsed = files.map(file => ({ file, ...parseSubchapterFileName(file.name) }))
        .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.file.name.localeCompare(b.file.name, 'id', { numeric: true }));
    const numbers = parsed.map(item => item.number);
    const useNumbers = numbers.every(value => value !== null && value >= startOrder) && new Set(numbers).size === numbers.length;
    return parsed.map((item, index) => ({
        key: `${item.file.name}:${item.file.size}:${item.file.lastModified}:${index}`,
        file: item.file, title: item.title.slice(0, 200),
        order: useNumbers ? item.number as number : startOrder + index,
    }));
}

export type BulkStage = 'Mengonversi…' | 'Mengunggah…';

/**
 * Buat satu subbab dari satu berkas. Berkas dikonversi lebih dulu sehingga berkas yang
 * gagal dibaca tidak meninggalkan draf kosong; bila unggah gagal, draf yang baru dibuat dihapus.
 */
export async function createSubchapterFromFile(input: {
    file: File; title: string; order: number; grade: string; subject: string; topic: string; publish: boolean;
}, onStage?: (stage: BulkStage) => void): Promise<LearningMaterial> {
    onStage?.('Mengonversi…');
    const converted = await convertLearningFile(input.file);
    onStage?.('Mengunggah…');
    const title = input.title.trim().slice(0, 200);
    const created = await learningRequest<{ material: LearningMaterial }>('', { method: 'POST', body: JSON.stringify({
        id: crypto.randomUUID(), title, subtopic: title, subject: input.subject, gradeLevel: input.grade, topic: input.topic, subtopicOrder: input.order,
    }) });
    try {
        const data = new FormData(); data.append('file', input.file);
        for (const [key, value] of Object.entries({
            revision: created.material.revision, title, description: '', coverData: '', subject: input.subject, gradeLevel: input.grade,
            topic: input.topic, subtopic: title, subtopicOrder: input.order, status: input.publish ? 'published' : 'draft',
            format: converted.format, contentHtml: converted.html, conversionNotes: converted.notes.join('\n'),
        })) data.append(key, String(value));
        const uploaded = await learningRequest<{ material: LearningMaterial }>(`/${created.material.id}/file`, { method: 'POST', body: data });
        return uploaded.material;
    } catch (error) {
        await deleteMaterial(created.material.id).catch(() => undefined);
        throw error;
    }
}
