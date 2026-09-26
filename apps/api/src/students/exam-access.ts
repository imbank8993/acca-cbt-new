import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';

export interface ExamAudience {
    organizationId: string | null;
    assignedExamIds: Set<string>;
}

export interface AccessibleExam {
    id: string;
    organization_id: string | null;
    is_published: boolean;
    metadata?: { is_public?: boolean } | null;
}

/** Shared policy for discovery, detail, question delivery and starting an exam. */
export async function loadExamAudience(db: DbService, user: AuthUser): Promise<ExamAudience> {
    const results = await Promise.all([
        db.from('cbt_organization_members').select('organization_id')
            .eq('user_id', user.id).eq('is_active', true),
        db.from('cbt_class_members').select('class_id').eq('user_id', user.id),
        db.from('cbt_additional_class_members').select('class_id').eq('user_id', user.id),
        db.from('cbt_exam_participants').select('exam_id').eq('user_id', user.id),
    ]);
    // An unavailable authorization source must never turn a private exam public.
    if (results.some(result => result.error)) {
        throw new ServiceUnavailableException('Izin peserta belum dapat diperiksa. Coba lagi.');
    }
    const [members, regular, additional, participants] = results;
    const membershipSchoolIds = [...new Set<string>((members.data || []).map(
        (row: { organization_id: string }) => row.organization_id,
    ).filter(Boolean))];
    if (membershipSchoolIds.length > 1) {
        throw new ServiceUnavailableException('Akun terhubung ke lebih dari satu sekolah.');
    }
    const organizationId = membershipSchoolIds[0] || null;
    const assignedExamIds = new Set<string>((participants.data || []).map(
        (row: { exam_id: string }) => row.exam_id,
    ));
    const classIds = (regular.data || []).map((row: { class_id: string }) => row.class_id);
    const additionalIds = (additional.data || []).map((row: { class_id: string }) => row.class_id);
    const conditions: string[] = [];
    if (classIds.length) conditions.push(`class_id.in.(${classIds.join(',')})`);
    if (additionalIds.length) conditions.push(`additional_class_id.in.(${additionalIds.join(',')})`);
    if (conditions.length) {
        const targets = await db.from('cbt_exam_targets').select('exam_id').or(conditions.join(','));
        if (targets.error) {
            throw new ServiceUnavailableException('Penugasan ujian belum dapat diperiksa. Coba lagi.');
        }
        for (const target of targets.data || []) assignedExamIds.add(target.exam_id);
    }
    return { organizationId, assignedExamIds };
}

export function canAccessExam(exam: AccessibleExam, audience: ExamAudience): boolean {
    return exam.is_published === true && !!exam.organization_id &&
        audience.organizationId === exam.organization_id &&
        (exam.metadata?.is_public === true || audience.assignedExamIds.has(exam.id));
}

export async function assertExamAccess(db: DbService, user: AuthUser, exam: AccessibleExam) {
    if (!canAccessExam(exam, await loadExamAudience(db, user))) {
        throw new ForbiddenException('Ujian ini tidak tersedia untuk Anda.');
    }
}
