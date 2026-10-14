import type { OrganizationExam } from './api/proctor';

export function isMonitoringExamActive(exam: OrganizationExam, now = Date.now()): boolean {
    if (!exam.is_published || ['draft', 'archived', 'finished', 'completed', 'cancelled'].includes(exam.status || '')) return false;
    const start = exam.start_time ? Date.parse(exam.start_time) : -Infinity;
    const end = exam.end_time ? Date.parse(exam.end_time) : Infinity;
    return start <= now && now < end;
}

export function sortMonitoringExams(exams: OrganizationExam[], now = Date.now()): OrganizationExam[] {
    return [...exams].sort((a, b) =>
        Number(isMonitoringExamActive(b, now)) - Number(isMonitoringExamActive(a, now)) ||
        a.title.localeCompare(b.title, 'id', { sensitivity: 'base', numeric: true }) ||
        a.id.localeCompare(b.id));
}

export function monitoringExamLabel(exam: OrganizationExam): string {
    return exam.title;
}
