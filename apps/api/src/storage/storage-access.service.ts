import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { examDeadline } from '../common/exam-deadline';
import { assertAnswerKeysReleased } from '../common/answer-key-release';
import { readExamQuestionVersion, EXAM_QUESTION_SNAPSHOT_SELECT } from '../common/exam-question-snapshots';
import { loadExamQuestions } from '../common/exam-question-sources';
import { canAccessExam, loadExamAudience } from '../students/exam-access';
import { studentQuestion } from '../students/student-question';
import { StorageService } from './storage.service';

@Injectable()
export class StorageAccessService {
    constructor(private readonly db: DbService, private readonly authz: AuthorizationService,
        private readonly storage: StorageService) {}

    /** Match complete URLs, including URLs embedded in rich text; never substring-match object keys. */
    references(value: unknown, key: string): boolean {
        if (typeof value === 'string') {
            const urls = value.replace(/&amp;/g, '&').match(/(?:https?:\/\/|\/api\/storage\/file\/)[^\s<>"']+/g) || [];
            return urls.some(url => this.storage.objectKeyFromUrl(url) === key);
        }
        if (Array.isArray(value)) return value.some(item => this.references(item, key));
        return !!value && typeof value === 'object' && Object.values(value).some(item => this.references(item, key));
    }

    async assertRead(user: AuthUser, key: string): Promise<void> {
        if (!user) throw new ForbiddenException('Sesi tidak valid.');
        if (key.startsWith(`users/${user.id}/`)) return; // uploader preview, including unsaved drafts
        if (key.startsWith('assignments/')) {
            const [, examId, owner] = key.split('/');
            if (owner === user.id) return;
            await this.authz.assertExamStaff(user, examId);
            return;
        }
        const audience = await loadExamAudience(this.db, user);
        if (!audience.organizationId) throw new ForbiddenException('Berkas tidak tersedia.');
        const staff = user.isPlatformAdmin || user.resolved?.superadmin ||
            (user.roles || []).some(role => ['ADMIN', 'PROKTOR', 'GURU'].includes(role.toUpperCase()));
        if (staff) {
            const { data: banks, error } = await this.db.from('cbt_question_banks')
                .select('id, metadata, image_url').eq('organization_id', audience.organizationId);
            if (error) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
            for (const bank of banks || []) {
                try { await this.authz.assertBankAccess(user, bank.id); }
                catch (error) {
                    if (!(error instanceof ForbiddenException)) throw error;
                    await this.authz.assertOrgStaff(user, audience.organizationId);
                    const { data: sessions, error: sessionError } = await this.db.from('cbt_question_bank_validations')
                        .select('id').eq('bank_id', bank.id).eq('organization_id', audience.organizationId);
                    if (sessionError) throw new ForbiddenException('Izin validator belum dapat diperiksa.');
                    const { data: assignments, error: assignmentError } = await this.db.from('cbt_question_bank_validators')
                        .select('id').eq('validator_id', user.id).in('validation_id', (sessions || []).map((session: { id: string }) => session.id));
                    if (assignmentError) throw new ForbiddenException('Izin validator belum dapat diperiksa.');
                    if (!assignments?.length) continue;
                }
                if (key.startsWith(`banks/${bank.id}/`) || this.references(bank, key)) return;
                const { data: questions, error: readError } = await this.db.from('cbt_bank_questions')
                    .select(EXAM_QUESTION_SNAPSHOT_SELECT).eq('bank_id', bank.id);
                if (readError) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
                if (this.references(questions, key)) return;
                for (const table of ['cbt_question_stimuli', 'cbt_question_instructions']) {
                    const { data, error: contentError } = await this.db.from(table).select('*').eq('bank_id', bank.id);
                    if (contentError) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
                    if (this.references(data, key)) return;
                }
            }
        }
        const { data: attempts, error } = await this.db.from('cbt_exam_attempts')
            .select('exam_id, status, started_at, personal_end_time, metadata').eq('user_id', user.id);
        if (error) throw new ForbiddenException('Izin berkas belum dapat diperiksa.');
        const [clock] = await this.db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const now = new Date(clock.now);
        for (const attempt of attempts || []) {
            const { data: exam, error: examError } = await this.db.from('cbt_exams').select('*').eq('id', attempt.exam_id).maybeSingle();
            if (examError || !exam || exam.organization_id !== audience.organizationId) continue;
            let questions: any[];
            if (attempt.status === 'in_progress') {
                if (!canAccessExam(exam, audience)) continue;
                const deadline = examDeadline(attempt, exam);
                if (attempt.metadata?.recovery_submit_only || !Number.isFinite(deadline.getTime()) || now >= deadline ||
                    (exam.start_time && now < new Date(exam.start_time))) continue;
                questions = (await readExamQuestionVersion(this.db, exam.id)).map(q => studentQuestion(q, `${user.id}:${exam.id}`));
                if (this.references({ document: exam.metadata?.document_url, description: exam.metadata?.assignment_description }, key)) return;
            } else if (['submitted', 'auto_submitted'].includes(attempt.status)) {
                try { await assertAnswerKeysReleased(this.db, exam); }
                catch (error) { if (error instanceof ForbiddenException) continue; throw error; }
                // Released historical details intentionally use the latest bank content.
                questions = await loadExamQuestions(this.db, exam.id, EXAM_QUESTION_SNAPSHOT_SELECT, exam.question_bank_id);
                const frozen = await readExamQuestionVersion(this.db, exam.id);
                questions = [...questions, ...frozen];
            } else continue;
            if (this.references(questions, key)) return;
        }
        throw new ForbiddenException('Berkas tidak tersedia untuk sesi Anda.');
    }
}
