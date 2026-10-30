import type { OrganizationExam } from './api/proctor';
import { folderExamParts } from './monitoring-exams';

/**
 * Ujian folder ASAS/ASAT/AM di halaman Monitoring: satu entri per bank soal.
 * Ujian lama yang masih terpisah per kelas (satu bank, beberapa ujian) diringkas
 * menjadi satu entri sintetis `pas:<periodId>:<bankId>`.
 */
export interface FolderExamGroup {
    id: string;
    periodId: string;
    bankId: string;
    bankTitle: string;
    folderTitle: string;
    classes: string[];
    examIds: string[];
    exams: OrganizationExam[];
    /** Entri sintetis untuk pemilih ujian. */
    entry: OrganizationExam;
}

export const FOLDER_GROUP_PREFIX = 'pas:';

export const isFolderGroupId = (id: string | null | undefined) => typeof id === 'string' && id.startsWith(FOLDER_GROUP_PREFIX);

function folderKey(exam: OrganizationExam): { periodId: string; bankId: string } | null {
    const periodId = typeof exam.metadata?.pas_period_id === 'string' ? exam.metadata.pas_period_id : '';
    const bankId = exam.question_bank_id || (typeof exam.metadata?.bank_id === 'string' ? exam.metadata.bank_id : '');
    return periodId && bankId ? { periodId, bankId } : null;
}

const byClass = (a: string, b: string) => a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' });
const earliest = (values: Array<string | null | undefined>) => values.filter((v): v is string => Boolean(v)).sort()[0] ?? null;
const latest = (values: Array<string | null | undefined>) => values.filter((v): v is string => Boolean(v)).sort().reverse()[0] ?? null;

export function groupFolderExams(exams: OrganizationExam[]): {
    /** Daftar untuk pemilih: ujian biasa apa adanya, ujian folder satu entri per bank soal. */
    list: OrganizationExam[];
    groups: Map<string, FolderExamGroup>;
    /** id ujian anggota → id grup. */
    byMember: Map<string, string>;
} {
    const groups = new Map<string, FolderExamGroup>();
    const byMember = new Map<string, string>();
    const list: OrganizationExam[] = [];
    const order: Array<OrganizationExam | string> = [];

    for (const exam of exams) {
        const key = folderKey(exam);
        if (!key) { order.push(exam); continue; }
        const id = `${FOLDER_GROUP_PREFIX}${key.periodId}:${key.bankId}`;
        const parts = folderExamParts(exam);
        let group = groups.get(id);
        if (!group) {
            group = {
                id, periodId: key.periodId, bankId: key.bankId,
                bankTitle: parts?.bank || (typeof exam.metadata?.bank_title === 'string' ? exam.metadata.bank_title : '') || exam.question_bank_title || exam.title,
                folderTitle: exam.title, classes: [], examIds: [], exams: [], entry: exam,
            };
            groups.set(id, group);
            order.push(id);
        }
        group.examIds.push(exam.id);
        group.exams.push(exam);
        for (const name of (parts?.className || '').split(',').map(item => item.trim()).filter(Boolean)) {
            if (!group.classes.includes(name)) group.classes.push(name);
        }
        byMember.set(exam.id, id);
    }

    for (const group of groups.values()) {
        group.classes.sort(byClass);
        const first = group.exams[0];
        const period = folderExamParts(first)?.period || '';
        group.entry = {
            ...first,
            id: group.id,
            questionCreatorNames: [...new Set(group.exams.flatMap(exam => exam.questionCreatorNames || []))],
            examCreatorName: [...new Set(group.exams.map(exam => exam.examCreatorName).filter(Boolean))].join(', ') || null,
            description: `${group.bankTitle} • Kelas ${group.classes.join(', ') || '-'}${period ? ` | ${period.split(' · ').join(' | ')}` : ''}`,
            start_time: earliest(group.exams.map(exam => exam.start_time)),
            end_time: latest(group.exams.map(exam => exam.end_time)),
            is_published: group.exams.some(exam => exam.is_published),
            status: group.exams.find(exam => exam.is_published)?.status ?? first.status,
            metadata: { ...(first.metadata || {}), is_pas_exam: true, pas_period_id: group.periodId, bank_title: group.bankTitle, folder_group: true },
        };
    }

    for (const item of order) list.push(typeof item === 'string' ? groups.get(item)!.entry : item);
    return { list, groups, byMember };
}

/**
 * Nilai `?exam=` dari URL: id grup, `pas:<periodId>` (dari halaman folder), atau
 * id ujian anggota (tautan lama) → id entri yang ada di pemilih.
 */
export function resolveMonitoringSelection(value: string, grouped: ReturnType<typeof groupFolderExams>): string {
    if (!value) return '';
    if (grouped.groups.has(value)) return value;
    const member = grouped.byMember.get(value);
    if (member) return member;
    if (isFolderGroupId(value)) {
        const periodId = value.slice(FOLDER_GROUP_PREFIX.length).split(':')[0];
        const groups = [...grouped.groups.values()].filter(group => group.periodId === periodId);
        // Yang sedang berlangsung lebih dulu, lalu yang paling awal dimulai.
        const now = Date.now();
        const running = groups.find(group => group.exams.some(exam => exam.is_published
            && (!exam.start_time || Date.parse(exam.start_time) <= now) && (!exam.end_time || now < Date.parse(exam.end_time))));
        return (running || groups.sort((a, b) => String(a.entry.start_time || '').localeCompare(String(b.entry.start_time || '')))[0])?.id || '';
    }
    return value;
}
