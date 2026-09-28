import type {
AddExamConfigBankInput,
ExamConfig,
} from '@/app/types/pas';
import { apiCreate,apiGet,apiSend } from './client';

/**
 * Konfigurasi ujian massal ("ujian folder") PAS/PAT.
 * Menggantikan `app/actions/exam-config.ts`.
 *
 * Bentuk nilai kembalinya dipertahankan persis seperti server action lama
 * (`[]` / `null` saat gagal, `{ success, error }` untuk mutasi) supaya halaman
 * ujian admin, guru, dan proktor tidak perlu mengubah penanganan galatnya.
 *
 * `userId` tidak lagi dikirim saat membuat konfigurasi: NestJS mengambil pembuat
 * dari token. Versi lama menerimanya sebagai parameter biasa dari browser.
 */

export async function listExamConfigs(): Promise<ExamConfig[]> {
    const res = await apiGet<{ configs: ExamConfig[] }>('/api/exam-configs');
    return res.success ? res.configs : [];
}

export async function getExamConfig(configId: string): Promise<ExamConfig | null> {
    const res = await apiGet<{ config: ExamConfig }>(
        `/api/exam-configs/${encodeURIComponent(configId)}`,
    );
    return res.success ? res.config : null;
}

export function createExamConfigAction(
    input: {
        name: string;
        school_year?: string;
        semester?: string;
        start_date?: string;
        end_date?: string;
    },
) {
    return apiCreate<{ id: string }>('/api/exam-configs', input);
}

export function deleteExamConfigAction(configId: string) {
    return apiSend<{ id: string }>(
        `/api/exam-configs/${encodeURIComponent(configId)}`,
        undefined,
        'DELETE',
    );
}

export function lockExamConfigAction(configId: string, lock: boolean) {
    return apiSend<{ id: string; is_locked: boolean }>(
        `/api/exam-configs/${encodeURIComponent(configId)}/lock`,
        { lock },
    );
}

export function addExamConfigBankAction(input: AddExamConfigBankInput) {
    return apiCreate<{ id: string }>('/api/exam-configs/banks', input);
}

export function removeExamConfigBankAction(bankRowId: string) {
    return apiSend<{ id: string }>(
        `/api/exam-configs/banks/${encodeURIComponent(bankRowId)}`,
        undefined,
        'DELETE',
    );
}

export function addExamConfigExamAction(input: {
    exam_config_id: string;
    exam_config_bank_id: string;
    class_id: string;
    scheduled_date?: string;
    scheduled_time?: string;
    window_end_time?: string;
}) {
    return apiCreate<{ id: string }>('/api/exam-configs/schedules', input);
}

export function removeExamConfigExamAction(scheduleId: string) {
    return apiSend<{ id: string }>(
        `/api/exam-configs/schedules/${encodeURIComponent(scheduleId)}`,
        undefined,
        'DELETE',
    );
}

/**
 * Bangkitkan ujian sungguhan dari jadwal terpilih.
 *
 * `skipped` selalu berupa array (kosong bila semuanya berhasil), berbeda dengan
 * versi lama yang kadang `undefined` — layar menampilkannya apa adanya, dan
 * `undefined` di sana muncul sebagai daftar yang hilang tanpa penjelasan.
 */
export async function generateExamsFromConfigAction(configExamIds: string[]) {
    const res = await apiSend<{ created: number; skipped: string[] }>(
        '/api/exam-configs/generate',
        { configExamIds },
        'POST',
        { timeoutMs: 120_000 },
    );
    return res.success
        ? { success: true as const, created: res.created, skipped: res.skipped }
        : { success: false as const, created: 0, skipped: [], error: res.error };
}
