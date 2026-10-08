import type { MaterialFormat } from './learning-api';
import { escapeLearningHtml } from './learning-latex';
import { assertLearningContentSize } from './learning-content-limit';

export interface ConvertedMaterial { format: MaterialFormat; html: string; notes: string[] }
export async function convertLearningFile(file: File): Promise<ConvertedMaterial> {
    if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Ukuran berkas harus antara 1 byte dan 25 MB.');
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    let result: ConvertedMaterial;
    if (['html', 'htm'].includes(ext)) {
        result = { format: 'html', html: await file.text(), notes: ['HTML mendukung skrip dan gaya yang tertanam di dalam berkas. Sumber eksternal, akses akun, serta penyimpanan browser dibatasi.'] };
    } else if (['docx', 'dotx'].includes(ext)) {
        const mammoth = await import('mammoth');
        const converted = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { externalFileAccess: false,
            styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh"] });
        result = { format: 'word', html: converted.value, notes: ['Tata letak Word disesuaikan untuk layar. Periksa rumus, gambar, dan tabel sebelum menerbitkan.', ...converted.messages.map(item => item.message).slice(0, 20)] };
    } else if (['tex', 'latex', 'zip'].includes(ext)) {
        if (ext !== 'zip' && file.size > 500_000) throw new Error('Ukuran sumber TeX maksimum 500 KB.');
        result = { format: 'latex', html: '', notes: ['Dokumen akan dikompilasi menjadi PDF di server untuk mempertahankan tata letak aslinya.'] };
    } else if (['txt', 'md', 'csv', 'json'].includes(ext)) {
        result = { format: 'text', html: `<pre>${escapeLearningHtml(await file.text())}</pre>`, notes: [] };
    } else {
        const format: MaterialFormat = ext === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? 'image'
            : ['mp3', 'wav', 'ogg', 'm4a'].includes(ext) ? 'audio' : ['mp4', 'webm'].includes(ext) ? 'video' : 'attachment';
        result = { format, html: '', notes: format === 'attachment' ? [ext === 'doc' || ext === 'dot'
            ? 'Word format lama disimpan sebagai lampiran. Simpan ulang sebagai .docx atau .dotx untuk konversi otomatis.'
            : 'Berkas ini tersedia sebagai lampiran unduhan.'] : [] };
    }
    assertLearningContentSize(result.html);
    return result;
}
