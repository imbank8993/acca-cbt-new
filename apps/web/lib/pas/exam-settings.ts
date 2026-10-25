/**
 * Pengaturan ujian folder ASAS/ASAT/AM (cermin `apps/api/src/common/pas-exam-settings.ts`).
 * Bawaan folder berlaku untuk semua bank soal; satu bank soal dapat menimpa sebagian bidang.
 */
export interface PASExamSettings {
    randomize_questions: boolean;
    randomize_options: boolean;
    show_results: boolean;
    show_answer_keys: boolean;
    is_safe_mode: boolean;
    /** `null` = catat pelanggaran tanpa mengakhiri ujian. */
    max_violations: number | null;
    screenshot_enabled: boolean;
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
}

export const PAS_EXAM_SETTING_DEFAULTS: PASExamSettings = {
    randomize_questions: true,
    randomize_options: true,
    show_results: false,
    show_answer_keys: false,
    is_safe_mode: true,
    max_violations: 3,
    screenshot_enabled: false,
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

/** Ringkasan singkat untuk daftar bank soal. */
export function describePASExamSettings(settings: PASExamSettings): string[] {
    return [
        settings.show_results ? (settings.show_answer_keys ? 'Nilai + pembahasan' : 'Nilai dibuka') : 'Nilai tertutup',
        settings.is_safe_mode
            ? (settings.max_violations === null ? 'Mode aman (catat saja)' : `Mode aman (${settings.max_violations}×)`)
            : 'Tanpa mode aman',
        settings.randomize_questions || settings.randomize_options ? 'Diacak' : 'Urutan tetap',
        ...(settings.screenshot_enabled ? ['Berbagi layar'] : []),
    ];
}
