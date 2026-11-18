'use client';

import { ExpandableClassList } from '@/app/components/ui/ExpandableClassList';

/** Ringkasan dashboard menampilkan mapel dan kelas tanpa mengulang jenis asesmen pada judul. */
export function ExamSourceSummary({ label, subject }: { label: string; subject?: string | null }) {
    const subjectName = subject?.trim();
    const match = /^(ASAS\/ASAT|AM)(?: · Kelas (.+))?$/.exec(label);
    if (!match) {
        if (!subjectName) return <>{label}</>;
        return <>{subjectName}{label && label !== subjectName ? ` · ${label}` : ''}</>;
    }

    const classes = (match[2] || '').split(/,\s*/).map(name => name.replace(/^Kelas\s+/i, '').trim()).filter(Boolean);
    return <>{subjectName || 'Mapel belum tercatat'}{classes.length > 0 && <> · <ExpandableClassList classes={classes} /></>}</>;
}
