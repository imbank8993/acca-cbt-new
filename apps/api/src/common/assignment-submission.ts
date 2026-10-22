import { BadRequestException } from '@nestjs/common';

/**
 * Bentuk baku lampiran tugas siswa (`metadata.assignment_submission`).
 *
 * Isinya ditulis siswa dan dibaca di halaman penilaian guru, jadi tidak boleh
 * disimpan apa adanya: objek/angka di tempat string, atau URL `javascript:`,
 * dulu cukup untuk merontokkan halaman penilaian satu ujian penuh.
 *
 * Normalisasi bersifat deterministik dan dipakai SEBELUM digest pengumpulan
 * dihitung, sehingga submit-intent, submit, dan verifikasi melihat data yang
 * sama persis.
 */
export const ASSIGNMENT_MAX_FILES = 20;
export const ASSIGNMENT_MAX_URL_LENGTH = 2048;
export const ASSIGNMENT_MAX_TEXT_LENGTH = 20_000;

export interface AssignmentSubmission {
    documentUrl?: string;
    videoUrl?: string;
    fileUrls?: string[];
    textSubmission?: string;
}

function invalid(message: string): never {
    throw new BadRequestException(`Lampiran tugas tidak valid: ${message}`);
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') invalid(`${name} harus berupa teks.`);
    if (value.length > max) invalid(`${name} terlalu panjang.`);
    return value;
}

/** Link bebas (dokumen/video): tidak boleh membawa skema aktif seperti javascript: atau data:. */
function optionalLink(value: unknown, name: string): string | undefined {
    const text = optionalString(value, name, ASSIGNMENT_MAX_URL_LENGTH);
    if (text === undefined) return undefined;
    const scheme = text.trim().match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme && scheme !== 'http' && scheme !== 'https') invalid(`${name} harus berupa tautan http(s).`);
    return text;
}

export function normalizeAssignmentSubmission(
    value: unknown, _owner?: { examId: string; userId: string },
): AssignmentSubmission | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) invalid('format harus berupa objek.');
    const raw = value as Record<string, unknown>;
    const result: AssignmentSubmission = {};
    const documentUrl = optionalLink(raw.documentUrl, 'tautan dokumen');
    const videoUrl = optionalLink(raw.videoUrl, 'tautan video');
    const textSubmission = optionalString(raw.textSubmission, 'catatan', ASSIGNMENT_MAX_TEXT_LENGTH);
    if (raw.fileUrls !== undefined && raw.fileUrls !== null) {
        if (!Array.isArray(raw.fileUrls)) invalid('daftar berkas harus berupa larik.');
        if (raw.fileUrls.length > ASSIGNMENT_MAX_FILES) invalid(`maksimal ${ASSIGNMENT_MAX_FILES} berkas.`);
        // Kepemilikan berkas tidak diperiksa di sini: menolak pengumpulan karena
        // satu lampiran berarti jawaban ikut tertahan. Akses baca tetap dijaga
        // StorageAccessService, dan halaman guru menyaring skema lewat safeExternalUrl.
        result.fileUrls = raw.fileUrls.map(url => {
            if (typeof url !== 'string') invalid('setiap berkas harus berupa tautan teks.');
            return optionalLink(url, 'tautan berkas') as string;
        });
    }
    if (documentUrl !== undefined) result.documentUrl = documentUrl;
    if (videoUrl !== undefined) result.videoUrl = videoUrl;
    if (textSubmission !== undefined) result.textSubmission = textSubmission;
    return result;
}
