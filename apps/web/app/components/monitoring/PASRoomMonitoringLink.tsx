'use client';

import { DoorOpen } from 'lucide-react';
import type { OrganizationExam } from '@/lib/api/proctor';
import { isSemesterAssessmentType, semesterAssessmentLabel } from '@/lib/exam-types';

/** Arahkan ujian ASAS/ASAT/AM ke pemantauan per ruang di folder ujiannya. */
export function PASRoomMonitoringLink({ exam, role }: { exam?: OrganizationExam | null; role: 'admin' | 'proktor' }) {
    const periodId = typeof exam?.metadata?.pas_period_id === 'string' ? exam.metadata.pas_period_id : '';
    if (!exam || !periodId || !isSemesterAssessmentType(exam.exam_type)) return null;
    return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
        <DoorOpen size={16} className="shrink-0 text-blue-600" />
        <span className="min-w-0 flex-1">Ujian {semesterAssessmentLabel(exam.exam_type)} lebih mudah dipantau per ruang: satu ruang menampilkan semua siswanya, apa pun kelas dan bank soalnya.</span>
        <a href={`/dashboard/${role}/exams/pas/${encodeURIComponent(periodId)}?tab=monitoring`} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700">Buka monitoring per ruang</a>
    </div>;
}
