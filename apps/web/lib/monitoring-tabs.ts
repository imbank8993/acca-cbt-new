import type { OrganizationExam } from './api/proctor';
import { isSemesterAssessmentType } from './exam-types';

export function hasMonitoringAdministration(exam?: Pick<OrganizationExam, 'exam_type'> | null): boolean {
    // ASAS, ASAT (nilai lama `pat`) dan AM sama-sama punya administrasi ruang.
    return isSemesterAssessmentType(exam?.exam_type);
}
