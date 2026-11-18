'use client';

import Image from 'next/image';
import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { resolveStorageUrl } from '@/lib/safe-url';

/** Warna lembut per mapel (stabil per nama), dipakai bila bank soal tidak punya cover. */
const TONES = [
    'from-sky-100 to-blue-100 text-blue-600 dark:from-sky-500/20 dark:to-blue-500/20 dark:text-sky-300',
    'from-violet-100 to-fuchsia-100 text-violet-600 dark:from-violet-500/20 dark:to-fuchsia-500/20 dark:text-violet-300',
    'from-emerald-100 to-teal-100 text-emerald-600 dark:from-emerald-500/20 dark:to-teal-500/20 dark:text-emerald-300',
    'from-amber-100 to-orange-100 text-amber-600 dark:from-amber-500/20 dark:to-orange-500/20 dark:text-amber-300',
    'from-rose-100 to-pink-100 text-rose-600 dark:from-rose-500/20 dark:to-pink-500/20 dark:text-rose-300',
];

function tone(seed: string): string {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return TONES[hash % TONES.length];
}

/**
 * Sampul ujian di halaman siswa: cover bank soal yang dipakai ujian, atau ubin
 * lembut berisi huruf awal mapel bila cover belum ada / gagal dimuat.
 */
export function StudentExamCover({ cover, title, subject, size = 52, className = '' }: {
    cover?: string | null; title: string; subject?: string | null; size?: number; className?: string;
}) {
    const src = resolveStorageUrl(cover || '');
    const [failed, setFailed] = useState('');
    const box = `relative shrink-0 overflow-hidden rounded-2xl ring-1 ring-black/5 dark:ring-white/10 ${className}`;
    if (src && failed !== src) {
        return <span className={box} style={{ width: size, height: size }}>
            <Image src={src} alt={`Sampul ${subject || title}`} width={size * 2} height={size * 2} unoptimized
                className="h-full w-full object-cover" onError={() => setFailed(src)} />
        </span>;
    }
    const label = (subject || '').trim();
    return <span aria-hidden="true" className={`${box} flex items-center justify-center bg-gradient-to-br ${tone(label || title)}`}
        style={{ width: size, height: size }}>
        {label ? <span className="text-lg font-black">{label.charAt(0).toUpperCase()}</span> : <BookOpen size={Math.round(size * 0.38)} />}
    </span>;
}

/** Label mapel yang lembut (terang & gelap). */
export function SubjectPill({ subject }: { subject?: string | null }) {
    if (!subject) return null;
    return <span className="inline-flex max-w-full items-center truncate rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
        {subject}
    </span>;
}
