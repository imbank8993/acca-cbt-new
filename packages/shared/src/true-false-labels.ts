/**
 * Label jawaban soal Benar-Salah.
 *
 * Jawaban siswa dan kunci tetap disimpan sebagai `benar` / `salah` (atau
 * `is_correct`), sehingga label hanya memengaruhi tampilan. Guru memilih
 * preset bahasa atau mengetik labelnya sendiri; hasilnya disimpan di
 * `metadata.true_false_labels` soal.
 */
export interface TrueFalseLabels {
    true: string;
    false: string;
}

export type TrueFalseLabelPresetId = 'id' | 'en' | 'ar';

export const TRUE_FALSE_LABEL_PRESETS: ReadonlyArray<{ id: TrueFalseLabelPresetId; name: string; labels: TrueFalseLabels }> = [
    { id: 'id', name: 'Indonesia', labels: { true: 'Benar', false: 'Salah' } },
    { id: 'en', name: 'English', labels: { true: 'True', false: 'False' } },
    { id: 'ar', name: 'العربية', labels: { true: 'صحيح', false: 'خطأ' } },
];

export const DEFAULT_TRUE_FALSE_LABELS: TrueFalseLabels = TRUE_FALSE_LABEL_PRESETS[0].labels;

export const TRUE_FALSE_LABEL_MAX_LENGTH = 24;

function cleanLabel(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, TRUE_FALSE_LABEL_MAX_LENGTH);
}

/**
 * Label tersimpan yang valid, atau null bila kosong/tidak valid/sama dengan
 * bawaan (Benar/Salah) — null berarti tidak perlu disimpan.
 */
export function normalizeTrueFalseLabels(value: unknown): TrueFalseLabels | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const labels = { true: cleanLabel(record.true), false: cleanLabel(record.false) };
    if (!labels.true || !labels.false) return null;
    if (labels.true.toLocaleLowerCase() === labels.false.toLocaleLowerCase()) return null;
    if (labels.true === DEFAULT_TRUE_FALSE_LABELS.true && labels.false === DEFAULT_TRUE_FALSE_LABELS.false) return null;
    return labels;
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { return null; }
    }
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : null;
}

/** Label yang dipakai untuk menampilkan soal; bawaan Benar/Salah. */
export function trueFalseLabels(metadata: unknown): TrueFalseLabels {
    return normalizeTrueFalseLabels(metadataRecord(metadata)?.true_false_labels) ?? DEFAULT_TRUE_FALSE_LABELS;
}

/** Preset yang cocok dengan label, atau 'custom' bila diketik sendiri. */
export function trueFalseLabelPreset(labels: TrueFalseLabels): TrueFalseLabelPresetId | 'custom' {
    return TRUE_FALSE_LABEL_PRESETS.find(preset => preset.labels.true === labels.true && preset.labels.false === labels.false)?.id ?? 'custom';
}

/** Teks berhuruf Arab/Ibrani ditampilkan kanan-ke-kiri. */
export function isRtlLabel(text: string): boolean {
    return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(text);
}

/** Label untuk nilai jawaban tersimpan ('benar'/'salah' atau boolean). */
export function trueFalseValueLabel(value: unknown, labels: TrueFalseLabels): string {
    if (value === true || String(value).toLowerCase() === 'benar' || String(value).toLowerCase() === 'true') return labels.true;
    if (value === false || String(value).toLowerCase() === 'salah' || String(value).toLowerCase() === 'false') return labels.false;
    return String(value ?? '');
}

const UNIVERSAL_TRUE_KEYS = ['b', 'benar', 'betul', 't', 'true', 'ص', 'صحيح'];
const UNIVERSAL_FALSE_KEYS = ['s', 'salah', 'f', 'false', 'خ', 'خطأ', 'خطا'];

/**
 * Kunci Benar-Salah dari template impor: label lengkap soal itu (mis. "True",
 * "Fakta"), atau kode umum B/S, T/F, Benar/Salah, True/False, صحيح/خطأ.
 * null bila tidak dikenali.
 */
export function parseTrueFalseKey(raw: unknown, labels: TrueFalseLabels = DEFAULT_TRUE_FALSE_LABELS): boolean | null {
    const key = cleanLabel(raw).toLocaleLowerCase();
    if (!key) return null;
    if (key === labels.true.toLocaleLowerCase()) return true;
    if (key === labels.false.toLocaleLowerCase()) return false;
    if (UNIVERSAL_TRUE_KEYS.includes(key)) return true;
    if (UNIVERSAL_FALSE_KEYS.includes(key)) return false;
    return null;
}

/** Baca baris label template, mis. "True | False". null bila tidak berisi dua label. */
export function parseTrueFalseLabelLine(raw: string): Partial<TrueFalseLabels> | null {
    const text = raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    const parts = (text.includes('|') ? text.split('|') : text.split('/')).map(part => part.trim());
    return parts.length === 2 ? { true: parts[0], false: parts[1] } : null;
}

/** Apakah nilai label sama dengan bawaan Benar/Salah (dipilih guru secara eksplisit). */
export function isDefaultTrueFalseLabels(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return cleanLabel(record.true) === DEFAULT_TRUE_FALSE_LABELS.true && cleanLabel(record.false) === DEFAULT_TRUE_FALSE_LABELS.false;
}

/** Label bawaan menurut mapel bank soal: Bahasa Inggris → True/False, Bahasa Arab → صحيح/خطأ. */
export function trueFalseLabelsForSubject(subject: unknown): TrueFalseLabels | null {
    const name = typeof subject === 'string' ? subject.toLocaleLowerCase() : '';
    const preset = /inggris|english/.test(name) ? 'en' : /\barab|عرب/.test(name) ? 'ar' : null;
    const labels = preset ? TRUE_FALSE_LABEL_PRESETS.find(item => item.id === preset)?.labels : null;
    return labels ? { ...labels } : null;
}

/**
 * Label soal Benar-Salah hasil impor: label dari file (baris LABEL) bila ada;
 * bila tidak ada sama sekali, ikuti mapel bank. Baris LABEL "Benar | Salah"
 * tetap dihormati. null = pakai Benar/Salah.
 */
export function importedTrueFalseLabels(value: unknown, subject: unknown): TrueFalseLabels | null {
    const labels = normalizeTrueFalseLabels(value);
    if (labels) return labels;
    if (isDefaultTrueFalseLabels(value)) return null;
    return trueFalseLabelsForSubject(subject);
}
