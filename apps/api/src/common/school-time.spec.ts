import { DEFAULT_SCHOOL_TIME_ZONE, dateTimeToUtc, localDateTimeToUtc, utcToLocalClock } from './school-time';

describe('school timezone conversions', () => {
    it('converts the same wall clock time to the correct UTC instant for each Indonesian zone', () => {
        expect(localDateTimeToUtc('2026-10-01T09:00', 'Asia/Jakarta')).toBe('2026-10-01T02:00:00.000Z');
        expect(localDateTimeToUtc('2026-10-01T09:00', 'Asia/Makassar')).toBe('2026-10-01T01:00:00.000Z');
        expect(localDateTimeToUtc('2026-10-01T09:00', 'Asia/Jayapura')).toBe('2026-10-01T00:00:00.000Z');
    });

    it('defaults to the school timezone in Gowa when no setting exists', () => {
        expect(DEFAULT_SCHOOL_TIME_ZONE).toBe('Asia/Makassar');
        expect(localDateTimeToUtc('2026-10-01T09:00')).toBe('2026-10-01T01:00:00.000Z');
    });

    it('round-trips generated exam schedule dates and formats local clocks', () => {
        const start = dateTimeToUtc('2026-10-01', '08:15', 'Asia/Makassar');
        expect(start).toBe('2026-10-01T00:15:00.000Z');
        expect(utcToLocalClock(start!, 'Asia/Makassar')).toBe('08:15');
    });

    it('rejects invalid local dates and invalid IANA timezone names', () => {
        expect(localDateTimeToUtc('2026-02-30T09:00', 'Asia/Makassar')).toBeNull();
        expect(() => localDateTimeToUtc('2026-10-01T09:00', 'WITA')).toThrow();
    });
});
