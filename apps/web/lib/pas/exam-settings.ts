/**
 * Pengaturan ujian folder ASAS/ASAT/AM (cermin `apps/api/src/common/pas-exam-settings.ts`).
 * Bawaan folder berlaku untuk semua bank soal; satu bank soal dapat menimpa sebagian bidang.
 */
export type PASScoringModel = 'classical' | 'irt_1pl' | 'irt_2pl' | 'irt_3pl';
/** Aturan skor Benar-Salah & Kategorisasi (cermin `apps/api/src/common/complex-scoring.ts`). */
export type PASComplexScoringRule = 'official' | 'proportional';

export interface PASExamSettings {
    randomize_questions: boolean;
    randomize_options: boolean;
    show_results: boolean;
    show_answer_keys: boolean;
    is_safe_mode: boolean;
    /** `null` = catat pelanggaran tanpa mengakhiri ujian. */
    max_violations: number | null;
    screenshot_enabled: boolean;
    /** Model nilai siswa; IRT dihitung dari seluruh peserta ujian bank soal itu. */
    scoring: PASScoringModel;
    /** Skor soal Benar-Salah & Kategorisasi; dikunci setelah ada siswa yang mengerjakan. */
    complex_scoring: PASComplexScoringRule;
}

export interface PASExamSettingsConfig {
    defaults: PASExamSettings;
    banks: Record<string, Partial<PASExamSettings>>;
}

export interface PASExamSettingsSaveResult {
    exam_settings: PASExamSettingsConfig;
    updated: number;
    security_locked: string[];
    results_locked: string[];
    /** Ujian yang aturan Benar-Salah/Kategorisasinya tidak diubah karena sudah dikerjakan. */
    scoring_rule_locked?: string[];
}

