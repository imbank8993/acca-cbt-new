"use client";

import { useState, type ReactNode } from 'react';

interface AttemptAnalyticsHeaderProps {
    examTitle: string;
    attemptId: string;
    studentName: string;
    avatarUrl?: string | null;
    children?: ReactNode;
}

export function AttemptAnalyticsHeader({ examTitle, attemptId, studentName, avatarUrl, children }: AttemptAnalyticsHeaderProps) {
    const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
    const initials = studentName.split(/\s+/).filter(Boolean).slice(0, 2).map(name => name[0]).join('').toUpperCase();

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs mb-6 px-6 py-5">
            <div className="flex items-center justify-between gap-4 sm:gap-6">
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800">Detail Analitik</h1>
                    <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-500">
                        <span className="truncate" title={examTitle}>{examTitle}</span>
                        <span aria-hidden="true">|</span>
                        <span className="shrink-0" title={attemptId}>{attemptId.split('-')[0]}</span>
                    </p>
                </div>
                <div className="flex max-w-[45%] shrink-0 items-center justify-end gap-3">
                    <span className="min-w-0 break-words text-right text-sm font-semibold text-slate-700">{studentName}</span>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 text-sm font-semibold text-[#3083FF]">
                        {avatarUrl && failedAvatar !== avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- Profile photos can use external school URLs.
                            <img src={avatarUrl} alt={`Foto profil ${studentName}`} className="h-full w-full object-cover" onError={() => setFailedAvatar(avatarUrl)} />
                        ) : (
                            <span aria-label={`Profil ${studentName}`}>{initials}</span>
                        )}
                    </div>
                </div>
            </div>
            {children}
        </div>
    );
}
