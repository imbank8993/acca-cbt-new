import { BadRequestException } from '@nestjs/common';
import { examComplexScoringRule, type ComplexScoringRule } from './complex-scoring';

/**
 * Pengaturan ujian folder ASAS/ASAT/AM.
 *
 * Disimpan di `cbt_pas_periods.exam_settings` sebagai
 *   { defaults: PasExamSettings, banks: { [bankId]: Partial<PasExamSettings> } }
 * Bawaan folder berlaku untuk semua bank soal; sebuah bank soal dapat
 * menimpa sebagian bidang (mis. hanya membuka pembahasan Matematika).
 * Bidang yang sama dengan ujian biasa, dan ditulis ke kolom/metadata ujian
 * yang sama sehingga aturan rilis nilai, pembahasan, dan mode aman yang sudah
 * ada langsung berlaku.
 */
export interface PasExamSettings {
    randomize_questions: boolean;
    randomize_options: boolean;
    show_results: boolean;
    show_answer_keys: boolean;
    is_safe_mode: boolean;
    /** `null` = catat pelanggaran tanpa mengakhiri ujian. */
    max_violations: number | null;
    screenshot_enabled: boolean;
    /** Model nilai siswa. IRT dihitung dari seluruh peserta satu ujian (satu bank soal × sesi). */
    scoring: PasScoringModel;
    /**
     * Aturan skor Benar-Salah & Kategorisasi (lihat `complex-scoring.ts`):
     * `official` = satu soal dinilai utuh (≤ 5 pernyataan semua-atau-nol,
     * > 5 pernyataan penuh/setengah/nol); `proportional` = benar ÷ jumlah pernyataan.
     */
    complex_scoring: ComplexScoringRule;
}

export const COMPLEX_SCORING_RULES = ['official', 'proportional'] as const;

export const PAS_SCORING_MODELS = ['classical', 'irt_1pl', 'irt_2pl', 'irt_3pl'] as const;
export type PasScoringModel = typeof PAS_SCORING_MODELS[number];

export interface PasExamSettingsConfig {
    defaults: PasExamSettings;
    banks: Record<string, Partial<PasExamSettings>>;
}

/** Sama dengan perilaku ujian ASAS/AM sebelum pengaturan ini ada. */
export const PAS_EXAM_SETTING_DEFAULTS: PasExamSettings = {
    randomize_questions: true,
    randomize_options: true,
    show_results: false,
    show_answer_keys: false,
    is_safe_mode: true,
    max_violations: 3,
    screenshot_enabled: false,
    scoring: 'classical',
    complex_scoring: 'official',
};

const BOOLEAN_KEYS = ['randomize_questions', 'randomize_options', 'show_results', 'show_answer_keys', 'is_safe_mode', 'screenshot_enabled'] as const;

