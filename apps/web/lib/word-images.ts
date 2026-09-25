import { ImageRun, TextRun } from 'docx';

export type WordImages = Map<string, { data: Uint8Array; width: number; height: number }>;
const imageTag = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** Load images before constructing synchronous Word table cells. */
export async function loadWordImages(contents: unknown[]): Promise<WordImages> {
    const urls = new Set<string>();
    const collect = (value: unknown) => {
        if (typeof value === 'object' && value !== null) {
            Object.values(value).forEach(collect);
            return;
        }
        const text = typeof value === 'string' ? value : '';
        for (const match of (text || '').matchAll(imageTag)) urls.add(match[1].replace(/&amp;/g, '&'));
    };
    contents.forEach(collect);
    const result: WordImages = new Map();
    for (const url of urls) {
        if (!/^(https?:|data:image\/|\/)/i.test(url)) throw new Error('Alamat gambar tidak didukung untuk ekspor.');
        const response = await fetch(url);
        if (!response.ok) throw new Error('Gambar tidak dapat dimuat. Ekspor dibatalkan agar gambar tidak hilang.');
        const bitmap = await createImageBitmap(await response.blob());
        const scale = Math.min(1, 420 / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            value => value ? resolve(value) : reject(new Error('Gagal menyiapkan gambar untuk Word.')), 'image/png'));
        result.set(url, { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
    }
    return result;
}

export function wordRuns(raw: unknown, images: WordImages, clean: (text: unknown) => string): (TextRun | ImageRun)[] {
    const text = String(raw ?? '');
    const runs: (TextRun | ImageRun)[] = [];
    let offset = 0;
    for (const match of text.matchAll(imageTag)) {
        runs.push(new TextRun({ text: clean(text.slice(offset, match.index)), size: 20, font: 'Calibri' }));
        const image = images.get(match[1].replace(/&amp;/g, '&'));
        if (!image) throw new Error('Gambar belum tersedia untuk ekspor.');
        runs.push(new ImageRun({ type: 'png', data: image.data, transformation: { width: image.width, height: image.height } }));
        offset = match.index! + match[0].length;
    }
    runs.push(new TextRun({ text: clean(text.slice(offset)), size: 20, color: '111827', font: 'Calibri' }));
    return runs;
}
