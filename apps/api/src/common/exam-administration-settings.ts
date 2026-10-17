import { BadRequestException } from '@nestjs/common';

export const EXAM_ADMINISTRATION_SETTING_KEY = 'exam_administration';

export function normalizeExamAdministrationSettings(value: unknown, requireName = true) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('Pengaturan penandatangan ujian tidak valid.');
    }
    const input = value as Record<string, unknown>;
    for (const field of ['committee_chair_name', 'committee_chair_nip']) {
        if (input[field] !== undefined && typeof input[field] !== 'string') {
            throw new BadRequestException('Nama dan NIP Ketua Panitia harus berupa teks.');
        }
    }
    const name = String(input.committee_chair_name || '').trim();
    const nip = String(input.committee_chair_nip || '').trim();
    if ((requireName && !name) || name.length > 200 || nip.length > 100) {
        throw new BadRequestException('Nama Ketua Panitia wajib diisi (maksimal 200 karakter); NIP maksimal 100 karakter.');
    }
    return { committee_chair_name: name, committee_chair_nip: nip };
}
