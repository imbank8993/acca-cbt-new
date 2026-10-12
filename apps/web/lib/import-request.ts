import { fetchSessionUser } from './session';

/** Store only a digest and request UUID, never the question contents. */
export async function pendingImportRequest(bankId: string, questions: unknown) {
    const user = await fetchSessionUser();
    if (!user) throw new Error('Sesi tidak valid. Silakan login ulang.');
    const bytes = new TextEncoder().encode(JSON.stringify(questions));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(value => value.toString(16).padStart(2, '0')).join('');
    const key = `cbt-import:${user.id}:${bankId}:${digest}`;
    try {
        const old = localStorage.getItem(key);
        const id = old && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(old) ? old : crypto.randomUUID();
        localStorage.setItem(key, id);
        return { id, complete: () => { if (localStorage.getItem(key) === id) localStorage.removeItem(key); } };
    } catch {
        throw new Error('Penyimpanan browser tidak tersedia. Aktifkan sebelum mengimpor agar percobaan ulang aman.');
    }
}
