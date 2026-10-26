'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PASSlotMonitoring from '@/app/components/monitoring/PASSlotMonitoring';
import { ParticipantSummaryLine, ParticipantsWorkspace, WorkspaceError } from '@/app/components/monitoring/ParticipantsWorkspace';
import { REFRESH_INTERVAL, useAutoRefresh } from '@/hooks/useAutoRefresh';
import { getExamAttemptsAction, type ExamAttemptRecord } from '@/lib/api/proctor';
import type { FolderExamGroup } from '@/lib/monitoring-folder';
import { folderExamParts } from '@/lib/monitoring-exams';

export type FolderMonitorRole = 'admin' | 'proktor' | 'guru';
export type FolderMonitorView = 'bank' | 'room';

/** Proktor mengawasi per ruang; Admin & guru mapel mulai dari bank soal. Guru hanya per bank soal. */
export function defaultFolderView(role: FolderMonitorRole): FolderMonitorView {
    return role === 'proktor' ? 'room' : 'bank';
}

export function folderViews(role: FolderMonitorRole): FolderMonitorView[] {
    return role === 'guru' ? ['bank'] : ['bank', 'room'];
}

/**
 * Monitoring satu bank soal ujian folder ASAS/AM di halaman Monitoring.
 * - Per bank soal: semua siswa bank itu dari semua kelas & ruang.
 * - Per ruang: papan ruang folder, lalu isi ruang.
 */
export function FolderExamMonitor({ group, userRole, attemptBasePath, refreshToken = 0 }: {
    group: FolderExamGroup;
    userRole: FolderMonitorRole;
    attemptBasePath?: string;
    /** Bertambah saat tombol Perbarui di kepala halaman ditekan. */
    refreshToken?: number;
}) {
    const views = folderViews(userRole);
    const [view, setView] = useState<FolderMonitorView>(defaultFolderView(userRole));
    const activeView = views.includes(view) ? view : views[0];

    return <div className="space-y-4">
        {views.length > 1 && <div role="group" aria-label="Tampilan monitoring" className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold">
            {views.map(id => <button key={id} type="button" aria-pressed={activeView === id} onClick={() => setView(id)}
                className={`rounded-full px-3.5 py-1.5 transition-colors ${activeView === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                {id === 'bank' ? 'Per bank soal' : 'Per ruang'}
            </button>)}
        </div>}
        {activeView === 'bank'
            ? <BankMonitor key={`${group.id}:${refreshToken}`} group={group} userRole={userRole} attemptBasePath={attemptBasePath} />
            : <PASSlotMonitoring key={`${group.periodId}:${refreshToken}`} periodId={group.periodId} userRole={userRole === 'guru' ? 'admin' : userRole} attemptBasePath={attemptBasePath} embedded />}
    </div>;
}

function BankMonitor({ group, userRole, attemptBasePath }: { group: FolderExamGroup; userRole: FolderMonitorRole; attemptBasePath?: string }) {
    const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const request = useRef(0);
    // Stabil walau daftar ujian dimuat ulang: hanya berubah bila anggota grupnya berubah.
    const examKey = group.examIds.join(',');
    const examIds = useMemo(() => examKey.split(',').filter(Boolean), [examKey]);

    const load = useCallback(async (silent = false) => {
        const id = ++request.current;
        if (!silent) setLoading(true);
        const results = await Promise.allSettled(examIds.map(examId => getExamAttemptsAction(examId)));
        if (id !== request.current) return;
        const rows: ExamAttemptRecord[] = [];
        let failed = 0;
        for (const result of results) {
            if (result.status === 'fulfilled') rows.push(...result.value);
            else failed += 1;
        }
        setAttempts(rows);
        setError(failed ? `${failed} dari ${examIds.length} ujian bank soal ini belum dapat dimuat.` : null);
        setLoading(false);
    }, [examIds]);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(false), 0);
        return () => window.clearTimeout(timer);
    }, [load]);
    useAutoRefresh(() => void load(true), REFRESH_INTERVAL.monitoring);

    const examRecords = useMemo(() => Object.fromEntries(group.exams.map(exam => [exam.id, exam])), [group.exams]);
    // Ujian lama yang masih terpisah per kelas: Hasil & Analisis dipilih per ujian (kelas).
    const examOptions = useMemo(() => group.exams.map(exam => ({
        exam_id: exam.id,
        label: group.exams.length > 1 ? `Kelas ${folderExamParts(exam)?.className || exam.title}` : group.bankTitle,
    })), [group]);

    return <section className="space-y-3" aria-label={`Monitoring bank soal ${group.bankTitle}`}>
        <ParticipantSummaryLine attempts={attempts} />
        {error && <WorkspaceError text={error} onRetry={() => void load(false)} />}
        <ParticipantsWorkspace
            attempts={attempts}
            examOptions={examOptions}
            examRecords={examRecords}
            userRole={userRole}
            sections={['peserta', 'jawaban', 'hasil', 'analisis']}
            loading={loading}
            attemptBasePath={attemptBasePath}
            onReload={() => load(true)}
            showRoomFilter
            exportTitle={`${group.folderTitle} ${group.bankTitle}`}
        />
    </section>;
}
