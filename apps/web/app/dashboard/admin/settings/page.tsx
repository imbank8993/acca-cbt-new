'use client';

import { InlineSelect } from '@/components/ui/InlineSelect';
import { Spinner } from '@/app/components/ui/Spinner';
import { getSettings, updateSetting, type AppConfig } from '@/lib/api/settings';
import { DEFAULT_SCHOOL_TIME_ZONE, SCHOOL_TIME_ZONES, assertValidSchoolTimeZone } from '@/lib/school-time';
import { Check, Clock3, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function GeneralSettingsPage() {
    const [timeZone, setTimeZone] = useState(DEFAULT_SCHOOL_TIME_ZONE);
    const [initialTimeZone, setInitialTimeZone] = useState(DEFAULT_SCHOOL_TIME_ZONE);
    const [appConfig, setAppConfig] = useState<AppConfig>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let active = true;
        void (async () => {
            const result = await getSettings({ refresh: true });
            if (!active) return;
            if (!result.success) {
                setError(`Pengaturan umum gagal dimuat: ${result.error}`);
                setIsLoading(false);
                return;
            }
            const stored = result.settings.find((setting) => setting.key === 'app_config')?.value;
            const config = stored && typeof stored === 'object' && !Array.isArray(stored)
                ? stored as AppConfig
                : {};
            try {
                const zone = assertValidSchoolTimeZone(config.time_zone || DEFAULT_SCHOOL_TIME_ZONE);
                setAppConfig(config);
                setTimeZone(zone);
                setInitialTimeZone(zone);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : 'Zona waktu tersimpan tidak valid.');
            }
            setIsLoading(false);
        })();
        return () => { active = false; };
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        setSuccess('');
        try {
            assertValidSchoolTimeZone(timeZone);
            const result = await updateSetting('app_config', { ...appConfig, time_zone: timeZone });
            if (!result.success) {
                setError(`Zona waktu gagal disimpan: ${result.error}`);
                return;
            }
            setAppConfig((current) => ({ ...current, time_zone: timeZone }));
            setInitialTimeZone(timeZone);
            setSuccess('Zona waktu sekolah berhasil disimpan.');
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Zona waktu gagal disimpan.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className="mx-auto max-w-3xl space-y-6">
            <header>
                <h1 className="text-xl font-bold text-slate-900">Pengaturan Umum</h1>
                <p className="mt-1 text-sm text-slate-500">Atur zona waktu acuan sekolah untuk jadwal ujian.</p>
            </header>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Clock3 size={19} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold text-slate-800">Zona waktu sekolah</h2>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            Dipakai saat memasukkan, menampilkan, dan memeriksa jadwal ujian. Waktu tetap disimpan sebagai UTC.
                        </p>
                        <div className="mt-4 max-w-sm">
                            {isLoading ? (
                                <div className="flex h-[38px] items-center"><Spinner /></div>
                            ) : (
                                <InlineSelect
                                    value={timeZone}
                                    onChange={(value) => {
                                        setTimeZone(value);
                                        setSuccess('');
                                    }}
                                    options={[...SCHOOL_TIME_ZONES]}
                                    minWidth="240px"
                                    height="38px"
                                    disabled={isSaving}
                                />
                            )}
                        </div>
                        <p className="mt-3 text-xs text-slate-500">
                            Perubahan zona waktu mengubah tampilan jam lokal. Jadwal yang sudah tersimpan mempertahankan waktu absolutnya.
                        </p>
                    </div>
                </div>

                {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                {success && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700"><Check size={15} />{success}</p>}

                <div className="mt-6 flex justify-end border-t border-slate-100 pt-4">
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={isLoading || isSaving || timeZone === initialTimeZone}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isSaving ? <Spinner /> : <Save size={15} />}
                        Simpan Pengaturan
                    </button>
                </div>
            </div>
        </section>
    );
}
