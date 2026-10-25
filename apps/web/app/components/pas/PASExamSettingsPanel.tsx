"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Lock, Save, Settings2, ShieldCheck, Shuffle } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import type { PASPeriod } from '@/app/types/pas';
import { updatePASExamSettingsAction } from '@/lib/api/pas';
import {
    bankOverride,
    describePASExamSettings,
    pasExamSettingsConfig,
    resolvePASExamSettings,
    type PASExamSettings,
    type PASExamSettingsConfig,
    type PASExamSettingsSaveResult,
} from '@/lib/pas/exam-settings';

interface BankRow {
    id: string;
    title: string;
    classes: string[];
    generated: number;
}

/** Bank soal yang dijadwalkan di folder, dengan kelas dan jumlah ujian yang sudah dibangkitkan. */
export function folderBanks(period: Pick<PASPeriod, 'pas_class_schedules'>): BankRow[] {
    const banks = new Map<string, BankRow>();
    for (const schedule of period.pas_class_schedules || []) {
        if (!schedule.bank_id) continue;
        const row = banks.get(schedule.bank_id) || {
            id: schedule.bank_id,
            title: schedule.question_banks?.title?.trim() || 'Bank soal',
            classes: [],
            generated: 0,
        };
        const className = schedule.classes?.name?.replace(/^kelas\s+/i, '');
        if (className && !row.classes.includes(className)) row.classes.push(className);
        if (schedule.exam_id) row.generated += 1;
        banks.set(schedule.bank_id, row);
    }
    return [...banks.values()]
        .map(row => ({ ...row, classes: row.classes.sort((a, b) => a.localeCompare(b, 'id', { numeric: true })) }))
        .sort((a, b) => a.title.localeCompare(b.title, 'id', { numeric: true }));
}

