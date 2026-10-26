'use client';

import type { ReactNode } from 'react';

/**
 * Daftar pengaturan: satu baris per pengaturan, judul & keterangan di kiri,
 * kontrol (mis. <InlineSelect>) di kanan. Di layar sempit kontrol turun ke
 * bawah judul. Dipakai bersama oleh halaman pengaturan ujian.
 */
export function SettingsList({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
    return <div role="list" aria-label={label} className={`divide-y divide-slate-100 ${className}`.trim()}>{children}</div>;
}

export function SettingsRow({ title, description, children, htmlFor }: {
    title: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    /** id kontrol utama agar judul berfungsi sebagai label. */
    htmlFor?: string;
}) {
    return <div role="listitem" className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
            {htmlFor
                ? <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">{title}</label>
                : <p className="text-sm font-medium text-slate-800">{title}</p>}
            {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>;
}
