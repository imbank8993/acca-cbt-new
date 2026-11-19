import { proxy } from '@/lib/nest-proxy';
import { NextRequest } from 'next/server';
import { examClientHeaders } from '@/lib/exam-client-headers';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ examId: string }> },
) {
    const { examId } = await context.params;
    // Browser dan alamat jaringan siswa ikut diteruskan (sama dengan heartbeat).
    // Tanpa ini, kunci perangkat mencatat kontainer web sebagai "perangkat yang
    // mencoba", sehingga pengawas tidak bisa membedakan browser lain di perangkat
    // yang sama dari perangkat yang benar-benar lain.
    return proxy(request, `/students/exams/${encodeURIComponent(examId)}/attempts`, {
        method: 'POST', body: await request.text(),
        headers: examClientHeaders(request.headers, process.env.INTERNAL_API_KEY || ''),
    });
}
