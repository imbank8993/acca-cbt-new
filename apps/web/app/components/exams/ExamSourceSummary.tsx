'use client';

import { ExpandableClassList } from '@/app/components/ui/ExpandableClassList';

/** Label ujian semester memuat daftar kelas; ringkas saat ditampilkan di kartu dashboard. */
export function ExamSourceSummary({ label }: { label: string }) {
    const match = /^(ASAS\/ASAT|AM) · Kelas (.+)$/.exec(label);
    if (!match) return <>{label}</>;

    const classes = match[2].split(/,\s*/).map(name => name.replace(/^Kelas\s+/i, '').trim()).filter(Boolean);
    if (classes.length === 0) return <>{label}</>;

    return <>{match[1]} · <ExpandableClassList classes={classes} /></>;
}
