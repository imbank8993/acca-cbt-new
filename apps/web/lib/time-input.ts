/** Format an editable HH:mm draft, rejecting out-of-range segments as typed. */
export function formatTypedTimeDraft(value: string): string | null {
    const text = value.trim();
    if (!text) return '';
    if (!/^\d{1,4}$/.test(text) && !/^\d{1,2}[:.]\d{0,2}$/.test(text)) return null;
    const separated = text.match(/^(\d{1,2})[:.](\d{0,2})$/);
    const hour = separated ? separated[1].padStart(2, '0') : text.slice(0, 2);
    const minute = separated ? separated[2] : text.slice(2);
    if (Number(hour) > 23 || (minute && Number(minute[0]) > 5) || Number(minute) > 59) return null;
    return separated || minute ? `${hour}:${minute}` : hour;
}

/** Accept keyboard-friendly local time; never clamp or silently change invalid hours. */
export function parseTypedTime(value: string): string | null {
    const text = value.trim();
    let hour: string, minute: string;
    const separated = text.match(/^(\d{1,2})[:.](\d{1,2})$/);
    if (separated) [, hour, minute] = separated;
    else if (/^\d{3,4}$/.test(text)) {
        hour = text.slice(0, -2); minute = text.slice(-2);
    } else return null;
    if (Number(hour) > 23 || Number(minute) > 59) return null;
    return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
