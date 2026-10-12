import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html';
import { MathML } from 'mathjax-full/js/input/mathml';
import { mathjax } from 'mathjax-full/js/mathjax';
import { SVG } from 'mathjax-full/js/output/svg';

/**
 * Perenderan persamaan MathML menjadi berkas SVG.
 *
 * SERVER-ONLY. File SVG diunggah ke R2 melalui NestJS StorageController
 * (POST /api/storage/upload) menggunakan INTERNAL_API_KEY — bukan melalui
 * lib/storage.ts yang dulu memegang kredensial R2 secara langsung.
 *
 * Alur baru:
 *   MathML → SVG (MathJax, di Next.js)
 *   → POST /api/storage/upload ke NestJS (internal key)
 *   → NestJS putObject ke R2
 *   → kembalikan URL untuk disimpan dalam teks soal
 */

const NEST_API_URL = process.env.NEST_API_URL || 'http://127.0.0.1:3009/api';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

let document: ReturnType<typeof mathjax.document> | null = null;
let adaptor: ReturnType<typeof liteAdaptor> | null = null;

/**
 * MathJax mendaftarkan handler-nya secara global dan menyiapkan cache font yang
 * mahal, jadi instansnya dibuat sekali lalu dipakai ulang.
 */
function renderer() {
    if (!document) {
        adaptor = liteAdaptor();
        RegisterHTMLHandler(adaptor);
        document = mathjax.document('', {
            InputJax: new MathML(),
            OutputJax: new SVG({ fontCache: 'none' }),
        });
    }
    return { document: document!, adaptor: adaptor! };
}

function mmlToSvg(mml: string): { svg: string; style: string } {
    const { document, adaptor } = renderer();
    const container = adaptor.outerHTML(document.convert(mml, { display: false }) as never);

    const svg = container.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? '';

    let style = svg.match(/style="([^"]*)"/)?.[1] ?? 'vertical-align: middle;';

    const width = svg.match(/width="([^"]*)"/)?.[1];
    const height = svg.match(/height="([^"]*)"/)?.[1];
    if (width && height) style += ` width: ${width}; height: ${height};`;

    return { svg, style };
}

/**
 * Upload SVG ke R2 melalui NestJS /api/storage/upload dengan INTERNAL_API_KEY.
 * NestJS yang memegang kredensial R2 — Next.js tidak perlu tahu soal R2.
 */
async function uploadSvgViaNest(svgContent: string, bankId: string): Promise<string | null> {
    try {
        const fileName = `eq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.svg`;
        const svgBuffer = Buffer.from(svgContent, 'utf-8');

        const formData = new FormData();
        const blob = new Blob([svgBuffer], { type: 'image/svg+xml' });
        formData.append('file', blob, fileName);
        formData.append('folder', `banks/${bankId}/equations`);

        const res = await fetch(`${NEST_API_URL}/storage/upload`, {
            method: 'POST',
            headers: {
                'x-internal-key': INTERNAL_API_KEY,
            },
            body: formData,
        });

        if (!res.ok) {
            const err = await res.text().catch(() => res.statusText);
            console.error(`[math-equations] Upload SVG gagal (${res.status}): ${err}`);
            return null;
        }

        const json = await res.json() as { url?: string };
        return json.url ?? null;
    } catch (error) {
        console.error('[math-equations] Upload SVG error:', (error as Error).message);
        return null;
    }
}

/**
 * Ganti setiap `<math>…</math>` di dalam HTML dengan `<img>` yang menunjuk
 * SVG hasil unggahan. Persamaan yang gagal dirender atau gagal diunggah
 * dibiarkan apa adanya: MathML mentah masih terbaca peramban modern.
 */
export async function renderEquationsToImages(html: string, bankId: string): Promise<string> {
    if (!html || !html.includes('<math')) return html;

    const equations = html.match(/<math[\s\S]*?<\/math>/g) || [];
    let output = html;

    for (const mml of equations) {
        try {
            const { svg, style } = mmlToSvg(mml);
            if (!svg) throw new Error('Rumus tidak dapat dirender.');

            const url = await uploadSvgViaNest(svg, bankId);
            if (!url) throw new Error('Gagal menyimpan gambar rumus. Coba impor kembali.');

            output = output.replace(
                mml,
                `<img src="${url}" class="math-equation-img" style="${style} display: inline-block; max-width: 100%;" alt="equation" />`,
            );
        } catch (error) {
            throw error;
        }
    }

    return output;
}
