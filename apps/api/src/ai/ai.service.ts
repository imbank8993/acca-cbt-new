import { Injectable } from '@nestjs/common';
import { ScoringClient } from '../scoring/scoring.client';

/**
 * Integrasi AI. Perhitungannya ada di FastAPI (`apps/scoring`); modul ini hanya
 * meneruskan dan menegakkan otorisasi.
 *
 * Dipindahkan dari `apps/web/app/actions/ai.ts`, yang tidak memeriksa apa pun —
 * siapa pun yang bisa memanggilnya dapat menghabiskan kuota OpenAI.
 */
@Injectable()
export class AiService {
    constructor(private readonly scoring: ScoringClient) {}

    async generateKisiKisi(questionText: string, options: string[] = []) {
        const result = await this.scoring.post<{ kisi: string }>(
            '/ai/kisi-kisi',
            { question_text: questionText, options },
            // Panggilan LLM lebih lambat dari query biasa, tetapi tidak boleh
            // menahan koneksi selama batas bawaan dua menit.
            { timeoutMs: 45_000 },
        );
        return { kisi: result.kisi };
    }
}