export const PAS_EXAM_SETTING_DEFAULTS: PASExamSettings = {
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

export const PAS_EXAM_SETTING_KEYS = Object.keys(PAS_EXAM_SETTING_DEFAULTS) as Array<keyof PASExamSettings>;

/** Konfigurasi dari API; aman untuk folder lama yang belum pernah diatur. */
export function pasExamSettingsConfig(period: { exam_settings?: Partial<PASExamSettingsConfig> | null; screenshot_enabled?: boolean | null }): PASExamSettingsConfig {
    return {
        defaults: {
            ...PAS_EXAM_SETTING_DEFAULTS,
            screenshot_enabled: period.screenshot_enabled === true,
            ...(period.exam_settings?.defaults || {}),
        },
        banks: { ...(period.exam_settings?.banks || {}) },
    };
}

export function resolvePASExamSettings(config: PASExamSettingsConfig, bankId: string | null | undefined): PASExamSettings {
    return { ...config.defaults, ...(bankId ? config.banks[bankId] : undefined) };
}

/**
 * Simpan timpaan bank soal hanya untuk bidang yang memang berbeda dari bawaan,
 * supaya mengubah bawaan folder tetap berlaku pada bidang yang tidak diatur khusus.
 */
export function bankOverride(defaults: PASExamSettings, settings: PASExamSettings): Partial<PASExamSettings> {
    const override: Partial<PASExamSettings> = {};
    for (const key of PAS_EXAM_SETTING_KEYS) {
        if (settings[key] !== defaults[key]) (override as Record<string, unknown>)[key] = settings[key];
    }
    return override;
}

// ── Pilihan ringkas: satu pilihan per baris pengaturan ─────────────────────

export const SCORING_CHOICES: Array<{ value: PASScoringModel; label: string; short: string }> = [
    { value: 'classical', label: 'Klasik (proporsi benar)', short: 'Klasik' },
    { value: 'irt_1pl', label: 'IRT Rasch (1PL)', short: 'IRT 1PL' },
    { value: 'irt_2pl', label: 'IRT 2PL', short: 'IRT 2PL' },
    { value: 'irt_3pl', label: 'IRT 3PL', short: 'IRT 3PL' },
];

export const COMPLEX_SCORING_CHOICES: Array<{ value: PASComplexScoringRule; label: string; short: string }> = [
    { value: 'official', label: 'Utuh per soal (juknis)', short: 'B/S utuh per soal' },
    { value: 'proportional', label: 'Proporsional per pernyataan', short: 'B/S proporsional' },
];

export type ResultsChoice = 'hidden' | 'score' | 'review';
export const RESULTS_CHOICES: Array<{ value: ResultsChoice; label: string; short: string }> = [
    { value: 'hidden', label: 'Tertutup', short: 'Hasil tertutup' },
    { value: 'score', label: 'Nilai saja', short: 'Nilai dibuka' },
    { value: 'review', label: 'Nilai + pembahasan', short: 'Nilai + pembahasan' },
];
export const resultsChoice = (s: PASExamSettings): ResultsChoice => !s.show_results ? 'hidden' : s.show_answer_keys ? 'review' : 'score';
export const withResultsChoice = (s: PASExamSettings, choice: ResultsChoice): PASExamSettings =>
    ({ ...s, show_results: choice !== 'hidden', show_answer_keys: choice === 'review' });

export type OrderChoice = 'both' | 'questions' | 'options' | 'fixed';
export const ORDER_CHOICES: Array<{ value: OrderChoice; label: string; short: string }> = [
    { value: 'both', label: 'Acak soal & opsi', short: 'Soal & opsi diacak' },
    { value: 'questions', label: 'Acak soal saja', short: 'Soal diacak' },
    { value: 'options', label: 'Acak opsi saja', short: 'Opsi diacak' },
    { value: 'fixed', label: 'Urutan tetap', short: 'Urutan tetap' },
];
export const orderChoice = (s: PASExamSettings): OrderChoice =>
    s.randomize_questions && s.randomize_options ? 'both' : s.randomize_questions ? 'questions' : s.randomize_options ? 'options' : 'fixed';
export const withOrderChoice = (s: PASExamSettings, choice: OrderChoice): PASExamSettings =>
    ({ ...s, randomize_questions: choice === 'both' || choice === 'questions', randomize_options: choice === 'both' || choice === 'options' });

export type SafetyChoice = 'limit' | 'record' | 'off';
export const SAFETY_CHOICES: Array<{ value: SafetyChoice; label: string }> = [
    { value: 'limit', label: 'Akhiri setelah batas pelanggaran' },
    { value: 'record', label: 'Catat saja, tanpa mengakhiri' },
    { value: 'off', label: 'Nonaktif' },
];
export const safetyChoice = (s: PASExamSettings): SafetyChoice => !s.is_safe_mode ? 'off' : s.max_violations === null ? 'record' : 'limit';
export const withSafetyChoice = (s: PASExamSettings, choice: SafetyChoice): PASExamSettings => ({
    ...s,
    is_safe_mode: choice !== 'off',
    max_violations: choice === 'record' ? null : choice === 'limit' ? (s.max_violations ?? 3) : s.max_violations,
});

/** Ringkasan singkat untuk daftar bank soal. */
export function describePASExamSettings(settings: PASExamSettings): string[] {
    const safety = safetyChoice(settings);
    return [
        SCORING_CHOICES.find(choice => choice.value === settings.scoring)?.short || 'Klasik',
        ...(settings.complex_scoring === 'proportional' ? ['B/S proporsional'] : []),
        RESULTS_CHOICES.find(choice => choice.value === resultsChoice(settings))!.short,
        safety === 'off' ? 'Tanpa mode aman' : safety === 'record' ? 'Mode aman (catat saja)' : `Mode aman (${settings.max_violations}×)`,
        ORDER_CHOICES.find(choice => choice.value === orderChoice(settings))!.short,
        ...(settings.screenshot_enabled ? ['Screenshot'] : []),
    ];
}

/** Jadwal folder yang ujian per kelasnya masih terpisah padahal bank, tanggal, dan sesinya sama. */
export function mergeableExamGroups(schedules: Array<{
    bank_id: string | null; exam_id: string | null; scheduled_date: string; session_id: string | null;
    scheduled_time?: string | null; window_end_time?: string | null; duration_minutes?: number | null;
}>): number {
    const groups = new Map<string, Set<string>>();
    for (const row of schedules) {
        if (!row.exam_id || !row.bank_id) continue;
        const key = [row.bank_id, String(row.scheduled_date).slice(0, 10), row.session_id || '',
            String(row.scheduled_time || '').slice(0, 5), String(row.window_end_time || '').slice(0, 5), row.duration_minutes || 90].join('|');
        groups.set(key, new Set([...(groups.get(key) || []), row.exam_id]));
    }
    return [...groups.values()].filter(ids => ids.size > 1).length;
}
