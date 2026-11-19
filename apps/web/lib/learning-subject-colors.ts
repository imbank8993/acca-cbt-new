import type { CSSProperties } from 'react';
import { learningKey } from './learning-catalog';

/**
 * Warna kartu bahan ajar per mata pelajaran: semua BAB satu mapel memakai gradasi yang sama,
 * sehingga siswa mengenali mapel dari warnanya. Mapel umum punya warna tetap; mapel lain
 * mendapat warna dari namanya (selalu sama untuk nama yang sama).
 */
export interface SubjectPalette { id: string; hue: number; gradient: string }

const PALETTES: Record<string, SubjectPalette> = {
    blue: { id: 'blue', hue: 232, gradient: 'linear-gradient(125deg,#3b82f6,#4f46e5 58%,#7c3aed)' },
    teal: { id: 'teal', hue: 174, gradient: 'linear-gradient(125deg,#059669,#0d9488 58%,#0891b2)' },
    orange: { id: 'orange', hue: 24, gradient: 'linear-gradient(125deg,#d97706,#ea580c 58%,#e11d48)' },
    green: { id: 'green', hue: 142, gradient: 'linear-gradient(125deg,#16a34a,#15803d 58%,#0f766e)' },
    rose: { id: 'rose', hue: 340, gradient: 'linear-gradient(125deg,#e11d48,#db2777 58%,#c026d3)' },
    violet: { id: 'violet', hue: 270, gradient: 'linear-gradient(125deg,#7c3aed,#9333ea 58%,#c026d3)' },
    sky: { id: 'sky', hue: 205, gradient: 'linear-gradient(125deg,#0ea5e9,#2563eb 58%,#4f46e5)' },
    amber: { id: 'amber', hue: 38, gradient: 'linear-gradient(125deg,#ca8a04,#d97706 58%,#b45309)' },
    brown: { id: 'brown', hue: 20, gradient: 'linear-gradient(125deg,#b45309,#c2410c 58%,#9a3412)' },
    cyan: { id: 'cyan', hue: 190, gradient: 'linear-gradient(125deg,#0891b2,#0e7490 58%,#155e75)' },
    indigo: { id: 'indigo', hue: 245, gradient: 'linear-gradient(125deg,#475569,#4338ca 58%,#6d28d9)' },
};

const SUBJECT_PALETTE: Record<string, keyof typeof PALETTES> = {
    matematika: 'blue', 'matematika peminatan': 'indigo', 'matematika tingkat lanjut': 'indigo',
    fisika: 'teal', kimia: 'orange', biologi: 'green', informatika: 'sky',
    'bahasa indonesia': 'rose', 'bahasa inggris': 'violet', 'bahasa arab': 'amber',
    sejarah: 'brown', geografi: 'cyan', ekonomi: 'amber', sosiologi: 'rose',
};
const FALLBACK = ['blue', 'teal', 'orange', 'green', 'rose', 'violet', 'sky', 'amber', 'brown', 'cyan', 'indigo'] as const;

export function subjectPalette(subject: string): SubjectPalette {
    const key = learningKey(subject);
    const named = SUBJECT_PALETTE[key];
    if (named) return PALETTES[named];
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return PALETTES[FALLBACK[hash % FALLBACK.length]];
}

/** Variabel CSS untuk kartu, banner "Mulai dari sini", dan penanda singkatan mapel. */
export function subjectStyle(subject: string): CSSProperties {
    const palette = subjectPalette(subject);
    return { '--mark-hue': palette.hue, '--lc-grad': palette.gradient } as CSSProperties;
}
