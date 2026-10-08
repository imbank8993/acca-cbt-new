import { apiCreate, apiGet, apiSend } from './client';
import type { QuestionBank, QuestionRecord } from './questions';

export type ValidationStatus = 'pending' | 'in_progress' | 'revision_needed' | 'approved' | 'rejected';
export type ValidatorStatus = 'assigned' | 'in_progress' | 'submitted';
export type ApprovalRule = 'unanimous' | 'any' | 'admin_decides';
export type NoteCategory = 'typo' | 'materi' | 'kunci_jawaban' | 'konstruksi' | 'bahasa' | 'lainnya';
export type NoteStatusItem = 'valid' | 'revision' | 'rejected';

export interface ValidationValidator {
    id: string;
    validator_id: string;
    status: ValidatorStatus;
    general_recommendation?: 'approved' | 'revision_needed' | 'rejected' | null;
    general_comment?: string | null;
    submitted_at?: string | null;
    created_at?: string;
    profile?: {
        full_name: string;
        email?: string;
    } | null;
}

export interface ValidationNote {
    id: string;
    validation_id: string;
    question_id: string;
    validator_id: string;
    target_scope: 'question_text' | 'stimulus' | 'option' | 'general';
    target_option_id?: string | null;
    selected_text?: string;
    comment: string;
    category: NoteCategory;
    status_item: NoteStatusItem;
    is_resolved: boolean;
    resolved_by?: string | null;
    resolved_at?: string | null;
    created_at: string;
    validator?: {
        full_name: string;
    } | null;
}

export interface ValidationSession {
    id: string;
    organization_id?: string;
    bank_id: string;
    title: string;
    instructions?: string;
    deadline?: string | null;
    approval_rule: ApprovalRule;
    status: ValidationStatus;
    allow_edit_during_exam?: boolean;
    created_at: string;
    updated_at: string;
    bank?: QuestionBank | null;
    creator?: {
        full_name: string;
        email?: string;
    } | null;
    validators?: ValidationValidator[];
    notes?: ValidationNote[];
}

export interface ValidationTask {
    id: string;
    status: ValidatorStatus;
    general_recommendation?: 'approved' | 'revision_needed' | 'rejected' | null;
    general_comment?: string | null;
    submitted_at?: string | null;
    created_at: string;
    validation: {
        id: string;
        title: string;
        instructions?: string;
        deadline?: string | null;
        approval_rule: ApprovalRule;
        status: ValidationStatus;
        created_at: string;
        bank?: QuestionBank | null;
        assigned_by?: {
            full_name: string;
        } | null;
    };
}

export interface CreateValidationInput {
    bankId: string;
    validatorIds: string[];
    title?: string;
    instructions?: string;
    deadline?: string;
    approvalRule?: ApprovalRule;
    allowEditDuringExam?: boolean;
}

export interface SaveValidationNoteInput {
    questionId: string;
    targetScope: 'question_text' | 'stimulus' | 'option' | 'general';
    targetOptionId?: string;
    selectedText?: string;
    comment: string;
    category?: NoteCategory;
    statusItem?: NoteStatusItem;
}

export interface SubmitValidationReviewInput {
    generalRecommendation: 'approved' | 'revision_needed' | 'rejected';
    generalComment?: string;
}

// ── Client Functions ─────────────────────────────────────────────────────────

export async function listValidations(bankId?: string): Promise<ValidationSession[]> {
    const query = bankId ? `?bankId=${encodeURIComponent(bankId)}` : '';
    const res = await apiGet<{ data?: ValidationSession[] } | ValidationSession[]>(`/api/validations${query}`);
    if (!res.success) return [];
    if (Array.isArray(res)) return res;
    return (res as any).data || [];
}

export async function getValidationDetail(validationId: string): Promise<ValidationSession | null> {
    const res = await apiGet<ValidationSession>(`/api/validations/${encodeURIComponent(validationId)}`);
    return res.success ? (res as ValidationSession) : null;
}

export function createValidation(input: CreateValidationInput) {
    return apiCreate<{ id: string }>('/api/validations', input);
}

export async function listMyValidationTasks(): Promise<ValidationTask[]> {
    const res = await apiGet<{ data?: ValidationTask[] } | ValidationTask[]>('/api/validations/my-tasks');
    if (!res.success) return [];
    if (Array.isArray(res)) return res;
    return (res as any).data || [];
}

export async function getValidationReviewData(validationId: string): Promise<{
    validation: ValidationSession;
    myValidatorStatus: ValidationValidator | null;
    questions: QuestionRecord[];
    notes: ValidationNote[];
} | null> {
    const res = await apiGet<{
        validation: ValidationSession;
        myValidatorStatus: ValidationValidator | null;
        questions: QuestionRecord[];
        notes: ValidationNote[];
    }>(`/api/validations/${encodeURIComponent(validationId)}/review`);

    return res.success ? res : null;
}

export function saveValidationNote(validationId: string, input: SaveValidationNoteInput) {
    return apiCreate<ValidationNote>(`/api/validations/${encodeURIComponent(validationId)}/notes`, input);
}

export function deleteValidationNote(validationId: string, noteId: string) {
    return apiSend<{ id: string; deleted: boolean }>(
        `/api/validations/${encodeURIComponent(validationId)}/notes/${encodeURIComponent(noteId)}`,
        undefined,
        'DELETE',
    );
}

export function submitValidationReview(validationId: string, input: SubmitValidationReviewInput) {
    return apiCreate<{ success: boolean }>(`/api/validations/${encodeURIComponent(validationId)}/submit`, input);
}

export function resolveValidationNote(noteId: string, resolved: boolean) {
    return apiSend<ValidationNote>(
        `/api/validations/notes/${encodeURIComponent(noteId)}/resolve`,
        { resolved },
        'PATCH',
    );
}

export async function getBankValidationFeedback(bankId: string): Promise<ValidationSession[]> {
    const res = await apiGet<{ data?: ValidationSession[] } | ValidationSession[]>(
        `/api/validations/bank/${encodeURIComponent(bankId)}/feedback`,
    );
    if (!res.success) return [];
    if (Array.isArray(res)) return res;
    return (res as any).data || [];
}
