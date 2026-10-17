/** Semester/year assessments share creation, recovery and invigilator policies. */
export const SEMESTER_ASSESSMENT_TYPES = ['pas', 'pat', 'am'] as const;

export function isSemesterAssessmentExam(exam: { exam_type?: string | null }): boolean {
    return (SEMESTER_ASSESSMENT_TYPES as readonly string[]).includes(exam.exam_type || '');
}
