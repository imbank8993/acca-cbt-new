const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Jakarta';

export function assertValidTimeZone(timeZone: string): string {
    try {
        new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
        return timeZone;
    } catch {
        throw new Error(`Zona waktu IANA tidak valid: ${timeZone}`);
    }
}

function dateParts(date: Date, timeZone: string) {
    const values = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(date)
            .filter(({ type }) => type !== 'literal')
            .map(({ type, value }) => [type, Number(value)]),
    ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
    return values;
}

function localPartsToUtc(
    parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
    timeZone: string,
): string | null {
    assertValidTimeZone(timeZone);
    const localAsUtc = Date.UTC(
        parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
    );
    const check = new Date(localAsUtc);
    if (
        check.getUTCFullYear() !== parts.year ||
        check.getUTCMonth() + 1 !== parts.month ||
        check.getUTCDate() !== parts.day ||
        parts.hour > 23 || parts.minute > 59 || parts.second > 59
    ) {
        return null;
    }

    let utc = localAsUtc;
    for (let attempt = 0; attempt < 4; attempt++) {
        const rendered = dateParts(new Date(utc), timeZone);
        const renderedAsUtc = Date.UTC(
            rendered.year,
            rendered.month - 1,
            rendered.day,
            rendered.hour,
            rendered.minute,
            rendered.second,
        );
        const correction = localAsUtc - renderedAsUtc;
        if (correction === 0) return new Date(utc).toISOString();
        utc += correction;
    }

    return null;
}

/** Convert local wall time in an IANA time zone to a UTC instant. */
export function localDateTimeToUtc(
    value: string | null | undefined,
    timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): string | null {
    if (!value || value.trim() === '') return null;
    const match = value.trim().match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?$/,
    );
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return localPartsToUtc({
            year: Number(year),
            month: Number(month),
            day: Number(day),
            hour: Number(hour),
            minute: Number(minute),
            second: Number(second ?? '0'),
        }, timeZone);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

/** Decode SQL TIME without applying a timezone conversion to the stored clock. */
export function normalizeSqlTime(value: string | Date | null | undefined): string | null {
    // Prisma represents SQL TIME as an epoch Date. Its UTC clock fields encode
    // the wall time; converting them to the school's zone would shift the clock twice.
    const raw = value instanceof Date
        ? (Number.isFinite(value.getTime()) ? value.toISOString() : '') : value?.trim();
    const match = raw?.match(/^(?:\d{4}-\d{2}-\d{2}T)?(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] || 0) > 59) return null;
    return `${match[1]}:${match[2]}:${match[3] || '00'}`;
}

/** Combine SQL DATE/TIME values, including Prisma's ISO representation, into a UTC instant. */
export function dateTimeToUtc(
    date: string | null | undefined,
    time: string | null | undefined,
    timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): string | null {
    if (!date || !time) return null;
    const day = date.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z)?$/)?.[1];
    const clock = normalizeSqlTime(time);
    if (!day || !clock) return null;
    return localDateTimeToUtc(`${day}T${clock}`, timeZone);
}

/** Format a UTC instant as a wall clock time in the configured time zone. */
export function utcToLocalClock(iso: string, timeZone = DEFAULT_SCHOOL_TIME_ZONE): string {
    const values = dateParts(new Date(iso), assertValidTimeZone(timeZone));
    return `${String(values.hour).padStart(2, '0')}:${String(values.minute).padStart(2, '0')}`;
}

export function getSchoolTimeZoneLabel(timeZone: string): string {
    const labels: Record<string, string> = {
        'Asia/Jakarta': 'WIB',
        'Asia/Makassar': 'WITA',
        'Asia/Jayapura': 'WIT',
    };
    return labels[timeZone] || timeZone;
}

export { DEFAULT_SCHOOL_TIME_ZONE };
