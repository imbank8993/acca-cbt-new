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
