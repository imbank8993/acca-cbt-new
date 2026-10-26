import type { OrganizationExam } from './api/proctor';
import { isSemesterAssessmentType } from './exam-types';

export function isMonitoringExamActive(exam: OrganizationExam, now = Date.now()): boolean {
    if (!exam.is_published || ['draft', 'archived', 'finished', 'completed', 'cancelled'].includes(exam.status || '')) return false;
    const start = exam.start_time ? Date.parse(exam.start_time) : -Infinity;
    const end = exam.end_time ? Date.parse(exam.end_time) : Infinity;
    return start <= now && now < end;
}

/**
 * Ujian yang dibangkitkan dari folder ASAS/ASAT/AM: satu ujian per kelas × bank
 * soal, semuanya berjudul nama folder. Kelas dan bank dibaca dari deskripsi
 * bangkitan "Bank • Kelas XII A | 2026/2027 | PAS ganjil".
 */
export function folderExamParts(exam: Pick<OrganizationExam, 'title' | 'description' | 'metadata' | 'exam_type'>): {
    className: string; bank: string; period: string;
} | null {
    const isFolder = exam.metadata?.is_pas_exam === true || typeof exam.metadata?.pas_period_id === 'string'
        || isSemesterAssessmentType(exam.exam_type);
    const description = typeof exam.description === 'string' ? exam.description.trim() : '';
    const match = /^(.*?)\s*•\s*Kelas\s+(.+?)\s*(?:\|\s*(.*))?$/i.exec(description);
    if (!isFolder || !match || !match[2]) return null;
    const metadataBank = typeof exam.metadata?.bank_title === 'string' ? exam.metadata.bank_title.trim() : '';
    return {
        className: match[2].trim(),
        bank: metadataBank || match[1].trim(),
        period: (match[3] || '').split('|').map(part => part.trim()).filter(Boolean).join(' · '),
    };
}

export function monitoringExamLabel(exam: OrganizationExam): string {
    const folder = folderExamParts(exam);
    // Ujian folder digabung per bank soal: bank lebih dulu, lalu kelas pesertanya.
    if (folder) return `${folder.bank || exam.title} · Kelas ${folder.className}`;
    const bank = typeof exam.metadata?.bank_title === 'string'
        ? exam.metadata.bank_title.trim() : exam.question_bank_title?.trim();
    return bank && bank !== exam.title.trim() ? `${exam.title} — ${bank}` : exam.title;
}

/** Keterangan di bawah label: nama folder & periode untuk ujian folder, deskripsi/mapel untuk ujian biasa. */
export function monitoringExamDetails(exam: OrganizationExam): string {
    const folder = folderExamParts(exam);
    if (folder) return [exam.title.trim(), folder.period].filter(Boolean).join(' · ');
    const description = typeof exam.description === 'string' ? exam.description.trim() : '';
    const subject = typeof exam.subject === 'string' ? exam.subject.trim() : '';
    return description || subject;
}

/** Aktif dulu, lalu judul; ujian satu folder berurutan per bank soal lalu kelas. */
export function sortMonitoringExams(exams: OrganizationExam[], now = Date.now()): OrganizationExam[] {
    return [...exams].sort((a, b) =>
        Number(isMonitoringExamActive(b, now)) - Number(isMonitoringExamActive(a, now)) ||
        a.title.localeCompare(b.title, 'id', { sensitivity: 'base', numeric: true }) ||
        monitoringExamLabel(a).localeCompare(monitoringExamLabel(b), 'id', { sensitivity: 'base', numeric: true }) ||
        a.id.localeCompare(b.id));
}