/** Bidang yang ikut membentuk pengalaman siswa selama mengerjakan; dikunci setelah ada siswa yang mulai. */
export const PAS_LOCKED_AFTER_START = ['randomize_questions', 'randomize_options', 'is_safe_mode', 'max_violations', 'screenshot_enabled', 'complex_scoring'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validasi satu set pengaturan; bidang yang tidak dikirim dibiarkan kosong (untuk timpaan per bank). */
function readSettings(value: unknown, label: string): Partial<PasExamSettings> {
    if (value === undefined || value === null) return {};
    if (!isRecord(value)) throw new BadRequestException(`${label} harus berupa objek pengaturan.`);
    const result: Partial<PasExamSettings> = {};
    for (const key of BOOLEAN_KEYS) {
        if (value[key] === undefined) continue;
        if (typeof value[key] !== 'boolean') throw new BadRequestException(`${label}: ${key} harus bernilai ya/tidak.`);
        result[key] = value[key] as boolean;
    }
    if (value.max_violations !== undefined) {
        const limit = value.max_violations;
        if (limit !== null && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
            throw new BadRequestException(`${label}: batas pelanggaran harus angka bulat 1–100 atau tanpa batas.`);
        }
        result.max_violations = limit as number | null;
    }
    if (value.scoring !== undefined) {
        if (!PAS_SCORING_MODELS.includes(value.scoring as PasScoringModel)) {
            throw new BadRequestException(`${label}: model penilaian harus Klasik atau IRT 1PL/2PL/3PL.`);
        }
        result.scoring = value.scoring as PasScoringModel;
    }
    if (value.complex_scoring !== undefined) {
        if (!COMPLEX_SCORING_RULES.includes(value.complex_scoring as ComplexScoringRule)) {
            throw new BadRequestException(`${label}: aturan Benar-Salah/Kategorisasi harus resmi atau proporsional.`);
        }
        result.complex_scoring = value.complex_scoring as ComplexScoringRule;
    }
    return result;
}

/**
 * Baca konfigurasi tersimpan. Data lama (kosong) menghasilkan bawaan yang sama
 * dengan perilaku sebelumnya, dengan screenshot mengikuti kolom folder.
 */
export function storedPasExamSettings(period: { exam_settings?: unknown; screenshot_enabled?: boolean | null }): PasExamSettingsConfig {
    const raw = isRecord(period.exam_settings) ? period.exam_settings : {};
    let defaults: Partial<PasExamSettings> = {};
    try { defaults = readSettings(raw.defaults, 'Pengaturan bawaan'); } catch { defaults = {}; }
    const banks: Record<string, Partial<PasExamSettings>> = {};
    if (isRecord(raw.banks)) {
        for (const [bankId, value] of Object.entries(raw.banks)) {
            try {
                const override = readSettings(value, 'Pengaturan bank soal');
                if (UUID.test(bankId) && Object.keys(override).length) banks[bankId] = override;
            } catch { /* Abaikan timpaan rusak; bawaan folder tetap berlaku. */ }
        }
    }
    return {
        defaults: {
            ...PAS_EXAM_SETTING_DEFAULTS,
            screenshot_enabled: period.screenshot_enabled === true,
            ...defaults,
        },
        banks,
    };
}

/** Validasi kiriman pengguna; menolak data tidak sah alih-alih diam-diam mengabaikannya. */
export function normalizePasExamSettings(input: { defaults?: unknown; banks?: unknown }, allowedBankIds?: Set<string>): PasExamSettingsConfig {
    const defaults = { ...PAS_EXAM_SETTING_DEFAULTS, ...readSettings(input.defaults, 'Pengaturan bawaan') };
    const banks: Record<string, Partial<PasExamSettings>> = {};
    if (input.banks !== undefined && input.banks !== null) {
        if (!isRecord(input.banks)) throw new BadRequestException('Pengaturan per bank soal tidak valid.');
        for (const [bankId, value] of Object.entries(input.banks)) {
            if (!UUID.test(bankId)) throw new BadRequestException('ID bank soal tidak valid.');
            if (allowedBankIds && !allowedBankIds.has(bankId)) {
                throw new BadRequestException('Pengaturan hanya dapat diberikan untuk bank soal yang dijadwalkan di folder ini.');
            }
            const override = readSettings(value, 'Pengaturan bank soal');
            if (Object.keys(override).length) banks[bankId] = override;
        }
    }
    return { defaults, banks };
}

/** Pengaturan efektif satu bank soal: bawaan folder ditimpa pengaturan khusus bank. */
export function resolvePasExamSettings(config: PasExamSettingsConfig, bankId: string | null | undefined): PasExamSettings {
    return { ...config.defaults, ...(bankId ? config.banks[bankId] : undefined) };
}

/** Kolom dan metadata `cbt_exams` yang dibentuk dari pengaturan. */
export function pasExamSettingsColumns(settings: PasExamSettings) {
    return {
        columns: {
            randomize_questions: settings.randomize_questions,
            randomize_options: settings.randomize_options,
            show_results: settings.show_results,
            // IRT selalu disertai nilai klasik sebagai pembanding guru; siswa melihat model terpilih.
            scoring_type: settings.scoring === 'classical' ? 'classical' : `classical,${settings.scoring}`,
        },
        metadata: {
            show_answer_keys: settings.show_answer_keys,
            is_safe_mode: settings.is_safe_mode,
            max_violations: settings.max_violations,
            screenshot_enabled: settings.screenshot_enabled,
            student_score_type: settings.scoring,
            complex_scoring_rule: settings.complex_scoring,
        },
    };
}

export interface PasExamRow {
    id: string;
    show_results?: boolean | null;
    randomize_questions?: boolean | null;
    randomize_options?: boolean | null;
    scoring_type?: string | null;
    metadata?: Record<string, unknown> | null;
}

/**
 * Perubahan `cbt_exams` untuk menerapkan pengaturan pada satu ujian.
 *
 * - Nilai, pembahasan, dan model penilaian selalu ikut, kecuali selama koreksi
 *   kunci berjalan (rilis menunggu penilaian ulang selesai).
 * - Pengacakan dan keamanan tidak diubah bila siswa sudah mulai mengerjakan,
 *   supaya peserta dalam satu ujian tidak mendapat aturan berbeda.
 * - Aturan skor Benar-Salah/Kategorisasi juga dikunci setelah ada pengerjaan:
 *   mengubahnya akan membuat nilai tersimpan dan nilai hasil penilaian ulang
 *   memakai aturan berbeda.
 */
export function pasExamSettingsUpdate(exam: PasExamRow, settings: PasExamSettings, started: boolean) {
    const { columns, metadata } = pasExamSettingsColumns(settings);
    const meta: Record<string, unknown> = { ...(exam.metadata || {}) };
    const update: Record<string, unknown> = {};
    const correction = meta.key_correction as { state?: string } | undefined;
    const correcting = Boolean(correction?.state) && correction?.state !== 'ready';
    const resultsChanged = exam.show_results !== columns.show_results ||
        meta.show_answer_keys !== metadata.show_answer_keys ||
        (exam.scoring_type || 'classical') !== columns.scoring_type ||
        (meta.student_score_type || 'classical') !== metadata.student_score_type;
    const resultsLocked = correcting && resultsChanged;
    if (!resultsLocked) {
        update.show_results = columns.show_results;
        update.scoring_type = columns.scoring_type;
        meta.show_answer_keys = metadata.show_answer_keys;
        meta.student_score_type = metadata.student_score_type;
    }
    const securityChanged = exam.randomize_questions !== columns.randomize_questions ||
        exam.randomize_options !== columns.randomize_options ||
        meta.is_safe_mode !== metadata.is_safe_mode ||
        (meta.max_violations === undefined ? 3 : meta.max_violations) !== metadata.max_violations ||
        (meta.screenshot_enabled === true) !== metadata.screenshot_enabled;
    const securityLocked = started && securityChanged;
    const scoringRuleLocked = started && examComplexScoringRule(meta) !== metadata.complex_scoring_rule;
    if (!started) {
        update.randomize_questions = columns.randomize_questions;
        update.randomize_options = columns.randomize_options;
        Object.assign(meta, {
            is_safe_mode: metadata.is_safe_mode,
            max_violations: metadata.max_violations,
            screenshot_enabled: metadata.screenshot_enabled,
            complex_scoring_rule: metadata.complex_scoring_rule,
        });
    }
    return { update: { ...update, metadata: meta }, resultsLocked, securityLocked, scoringRuleLocked };
}

/** Label singkat ujian folder untuk pesan: "Bank • Kelas XII A, XII B". */
export function pasExamLabel(exam: { description?: string | null; title?: string | null }): string {
    return String(exam.description || exam.title || 'Ujian').split('|')[0].trim();
}
