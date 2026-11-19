/**
 * Label ringkas untuk kartu ruang (Monitoring → Per ruang). Murni agar dapat diuji.
 *
 * Nama bank soal hasil bangkitan sering berbentuk "ASAS_2026_BAHASA INGGRIS_XI C,D";
 * untuk pengawas cukup "Bahasa Inggris", karena kelasnya sudah ditulis terpisah.
 */

const GRADE = '(?:VII|VIII|IX|X|XI|XII|\\d{1,2})';
const TRAILING = [
    new RegExp(`\\s+${GRADE}$`, 'i'),
    /\s+[A-Z](?:\s*[,&/]\s*(?:(?:VII|VIII|IX|X|XI|XII)\s+)?[A-Z])*$/,
    /\s*[,&/-]$/,
];
const ACRONYMS = new Set(['PJOK', 'PPKN', 'PKN', 'PKWU', 'TIK', 'IPA', 'IPS', 'PAI', 'SKI', 'BTQ', 'KKA', 'BK', 'SBDP', 'SBK', 'IT']);

function titleCase(text: string): string {
    if (/[a-z]/.test(text)) return text;
    return text.toLowerCase().split(' ').map(word => {
        const upper = word.toUpperCase();
        if (ACRONYMS.has(upper) || /^(VII|VIII|IX|X|XI|XII)$/.test(upper)) return upper;
        return word === 'dan' ? word : word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

/** "ASAS_2026_BAHASA INGGRIS WAJIB XI A & XI B" → "Bahasa Inggris Wajib". */
export function cleanBankTitle(title: string): string {
    const original = String(title || '').trim();
    let text = original
        .replace(/_/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/^\s*(?:ASAS|ASAT|PAS|PAT|AM|PTS|PH)\b[\s-]*(?:\d{4}(?:\s*\/\s*\d{4})?)?[\s-]*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (let guard = 0; guard < 12; guard++) {
        const next = TRAILING.reduce((value, pattern) => value.replace(pattern, ''), text).trim();
        if (next === text) break;
        text = next;
    }
    return titleCase(text || original.replace(/_/g, ' '));
}

/** "X A, X B, X C, X D" → "X A–D"; "XI A, XI C, XII B" → "XI A, C · XII B". */
export function compactClasses(classNames: string): string {
    const byGrade = new Map<string, string[]>();
    const other: string[] = [];
    for (const raw of String(classNames || '').split(',').map(item => item.trim()).filter(Boolean)) {
        const match = /^(VII|VIII|IX|X|XI|XII|\d{1,2})[\s-]*([A-Z0-9]+)$/i.exec(raw);
        if (!match) { if (!other.includes(raw)) other.push(raw); continue; }
        const grade = match[1].toUpperCase();
        const list = byGrade.get(grade) ?? [];
        if (!list.includes(match[2].toUpperCase())) list.push(match[2].toUpperCase());
        byGrade.set(grade, list);
    }
    const parts = [...byGrade.entries()].map(([grade, letters]) => {
        const sorted = [...letters].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
        const single = sorted.every(letter => /^[A-Z]$/.test(letter));
        const consecutive = single && sorted.length > 2 && sorted.every((letter, index) => index === 0 || letter.charCodeAt(0) === sorted[index - 1].charCodeAt(0) + 1);
        return `${grade} ${consecutive ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(', ')}`;
    });
    return [...parts, ...other].join(' · ');
}

export type SessionPhase = 'upcoming' | 'running' | 'done';
/**
 * Status sesi ruang pada waktu sekolah: `today` = "YYYY-MM-DD", `nowTime` = "HH:MM".
 * `minutesLeft` hanya untuk sesi yang sedang berlangsung; `progress` 0–1.
 */
export function sessionStatus(date: string, start: string, end: string, today: string, nowTime: string): {
    phase: SessionPhase; minutesLeft: number | null; progress: number;
} {
    const minutes = (value: string) => { const [h, m] = String(value).slice(0, 5).split(':').map(Number); return h * 60 + m; };
    if (date > today) return { phase: 'upcoming', minutesLeft: null, progress: 0 };
    if (date < today) return { phase: 'done', minutesLeft: null, progress: 1 };
    const now = minutes(nowTime), from = minutes(start), to = minutes(end);
    if (now < from) return { phase: 'upcoming', minutesLeft: null, progress: 0 };
    if (now >= to) return { phase: 'done', minutesLeft: null, progress: 1 };
    return { phase: 'running', minutesLeft: to - now, progress: to > from ? (now - from) / (to - from) : 0 };
}
