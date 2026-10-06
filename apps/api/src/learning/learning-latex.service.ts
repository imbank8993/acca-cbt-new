import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class LearningLatexService {
    async compile(source: Buffer, project = false): Promise<Buffer> {
        if (!source.length || source.length > (project ? 25 * 1024 * 1024 : 500_000)) throw new BadRequestException(project ? 'Ukuran ZIP maksimum 25 MB.' : 'Ukuran sumber TeX maksimum 500 KB.');
        const base = process.env.LATEX_RENDERER_URL;
        if (!base) throw new ServiceUnavailableException('Compiler LaTeX belum diaktifkan. Admin perlu menjalankan layanan latex-renderer.');
        try {
            const response = await fetch(`${base.replace(/\/$/, '')}/compile`, { method: 'POST',
                headers: { 'Content-Type': project ? 'application/zip' : 'application/x-tex' }, body: new Uint8Array(source), signal: AbortSignal.timeout(70_000) });
            if (!response.ok) {
                const body = await response.json().catch(() => null) as { error?: string } | null;
                const message = body?.error?.slice(0, 3500) || 'Dokumen TeX gagal dikompilasi.';
                if ([413, 422].includes(response.status)) throw new BadRequestException(message);
                throw new ServiceUnavailableException(message);
            }
            const pdf = Buffer.from(await response.arrayBuffer());
            if (pdf.length > 25 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new ServiceUnavailableException('Hasil compiler LaTeX tidak valid.');
            return pdf;
        } catch (error) {
            if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
            throw new ServiceUnavailableException('Compiler LaTeX tidak dapat dihubungi atau melewati batas waktu. Materi lama tetap tersedia.');
        }
    }
}
