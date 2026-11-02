import { learningRequest, type LearningMaterial } from './learning-api';

/**
 * Cache kecil untuk halaman baca: detail subbab dan daftar navigasi disimpan di memori
 * agar perpindahan subbab tidak menunggu jaringan. Data dianggap segar 5 menit dan
 * tetap divalidasi ulang di latar belakang oleh pemanggil.
 */
export interface LearningDetail { material: LearningMaterial; canEdit: boolean; completed: boolean; materialUpdated: boolean }
interface Entry<T> { at: number; value?: T; promise: Promise<T> }

const TTL = 5 * 60_000;
// Isi HTML dapat berukuran megabita; simpan secukupnya (subbab aktif + tetangga + yang disorot).
const MAX_DETAILS = 8;
const details = new Map<string, Entry<LearningDetail>>();
let list: Entry<LearningMaterial[]> | null = null;

function remember<T>(request: Promise<T>): Entry<T> {
    const entry: Entry<T> = { at: Date.now(), promise: request };
    entry.promise = request.then(value => { entry.value = value; return value; });
    return entry;
}

export function peekLearningDetail(id: string): LearningDetail | null {
    const entry = details.get(id);
    return entry?.value && Date.now() - entry.at < TTL ? entry.value : null;
}

/** Umur data cache (ms), atau Infinity bila belum ada. */
export function learningDetailAge(id: string): number {
    const entry = details.get(id);
    return entry?.value ? Date.now() - entry.at : Infinity;
}

export function loadLearningDetail(id: string, fresh = false): Promise<LearningDetail> {
    const cached = details.get(id);
    if (!fresh && cached && Date.now() - cached.at < TTL) return cached.promise;
    const entry = remember(learningRequest<LearningDetail>(`/${id}`));
    entry.promise.catch(() => { if (details.get(id) === entry) details.delete(id); });
    details.delete(id); details.set(id, entry);
    while (details.size > MAX_DETAILS) details.delete(details.keys().next().value as string);
    return entry.promise;
}

export function prefetchLearningDetail(id: string) {
    const entry = details.get(id);
    if (!entry || Date.now() - entry.at >= TTL) void loadLearningDetail(id).catch(() => undefined);
}

/** Perbarui salinan cache setelah aksi pengguna (mis. tandai selesai) agar tidak kembali ke nilai lama. */
export function patchLearningDetail(id: string, patch: Partial<LearningDetail>) {
    const entry = details.get(id);
    if (entry?.value) {
        entry.value = { ...entry.value, ...patch };
        entry.promise = Promise.resolve(entry.value);
    }
}

export function loadLearningList(fresh = false): Promise<LearningMaterial[]> {
    if (!fresh && list && Date.now() - list.at < TTL) return list.promise;
    const entry = remember(learningRequest<{ materials: LearningMaterial[] }>('').then(result => result.materials));
    entry.promise.catch(() => { if (list === entry) list = null; });
    list = entry;
    return entry.promise;
}
