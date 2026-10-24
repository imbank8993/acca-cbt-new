'use client';

import { DoorOpen } from 'lucide-react';
import type { OrganizationExam } from '@/lib/api/proctor';
import { isSemesterAssessmentType, semesterAssessmentLabel } from '@/lib/exam-types';

/** Arahkan ujian ASAS/ASAT/AM ke pemantauan per ruang di folder ujiannya. */
export function PASRoomMonitoringLink({ exam, role }: { exam?: OrganizationExam | null; role: 'admin' | 'proktor' }) {
    const periodId = typeof exam?.metadata?.pas_period_id === 'string' ? exam.metadata.pas_period_id : '';
    if (!exam || !periodId || !isSemesterAssessmentType(exam.exam_type)) return null;
    return <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-blue-200 bg-blue-50/60 px-3.5 py-2.5 text-xs text-blue-900">
        <div className="flex items-center gap-2">
            <DoorOpen size={16} className="shrink-0 text-blue-600" />
            <span className="font-medium">Tersedia monitoring per ruang ({semesterAssessmentLabel(exam.exam_type)})</span>
        </div>
        <a href={`/dashboard/${role}/exams/pas/${encodeURIComponent(periodId)}?tab=monitoring`} className="rounded-lg bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700">Buka ruang</a>
    </div>;
}
