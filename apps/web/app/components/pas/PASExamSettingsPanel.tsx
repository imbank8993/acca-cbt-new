"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Lock } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { InlineSelect } from '@/app/components/ui/inlineselect';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/app/components/ui/modal';
import { SettingsList, SettingsRow } from '@/app/components/ui/settings-list';
import type { PASPeriod } from '@/app/types/pas';
import { mergePASExamsAction, updatePASExamSettingsAction } from '@/lib/api/pas';
import {
    bankOverride,
    COMPLEX_SCORING_CHOICES,
    describePASExamSettings,
    mergeableExamGroups,
    ORDER_CHOICES,
    orderChoice,
    pasExamSettingsConfig,
    resolvePASExamSettings,
    RESULTS_CHOICES,
    resultsChoice,
    SAFETY_CHOICES,
    safetyChoice,
    SCORING_CHOICES,
    withOrderChoice,
    withResultsChoice,
    withSafetyChoice,
    type OrderChoice,
    type PASComplexScoringRule,
    type PASExamSettings,
    type PASExamSettingsConfig,
    type PASExamSettingsSaveResult,
    type PASScoringModel,
    type ResultsChoice,
    type SafetyChoice,
} from '@/lib/pas/exam-settings';

interface BankRow {
    id: string;
    title: string;
    classes: string[];
    generated: number;
}

/** Bank soal yang dijadwalkan di folder, dengan kelas dan jumlah jadwal yang sudah dibangkitkan. */
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

/** Enam baris pengaturan, sama untuk bawaan folder dan pengaturan khusus bank soal. */
export function PASExamSettingsFields({ idPrefix, value, onChange, disabled }: {
    idPrefix: string; value: PASExamSettings; onChange: (next: PASExamSettings) => void; disabled?: boolean;
}) {
    const safety = safetyChoice(value);
    return <SettingsList label="Pengaturan ujian">
        <SettingsRow htmlFor={`${idPrefix}-scoring`} title="Penilaian"
            description="IRT dihitung dari seluruh peserta yang mengerjakan bank soal ini.">
            <InlineSelect id={`${idPrefix}-scoring`} value={value.scoring} disabled={disabled} minWidth="220px"
                onChange={next => onChange({ ...value, scoring: next as PASScoringModel })}
                options={SCORING_CHOICES.map(({ value: v, label }) => ({ value: v, label }))} />
        </SettingsRow>
        <SettingsRow htmlFor={`${idPrefix}-complex`} title="Skor Benar-Salah & Kategorisasi"
            description="Utuh: ≤ 5 pernyataan harus benar semua; > 5 pernyataan salah 1–2 dapat setengah skor. Terkunci setelah ada siswa yang mengerjakan.">
            <InlineSelect id={`${idPrefix}-complex`} value={value.complex_scoring} disabled={disabled} minWidth="220px"
                onChange={next => onChange({ ...value, complex_scoring: next as PASComplexScoringRule })}
                options={COMPLEX_SCORING_CHOICES.map(({ value: v, label }) => ({ value: v, label }))} />
        </SettingsRow>
        <SettingsRow htmlFor={`${idPrefix}-results`} title="Hasil untuk siswa"
            description="Pembahasan terbuka setelah semua sesi selesai dan nilai final.">
            <InlineSelect id={`${idPrefix}-results`} value={resultsChoice(value)} disabled={disabled} minWidth="220px"
                onChange={next => onChange(withResultsChoice(value, next as ResultsChoice))}
                options={RESULTS_CHOICES.map(({ value: v, label }) => ({ value: v, label }))} />
        </SettingsRow>
        <SettingsRow htmlFor={`${idPrefix}-order`} title="Urutan soal">
            <InlineSelect id={`${idPrefix}-order`} value={orderChoice(value)} disabled={disabled} minWidth="220px"
                onChange={next => onChange(withOrderChoice(value, next as OrderChoice))}
                options={ORDER_CHOICES.map(({ value: v, label }) => ({ value: v, label }))} />
        </SettingsRow>
        <SettingsRow htmlFor={`${idPrefix}-safety`} title="Mode aman"
            description="Pelanggaran: keluar layar penuh, pindah tab, atau membuka aplikasi lain.">
            {safety === 'limit' && <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="number" min={1} max={100} step={1} aria-label="Batas jumlah pelanggaran" disabled={disabled}
                    value={value.max_violations ?? 3}
                    onChange={event => onChange({ ...value, max_violations: Math.max(1, Math.min(100, Math.round(Number(event.target.value)) || 1)) })}
                    className="h-[34px] w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm disabled:opacity-50" />
                kali
            </label>}
            <InlineSelect id={`${idPrefix}-safety`} value={safety} disabled={disabled} minWidth="220px"
                onChange={next => onChange(withSafetyChoice(value, next as SafetyChoice))}
                options={SAFETY_CHOICES.map(({ value: v, label }) => ({ value: v, label }))} />
        </SettingsRow>
        <SettingsRow htmlFor={`${idPrefix}-screenshot`} title="Screenshot pelanggaran"
            description="Siswa wajib berbagi layar penuh; gambar kejadian tertentu disimpan 7 hari.">
            <InlineSelect id={`${idPrefix}-screenshot`} value={value.screenshot_enabled ? 'on' : 'off'} disabled={disabled} minWidth="220px"
                onChange={next => onChange({ ...value, screenshot_enabled: next === 'on' })}
                options={[{ value: 'off', label: 'Nonaktif' }, { value: 'on', label: 'Aktif' }]} />
        </SettingsRow>
    </SettingsList>;
}

