import type { OrganizationExam } from './api/proctor';

export function hasMonitoringAdministration(exam?: Pick<OrganizationExam, 'exam_type'> | null): boolean {
    const type = exam?.exam_type?.trim().toLowerCase();
    return type === 'pas' || type === 'am';
}
