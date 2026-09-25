export const SCHOOL_TIME_ZONE = 'Asia/Jakarta';
export const SCHOOL_TIME_ZONE_LABEL = 'WIB';

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
    return Object.fromEntries(
        new Intl.DateTimeFormat('id-ID', { timeZone: SCHOOL_TIME_ZONE, ...options })
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

export function formatSchoolDateTime(value: string | null | undefined): string {
    if (!value) return '-';
    const date = instant(value);
    if (!date) return '-';
    const valueParts = parts(date, {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return `${valueParts.day} ${valueParts.month} ${valueParts.year} ${valueParts.hour}:${valueParts.minute} ${SCHOOL_TIME_ZONE_LABEL}`;
}

export function formatSchoolDate(value: string | null | undefined): string {
    if (!value) return 'TBA';
    const date = instant(value);
    if (!date) return 'TBA';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: SCHOOL_TIME_ZONE,
        day: 'numeric', month: 'short', year: 'numeric',
    }).format(date);
}

export function formatSchoolTimeRange(
    start: string | null | undefined,
    end: string | null | undefined,
): string {
    if (!start) return 'Kapan saja';
    const startDate = instant(start);
    const endDate = end ? instant(end) : null;
    if (!startDate) return '...';
    const clock = (date: Date) => {
        const valueParts = parts(date, { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${valueParts.hour}:${valueParts.minute}`;
    };
    return `${clock(startDate)} — ${endDate ? clock(endDate) : '..:..'} ${SCHOOL_TIME_ZONE_LABEL}`;
}
