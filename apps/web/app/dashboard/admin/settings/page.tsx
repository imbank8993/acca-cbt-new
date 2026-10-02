'use client';

import { Spinner } from '@/app/components/ui/Spinner';
import { getSettings, type AppConfig } from '@/lib/api/settings';
import { DEFAULT_SCHOOL_TIME_ZONE, SCHOOL_TIME_ZONES, assertValidSchoolTimeZone } from '@/lib/school-time';
import {
    CalendarDays,
    CheckCircle2,
    Clock3,
    ExternalLink,
    FileText,
    MonitorPlay,
    RefreshCw,
    ShieldCheck,
    Timer,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const ACCA_URL = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id';

export default function GeneralSettingsPage() {
    const [timeZone, setTimeZone] = useState(DEFAULT_SCHOOL_TIME_ZONE);
    const [source, setSource] = useState<'site_settings' | 'app_config' | 'default'>('site_settings');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [currentTimeString, setCurrentTimeString] = useState('');
    const [currentDateString, setCurrentDateString] = useState('');

    const fetchConfig = useCallback(async (isManualRefresh = false) => {
        if (isManualRefresh) {
            setIsRefreshing(true);
            setError('');
            setSuccess('');
        }
        try {
            const result = await getSettings({ refresh: true });
            if (!result.success) {
                setError(`Pengaturan umum gagal dimuat: ${result.error}`);
                return;
            }
            const stored = result.settings.find((setting) => setting.key === 'app_config')?.value;
            const config = stored && typeof stored === 'object' && !Array.isArray(stored)
                ? (stored as AppConfig)
                : {};
            const zone = assertValidSchoolTimeZone(config.time_zone || DEFAULT_SCHOOL_TIME_ZONE);
            setTimeZone(zone);
            setSource(config.time_zone_source || 'site_settings');
            if (isManualRefresh) {
                setSuccess('Status sinkronisasi berhasil disegarkan.');
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Zona waktu tersimpan tidak valid.');
        } finally {
            setIsLoading(false);
            if (isManualRefresh) setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void fetchConfig(false);
    }, [fetchConfig]);

    // Live clock update according to school timezone
    useEffect(() => {
        const updateClock = () => {
            try {
                const now = new Date();
                const timeStr = new Intl.DateTimeFormat('id-ID', {
                    timeZone,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hourCycle: 'h23',
                }).format(now);

                const dateStr = new Intl.DateTimeFormat('id-ID', {
                    timeZone,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                }).format(now);

                setCurrentTimeString(timeStr);
                setCurrentDateString(dateStr);
            } catch {
                // Ignore invalid formatting errors during transition
            }
        };

        updateClock();
        const interval = setInterval(updateClock, 1000);
        return () => clearInterval(interval);
    }, [timeZone]);

    const activeZoneOption = SCHOOL_TIME_ZONES.find((z) => z.value === timeZone);
    const zoneShortLabel = activeZoneOption?.label.split(' — ')[0] || timeZone;
    const zoneFullLabel = activeZoneOption?.label.split(' — ')[1] || activeZoneOption?.label || timeZone;

    return (
        <section className="mx-auto max-w-4xl space-y-6">
            <header>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Pengaturan Umum & Zona Waktu</h1>
                        <p className="mt-1 text-sm text-slate-500">
                            Pengaturan acuan sekolah tersinkronisasi otomatis dari ACCA Utama.
                        </p>
                    </div>
                    <div className="mt-2 flex items-center gap-2 sm:mt-0">
                        <button
                            type="button"
                            onClick={() => void fetchConfig(true)}
                            disabled={isLoading || isRefreshing}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-primary' : ''} />
                            Segarkan
                        </button>
                    </div>
                </div>
            </header>

            {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                </div>
            )}
            {success && (
                <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    {success}
                </div>
            )}

            {/* Main Sync Status Card */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50/50 p-5 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3.5">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <Clock3 size={24} />
                            </span>
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-base font-bold text-slate-900">Zona Waktu Sekolah</h2>
                                    {source === 'site_settings' ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            Tersinkronisasi Terpusat (ACCA Utama)
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                                            Fallback Konfigurasi
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                    Digunakan oleh seluruh jadwal ujian, pembukaan sesi ruangan, countdown pengerjaan, dan riwayat siswa.
                                </p>
                            </div>
                        </div>

                        {/* Live Clock Display */}
                        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm sm:text-right">
                            <div className="text-xs font-medium text-slate-400">Jam Sekolah Saat Ini</div>
                            <div className="font-mono text-xl font-bold tracking-tight text-slate-900">
                                {currentTimeString || '--:--:--'} <span className="text-sm font-semibold text-primary">{zoneShortLabel}</span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                                {currentDateString || 'Memuat...'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-5 sm:p-6 space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                            <div className="text-xs font-medium text-slate-500">Wilayah Waktu Terdaftar</div>
                            <div className="mt-1 text-base font-bold text-slate-800">
                                {zoneShortLabel} — {zoneFullLabel}
                            </div>
                            <div className="mt-0.5 font-mono text-xs text-slate-500">
                                Identifier IANA: {timeZone}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                            <div className="text-xs font-medium text-slate-500">Sumber Konfigurasi</div>
                            <div className="mt-1 text-base font-bold text-slate-800">
                                {source === 'site_settings' ? 'Tabel site_settings (ACCA Utama)' : 'Default Basis Aplikasi'}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                                Mengikuti pengaturan sekolah di database bersama (<code className="rounded bg-slate-200/70 px-1 py-0.5 text-[11px]">acca_db</code>)
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-xs text-blue-900 leading-relaxed">
                        <div className="flex items-start gap-2.5">
                            <ShieldCheck size={18} className="shrink-0 text-blue-600 mt-0.5" />
                            <div>
                                <p className="font-semibold text-blue-950">Prinsip Satu Sumber Data (Single Source of Truth)</p>
                                <p className="mt-1 text-blue-800/90">
                                    Zona waktu dikelola secara terpusat dari modul <strong>Pengaturan Umum di ACCA Utama</strong>. Anda tidak perlu menyetel zona waktu dua kali. Jika ada perubahan wilayah waktu sekolah di ACCA Utama, sistem ACCA CBT akan otomatis menyelaraskannya secara instan.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100">
                        <span className="text-xs text-slate-500">
                            Ingin mengubah zona waktu sekolah? Lakukan melalui menu Pengaturan Umum di ACCA Utama.
                        </span>
                        <a
                            href={`${ACCA_URL}/pengaturan-umum`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
                        >
                            <ExternalLink size={15} />
                            Buka Pengaturan di ACCA Utama
                        </a>
                    </div>
                </div>
            </div>

            {/* Detail Cakupan Modul CBT */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">
                    Ruang Lingkup Penggunaan Zona Waktu di ACCA CBT
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex items-start gap-3 rounded-lg border border-slate-100 p-3.5 transition hover:border-slate-200">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                            <CalendarDays size={16} />
                        </span>
                        <div>
                            <div className="text-xs font-semibold text-slate-800">Jadwal & Sesi Ruangan PAS/Ujian</div>
                            <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
                                Jam mulai dan batas tutup ruangan (<code className="text-[10px]">window_end_time</code>) dikonversi dan divalidasi presisi mengikuti jam lokal sekolah.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-lg border border-slate-100 p-3.5 transition hover:border-slate-200">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                            <Timer size={16} />
                        </span>
                        <div>
                            <div className="text-xs font-semibold text-slate-800">Pengerjaan & Countdown Siswa</div>
                            <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
                                Peringatan pembukaan window ujian dan durasi pengerjaan siswa terhitung konsisten tanpa risiko perbedaan offset perangkat klien.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-lg border border-slate-100 p-3.5 transition hover:border-slate-200">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                            <MonitorPlay size={16} />
                        </span>
                        <div>
                            <div className="text-xs font-semibold text-slate-800">Monitoring & Log Presensi</div>
                            <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
                                Waktu login siswa, autosave jawaban berkala, dan waktu selesai tersimpan sebagai UTC absolut dan disajikan dalam jam sekolah.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-lg border border-slate-100 p-3.5 transition hover:border-slate-200">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                            <FileText size={16} />
                        </span>
                        <div>
                            <div className="text-xs font-semibold text-slate-800">Berita Acara & Kartu Peserta</div>
                            <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
                                Dokumen resmi berita acara ujian dan kartu tes otomatis mencantumkan label zona waktu sekolah ({zoneShortLabel}).
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
