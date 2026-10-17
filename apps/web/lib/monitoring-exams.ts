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
    const bank = typeof exam.metadata?.bank_title === 'string'
        ? exam.metadata.bank_title.trim() : exam.question_bank_title?.trim();
    return bank && bank !== exam.title.trim() ? `${exam.title} — ${bank}` : exam.title;
}

/** The generated PAS description contains bank, target class, school year and semester. */
export function monitoringExamDetails(exam: OrganizationExam): string {
    const description = typeof exam.description === 'string' ? exam.description.trim() : '';
    const subject = typeof exam.subject === 'string' ? exam.subject.trim() : '';
    return description || subject;
}
