'use client';

import type { ReactNode } from 'react';

/**
 * Daftar pengaturan: satu kotak berbatas per pengaturan, judul & keterangan di
 * kiri, kontrol (mis. <InlineSelect>) di kanan. Di layar sempit kontrol turun ke
 * bawah judul. Dipakai bersama oleh halaman pengaturan ujian.
 */
export function SettingsList({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
    return <div role="list" aria-label={label} className={`space-y-3 ${className}`.trim()}>{children}</div>;
}

export function SettingsRow({ title, description, children, htmlFor }: {
    title: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    /** id kontrol utama agar judul berfungsi sebagai label. */
    htmlFor?: string;
}) {
    return <div role="listitem" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
            {htmlFor
                ? <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-900">{title}</label>
                : <p className="text-sm font-semibold text-slate-900">{title}</p>}
            {description && <div className="mt-1 text-xs leading-relaxed text-slate-500">{description}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>;
}
