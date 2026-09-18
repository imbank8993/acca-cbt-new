import { apiSend } from './client';

/**
 * Susun kisi-kisi untuk satu soal.
 *
 * Menggantikan `generateKisiKisiAction`. Perhitungannya kini di FastAPI, dan
 * aksesnya dibatasi peran staf — versi lama tidak memeriksa apa pun, sehingga
 * siapa pun yang bisa memanggilnya dapat menghabiskan kuota OpenAI.
 */
export function generateKisiKisi(questionText: string, options?: string[]) {
    return apiSend<{ kisi: string }>('/api/ai/kisi-kisi', {
        questionText,
        options: options ?? [],
    });
}