/**
 * Tab "Pengaturan Ujian" folder ASAS/ASAT/AM: satu daftar pengaturan bawaan,
 * tabel bank soal dengan pengaturan khusus di dialog, dan penggabungan ujian
 * per bank soal untuk folder lama.
 */
export function PASExamSettingsPanel({ period, onSaved, onReload }: {
    period: PASPeriod;
    onSaved: (config: PASExamSettingsConfig) => void;
    onReload?: () => void;
}) {
    const initial = useMemo(() => pasExamSettingsConfig(period), [period]);
    const banks = useMemo(() => folderBanks(period), [period]);
    const mergeable = useMemo(() => mergeableExamGroups(period.pas_class_schedules || []), [period]);
    const [config, setConfig] = useState<PASExamSettingsConfig>(initial);
    const [custom, setCustom] = useState<Record<string, PASExamSettings>>(() => Object.fromEntries(
        Object.keys(initial.banks).map(bankId => [bankId, resolvePASExamSettings(initial, bankId)])));
    const [editing, setEditing] = useState<BankRow | null>(null);
    const [draft, setDraft] = useState<PASExamSettings | null>(null);
    const [saving, setSaving] = useState(false);
    const [merging, setMerging] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState<{ title: string; lines: string[] } | null>(null);
    const locked = (period.is_locked || period.canManage === false);

    const payload = useMemo(() => ({
        defaults: config.defaults,
        banks: Object.fromEntries(Object.entries(custom)
            .filter(([bankId]) => banks.some(bank => bank.id === bankId))
            .map(([bankId, settings]) => [bankId, bankOverride(config.defaults, settings)] as const)
            .filter(([, override]) => Object.keys(override).length > 0)
            .sort(([a], [b]) => a.localeCompare(b))),
    }), [config.defaults, custom, banks]);
    const initialPayload = useMemo(() => ({
        defaults: initial.defaults,
        banks: Object.fromEntries(Object.entries(initial.banks).sort(([a], [b]) => a.localeCompare(b))),
    }), [initial]);
    const dirty = JSON.stringify(payload) !== JSON.stringify(initialPayload);

    const reset = () => {
        setConfig(initial);
        setCustom(Object.fromEntries(Object.keys(initial.banks).map(bankId => [bankId, resolvePASExamSettings(initial, bankId)])));
        setError('');
    };

    const save = async () => {
        setSaving(true);
        setError('');
        setNotice(null);
        const response = await updatePASExamSettingsAction(period.id, payload);
        setSaving(false);
        if (!response.success) {
            setError(response.error || 'Pengaturan ujian belum berhasil disimpan.');
            return;
        }
        const result: PASExamSettingsSaveResult = response;
        setConfig(result.exam_settings);
        setCustom(Object.fromEntries(Object.keys(result.exam_settings.banks)
            .map(bankId => [bankId, resolvePASExamSettings(result.exam_settings, bankId)])));
        setNotice({
            title: result.updated ? `Tersimpan dan diterapkan ke ${result.updated} ujian.` : 'Tersimpan. Ujian yang dibangkitkan berikutnya memakai pengaturan ini.',
            lines: [
                ...(result.security_locked.length ? [`Urutan dan keamanan tidak diubah pada ujian yang sudah dikerjakan: ${result.security_locked.join('; ')}.`] : []),
                ...(result.scoring_rule_locked?.length ? [`Aturan skor Benar-Salah/Kategorisasi tidak diubah pada ujian yang sudah dikerjakan: ${result.scoring_rule_locked.join('; ')}.`] : []),
                ...(result.results_locked.length ? [`Hasil dan penilaian belum diubah karena koreksi kunci masih berjalan: ${result.results_locked.join('; ')}.`] : []),
            ],
        });
        onSaved(result.exam_settings);
    };

    const merge = async () => {
        setMerging(true);
        setError('');
        setNotice(null);
        const response = await mergePASExamsAction(period.id);
        setMerging(false);
        if (!response.success) {
            setError(response.error || 'Ujian belum berhasil digabungkan.');
            return;
        }
        setNotice({
            title: response.merged
                ? `${response.merged} ujian per kelas digabung menjadi ${response.groups} ujian per bank soal.`
                : 'Tidak ada ujian yang dapat digabung.',
            lines: response.kept_separate.length
                ? [`Tetap terpisah karena sudah dikerjakan siswa: ${response.kept_separate.join('; ')}. Hasil dan analisisnya tetap digabung per bank soal di tab Hasil.`]
                : [],
        });
        onReload?.();
    };

    const openBank = (bank: BankRow) => {
        setEditing(bank);
        setDraft(custom[bank.id] || { ...config.defaults });
    };
    const closeBank = () => { setEditing(null); setDraft(null); };
    const applyBank = (value: PASExamSettings | null) => {
        if (!editing) return;
        setCustom(current => {
            const next = { ...current };
            if (value && Object.keys(bankOverride(config.defaults, value)).length) next[editing.id] = value;
            else delete next[editing.id];
            return next;
        });
        closeBank();
    };

    return <div className="pas-exam-settings space-y-4">
        {locked && <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <Lock size={14} className="mt-0.5 shrink-0" />{period.canManage === false ? 'Mode lihat saja. Anda tidak memiliki izin mengubah pengaturan folder ini.' : 'Folder terkunci. Buka kunci folder untuk mengubah pengaturan ujian.'}
        </div>}

        {mergeable > 0 && !locked && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5 text-xs text-blue-900">
                <Layers size={16} className="mt-0.5 shrink-0 text-blue-600" />
                <p><span className="font-semibold">{mergeable} bank soal masih terpecah per kelas.</span> Gabungkan agar monitoring, hasil, dan IRT dihitung per bank soal. Ujian yang sudah dikerjakan tetap terpisah.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void merge()} isLoading={merging} disabled={merging || saving}>Gabungkan</Button>
        </div>}

        <section aria-labelledby="pas-settings-defaults" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <h3 id="pas-settings-defaults" className="text-sm font-bold text-slate-900">Pengaturan bawaan</h3>
            <p className="mb-4 mt-0.5 text-xs text-slate-500">Berlaku untuk semua bank soal, kecuali yang diatur khusus.</p>
            <PASExamSettingsFields idPrefix="pas-default" value={config.defaults} disabled={locked || saving}
                onChange={next => setConfig(current => ({ ...current, defaults: next }))} />
        </section>

        <section aria-labelledby="pas-settings-banks" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="px-4 pt-4 sm:px-5">
                <h3 id="pas-settings-banks" className="text-sm font-bold text-slate-900">Bank soal</h3>
                <p className="mt-0.5 text-xs text-slate-500">Atur khusus bila aturan sebuah bank soal berbeda, misalnya hanya Matematika yang dibuka pembahasannya.</p>
            </div>
            {banks.length === 0 ? <p className="px-5 py-10 text-center text-xs text-slate-500">Belum ada bank soal yang dijadwalkan di folder ini.</p>
                : <div className="mt-3 overflow-x-auto"><table className="pas-exam-settings__banks w-full min-w-[560px] text-left text-xs">
                    <thead className="border-y border-slate-100 bg-slate-50/70 text-[11px] text-slate-500">
                        <tr><th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">Bank soal</th><th scope="col" className="px-3 py-2.5 font-semibold">Aturan</th><th scope="col" className="px-4 py-2.5 sm:px-5"><span className="sr-only">Tindakan</span></th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">{banks.map(bank => {
                        const isCustom = Boolean(custom[bank.id]);
                        return <tr key={bank.id} className="align-top">
                            <td className="px-4 py-3 sm:px-5">
                                <p className="font-semibold text-slate-900">{bank.title}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">{bank.classes.length ? `Kelas ${bank.classes.join(', ')}` : 'Kelas belum ditetapkan'}</p>
                            </td>
                            <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-1">
                                    {isCustom && <span className="rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Khusus</span>}
                                    {describePASExamSettings(custom[bank.id] || config.defaults).map(label => <span key={label}
                                        className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">{label}</span>)}
                                </div>
                            </td>
                            <td className="px-4 py-3 text-right sm:px-5">
                                <Button size="sm" variant="outline" onClick={() => openBank(bank)} disabled={locked || saving}>Atur</Button>
                            </td>
                        </tr>;
                    })}</tbody>
                </table></div>}
        </section>

        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}
        {notice && <div role="status" className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
            <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 size={14} />{notice.title}</p>
            {notice.lines.map(line => <p key={line} className="text-amber-800">{line}</p>)}
        </div>}

        {dirty && !locked && <div className="pas-exam-settings__save sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <p className="text-xs text-slate-600">Ada perubahan yang belum disimpan.</p>
            <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={reset} disabled={saving}>Batalkan</Button>
                <Button size="sm" onClick={() => void save()} disabled={saving} isLoading={saving}>Simpan</Button>
            </div>
        </div>}

        <Modal open={Boolean(editing && draft)} onClose={closeBank} size="lg" labelledBy="pas-bank-settings-title">
            {editing && draft && <>
                <ModalHeader id="pas-bank-settings-title" title={editing.title}
                    subtitle={editing.classes.length ? `Kelas ${editing.classes.join(', ')}` : undefined} onClose={closeBank} />
                <ModalBody>
                    <PASExamSettingsFields idPrefix={`pas-bank-${editing.id}`} value={draft} onChange={setDraft} />
                </ModalBody>
                <ModalFooter align="between">
                    <Button variant="outline" onClick={() => applyBank(null)} disabled={!custom[editing.id]}>Ikuti bawaan</Button>
                    <Button onClick={() => applyBank(draft)}>Terapkan</Button>
                </ModalFooter>
            </>}
        </Modal>
    </div>;
}