function Toggle({ id, checked, disabled, onChange, label, hint }: {
    id: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string; hint?: string;
}) {
    return <label htmlFor={id} className={`flex items-start gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#3083FF] focus:ring-[#3083FF]/20" />
        <span className="min-w-0">
            <span className="block text-xs font-medium text-slate-800">{label}</span>
            {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
        </span>
    </label>;
}

/** Bidang pengaturan, sama dengan formulir ujian biasa. */
export function PASExamSettingsFields({ idPrefix, value, onChange, disabled }: {
    idPrefix: string; value: PASExamSettings; onChange: (next: PASExamSettings) => void; disabled?: boolean;
}) {
    const set = <K extends keyof PASExamSettings>(key: K, next: PASExamSettings[K]) => onChange({ ...value, [key]: next });
    return <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <fieldset className="space-y-2.5" disabled={disabled}>
            <legend className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><Shuffle size={12} />Pengacakan</legend>
            <Toggle id={`${idPrefix}-rq`} label="Acak soal" checked={value.randomize_questions} onChange={next => set('randomize_questions', next)} />
            <Toggle id={`${idPrefix}-ro`} label="Acak opsi jawaban" checked={value.randomize_options} onChange={next => set('randomize_options', next)} />
        </fieldset>
        <fieldset className="space-y-2.5" disabled={disabled}>
            <legend className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><BookOpen size={12} />Hasil siswa</legend>
            <Toggle id={`${idPrefix}-sr`} label="Tampilkan nilai" checked={value.show_results}
                onChange={next => onChange({ ...value, show_results: next, show_answer_keys: next ? value.show_answer_keys : false })} />
            <Toggle id={`${idPrefix}-ak`} label="Buka pembahasan" checked={value.show_answer_keys}
                hint="Kunci & pembahasan terbuka setelah semua sesi selesai dan nilai final."
                onChange={next => onChange({ ...value, show_answer_keys: next, show_results: next ? true : value.show_results })} />
        </fieldset>
        <fieldset className="space-y-2.5" disabled={disabled}>
            <legend className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><ShieldCheck size={12} />Keamanan</legend>
            <Toggle id={`${idPrefix}-sm`} label="Mode aman" checked={value.is_safe_mode} onChange={next => set('is_safe_mode', next)} />
            {value.is_safe_mode && <div className="ml-6 space-y-1.5 text-xs text-slate-700" role="radiogroup" aria-label="Saat terjadi pelanggaran">
                <label className="flex flex-wrap items-center gap-2">
                    <input type="radio" name={`${idPrefix}-violation`} checked={value.max_violations !== null}
                        onChange={() => set('max_violations', value.max_violations ?? 3)} className="text-[#3083FF]" />
                    Akhiri setelah
                    <input type="number" min={1} max={100} step={1} aria-label="Batas jumlah pelanggaran"
                        disabled={disabled || value.max_violations === null} value={value.max_violations ?? 3}
                        onChange={event => set('max_violations', Math.max(1, Math.min(100, Math.round(Number(event.target.value)) || 1)))}
                        className="w-14 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-center disabled:opacity-50" />
                    pelanggaran
                </label>
                <label className="flex items-center gap-2">
                    <input type="radio" name={`${idPrefix}-violation`} checked={value.max_violations === null}
                        onChange={() => set('max_violations', null)} className="text-[#3083FF]" />
                    Catat saja, tanpa mengakhiri
                </label>
            </div>}
            <Toggle id={`${idPrefix}-ss`} label="Screenshot pelanggaran" checked={value.screenshot_enabled}
                hint="Siswa wajib berbagi layar penuh; gambar kejadian tertentu disimpan 7 hari."
                onChange={next => set('screenshot_enabled', next)} />
        </fieldset>
    </div>;
}

/**
 * Tab "Pengaturan Ujian" folder ASAS/ASAT/AM: bawaan untuk semua bank soal,
 * lalu pengaturan khusus per bank soal bila perlu.
 */
export function PASExamSettingsPanel({ period, onSaved }: {
    period: PASPeriod;
    onSaved: (config: PASExamSettingsConfig) => void;
}) {
    const initial = useMemo(() => pasExamSettingsConfig(period), [period]);
    const banks = useMemo(() => folderBanks(period), [period]);
    const [config, setConfig] = useState<PASExamSettingsConfig>(initial);
    const [custom, setCustom] = useState<Record<string, PASExamSettings>>(() => Object.fromEntries(
        Object.keys(initial.banks).map(bankId => [bankId, resolvePASExamSettings(initial, bankId)])));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<PASExamSettingsSaveResult | null>(null);
    const locked = period.is_locked;

    const payload = useMemo(() => ({
        defaults: config.defaults,
        banks: Object.fromEntries(Object.entries(custom)
            .filter(([bankId]) => banks.some(bank => bank.id === bankId))
            .map(([bankId, settings]) => [bankId, bankOverride(config.defaults, settings)])
            .filter(([, override]) => Object.keys(override as object).length > 0)),
    }), [config.defaults, custom, banks]);
    const dirty = JSON.stringify(payload) !== JSON.stringify({ defaults: initial.defaults, banks: initial.banks });
    const generated = banks.reduce((sum, bank) => sum + bank.generated, 0);

    const save = async () => {
        setSaving(true);
        setError('');
        setResult(null);
        const response = await updatePASExamSettingsAction(period.id, payload);
        setSaving(false);
        if (!response.success) {
            setError(response.error || 'Pengaturan ujian belum berhasil disimpan.');
            return;
        }
        setResult(response);
        setConfig(response.exam_settings);
        setCustom(Object.fromEntries(Object.keys(response.exam_settings.banks)
            .map(bankId => [bankId, resolvePASExamSettings(response.exam_settings, bankId)])));
        onSaved(response.exam_settings);
    };

    return <div className="space-y-4">
        {locked && <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <Lock size={14} className="mt-0.5 shrink-0" />Folder terkunci. Buka kunci folder untuk mengubah pengaturan ujian.
        </div>}

        <section aria-labelledby="pas-settings-defaults" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 id="pas-settings-defaults" className="flex items-center gap-2 text-sm font-bold text-slate-900"><Settings2 size={16} className="text-[#3083FF]" />Pengaturan bawaan</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Berlaku untuk semua bank soal di folder ini, kecuali yang diatur khusus di bawah.</p>
                </div>
            </div>
            <PASExamSettingsFields idPrefix="pas-default" value={config.defaults} disabled={locked || saving}
                onChange={next => setConfig(current => ({ ...current, defaults: next }))} />
        </section>

        <section aria-labelledby="pas-settings-banks" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
                <h3 id="pas-settings-banks" className="text-sm font-bold text-slate-900">Per bank soal</h3>
                <p className="mt-0.5 text-xs text-slate-500">Pilih &ldquo;Atur khusus&rdquo; untuk bank soal yang aturannya berbeda, misalnya hanya Matematika yang dibuka pembahasannya.</p>
            </div>
            {banks.length === 0 ? <p className="px-5 py-10 text-center text-xs text-slate-500">Belum ada bank soal yang dijadwalkan di folder ini.</p>
                : <ul className="divide-y divide-slate-100">{banks.map(bank => {
                    const isCustom = Boolean(custom[bank.id]);
                    const effective = custom[bank.id] || config.defaults;
                    return <li key={bank.id} className="px-4 py-3 sm:px-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-900">{bank.title}</p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                    {bank.classes.length ? `Kelas ${bank.classes.join(', ')}` : 'Kelas belum ditetapkan'}
                                    {bank.generated > 0 ? ` · ${bank.generated} ujian dibangkitkan` : ''}
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {describePASExamSettings(effective).map(label => <span key={label}
                                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${isCustom ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{label}</span>)}
                                </div>
                            </div>
                            <div role="group" aria-label={`Pengaturan ${bank.title}`} className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                                {([[false, 'Ikuti bawaan'], [true, 'Atur khusus']] as const).map(([value, label]) =>
                                    <button key={label} type="button" aria-pressed={isCustom === value} disabled={locked || saving}
                                        onClick={() => setCustom(current => {
                                            const next = { ...current };
                                            if (value) next[bank.id] = current[bank.id] || { ...config.defaults };
                                            else delete next[bank.id];
                                            return next;
                                        })}
                                        className={`rounded-md px-3 py-1.5 transition-colors disabled:cursor-not-allowed ${isCustom === value ? 'bg-white text-[#3083FF] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>)}
                            </div>
                        </div>
                        {isCustom && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/30 p-3 sm:p-4">
                            <PASExamSettingsFields idPrefix={`pas-bank-${bank.id}`} value={custom[bank.id]} disabled={locked || saving}
                                onChange={next => setCustom(current => ({ ...current, [bank.id]: next }))} />
                        </div>}
                    </li>;
                })}</ul>}
        </section>

        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}
        {result && <div role="status" className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
            <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 size={14} />Tersimpan{result.updated ? ` dan diterapkan ke ${result.updated} ujian.` : '. Ujian yang dibangkitkan berikutnya memakai pengaturan ini.'}</p>
            {result.security_locked.length > 0 && <p className="text-amber-800">Pengacakan dan keamanan tidak diubah pada ujian yang sudah dikerjakan siswa: {result.security_locked.join('; ')}.</p>}
            {result.results_locked.length > 0 && <p className="text-amber-800">Nilai/pembahasan belum diubah karena koreksi kunci masih berjalan: {result.results_locked.join('; ')}.</p>}
        </div>}

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <p className="text-[11px] text-slate-500">
                {generated > 0
                    ? `Disimpan langsung ke ${generated} ujian yang sudah dibangkitkan. Pengacakan & keamanan tidak berubah untuk ujian yang sudah dikerjakan.`
                    : 'Berlaku saat jadwal dibangkitkan menjadi ujian.'}
            </p>
            <Button size="sm" onClick={() => void save()} disabled={locked || saving || !dirty} isLoading={saving} leftIcon={<Save size={14} />}>
                Simpan pengaturan
            </Button>
        </div>
    </div>;
}
