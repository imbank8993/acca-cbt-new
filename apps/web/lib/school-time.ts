import { getSettings, type AppConfig } from '@/lib/api/settings';

export const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Makassar';

export const SCHOOL_TIME_ZONES = [
    { value: 'Asia/Jakarta', label: 'WIB — Waktu Indonesia Barat' },
    { value: 'Asia/Makassar', label: 'WITA — Waktu Indonesia Tengah' },
    { value: 'Asia/Jayapura', label: 'WIT — Waktu Indonesia Timur' },
] as const;

export function assertValidSchoolTimeZone(timeZone: string): string {
    try {
        new Intl.DateTimeFormat('id-ID', { timeZone }).format(new Date(0));
        return timeZone;
    } catch {
        throw new Error(`Zona waktu tidak valid: ${timeZone}`);
    }
}

export async function getSchoolTimeZone(): Promise<string> {
    const result = await getSettings();
    if (!result.success) throw new Error(`Gagal membaca zona waktu sekolah: ${result.error}`);
    const appConfigRow = result.settings.find((setting) => setting.key === 'app_config');
    const config = appConfigRow?.value as AppConfig | undefined;
    const timeZone = config?.time_zone || DEFAULT_SCHOOL_TIME_ZONE;
    return assertValidSchoolTimeZone(timeZone);
}

export function getSchoolTimeZoneLabel(timeZone = DEFAULT_SCHOOL_TIME_ZONE): string {
    return SCHOOL_TIME_ZONES.find((zone) => zone.value === timeZone)?.label.split(' — ')[0] || timeZone;
}

export function schoolTodayDate(timeZone = DEFAULT_SCHOOL_TIME_ZONE): string {
    const valueParts = parts(new Date(), {
        year: 'numeric', month: '2-digit', day: '2-digit',
    }, timeZone);
    return `${valueParts.year}-${valueParts.month}-${valueParts.day}`;
}

function parts(date: Date, options: Intl.DateTimeFormatOptions, timeZone: string): Record<string, string> {
    return Object.fromEntries(
        new Intl.DateTimeFormat('id-ID', { timeZone, ...options })
            .formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]),
    );
}

function instant(value: string): Date | null {
    const normalized = /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function formatSchoolDateTime(value: string | null | undefined, timeZone = DEFAULT_SCHOOL_TIME_ZONE): string {
    if (!value) return '-';
    const date = instant(value);
    if (!date) return '-';
    const valueParts = parts(date, {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }, timeZone);
    return `${valueParts.day} ${valueParts.month} ${valueParts.year} ${valueParts.hour}:${valueParts.minute} ${getSchoolTimeZoneLabel(timeZone)}`;
}

export function formatSchoolDate(value: string | null | undefined, timeZone = DEFAULT_SCHOOL_TIME_ZONE): string {
    if (!value) return 'TBA';
    const date = instant(value);
    if (!date) return 'TBA';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone,
        day: 'numeric', month: 'short', year: 'numeric',
    }).format(date);
}

export function formatSchoolTimeRange(
    start: string | null | undefined,
    end: string | null | undefined,
    timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): string {
    if (!start) return 'Kapan saja';
    const startDate = instant(start);
    const endDate = end ? instant(end) : null;
    if (!startDate) return '...';
    const clock = (date: Date) => {
        const valueParts = parts(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, timeZone);
        return `${valueParts.hour}:${valueParts.minute}`;
    };
    return `${clock(startDate)} — ${endDate ? clock(endDate) : '..:..'} ${getSchoolTimeZoneLabel(timeZone)}`;
}

export function utcToSchoolLocalDateTime(value: string, timeZone = DEFAULT_SCHOOL_TIME_ZONE): string {
    const date = instant(value);
    if (!date) return '';
    const valueParts = parts(date, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }, timeZone);
    return `${valueParts.year}-${valueParts.month}-${valueParts.day}T${valueParts.hour}:${valueParts.minute}`;
}

export function schoolLocalDateTimeToUtc(value: string, timeZone = DEFAULT_SCHOOL_TIME_ZONE): string | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    const date = new Date(localAsUtc);
    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() + 1 !== Number(month) ||
        date.getUTCDate() !== Number(day) ||
        Number(hour) > 23 ||
        Number(minute) > 59
    ) return null;

    let utc = localAsUtc;
    for (let attempt = 0; attempt < 4; attempt++) {
        const formatted = parts(new Date(utc), {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }, assertValidSchoolTimeZone(timeZone));
        const asUtc = Date.UTC(
            Number(formatted.year), Number(formatted.month) - 1, Number(formatted.day),
            Number(formatted.hour), Number(formatted.minute), Number(formatted.second),
        );
        const correction = localAsUtc - asUtc;
        if (correction === 0) return new Date(utc).toISOString();
        utc += correction;
    }
    return null;
}
