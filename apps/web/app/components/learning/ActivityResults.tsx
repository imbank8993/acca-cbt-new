'use client';
import { useState } from 'react';
import { learningRequest } from '@/lib/learning-api';
interface Result { user_id: string; name: string; content_version: number; updated_at: string; state: Record<string, unknown> }
export function ActivityResults({ id }: { id: string }) {
    const [results, setResults] = useState<Result[] | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const load = async () => {
        setBusy(true); setError('');
        try { setResults((await learningRequest<{ results: Result[] }>(`/${id}/activity-results`)).results); }
        catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    };
    return <section className="learn-panel" style={{ marginTop: 20 }}><h2>Jawaban aktivitas siswa</h2>
        <p>Jawaban disimpan per versi materi. Ini merupakan hasil aktivitas, bukan nilai ujian CBT.</p>
        <button disabled={busy} onClick={() => void load()}>{busy ? 'Memuat…' : 'Lihat / perbarui hasil'}</button>
        {error && <p role="alert">{error}</p>}
        {results && !results.length && <p>Belum ada jawaban aktivitas yang tersimpan.</p>}
        {results?.map(result => <details key={`${result.user_id}:${result.content_version}`} className="learn-notes"><summary>{result.name} · versi {result.content_version} · {new Date(result.updated_at).toLocaleString('id-ID')}</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result.state, null, 2)}</pre>
        </details>)}
        {results?.length === 500 && <p>Menampilkan 500 rekaman terbaru.</p>}
    </section>;
}
