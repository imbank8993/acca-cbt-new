/** Only configuration needed to render a student's exam. Revision history contains private answer keys. */
export function studentExamMetadata(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const keys = [
        'is_public', 'is_safe_mode', 'max_violations', 'question_order', 'show_answer_keys',
        'is_pas_exam', 'pas_period_id', 'pas_period_name', 'pas_schedule_id', 'bank_title',
        'window_open', 'window_close', 'exam_duration', 'document_url', 'video_url',
        'assignment_description', 'allow_file_upload', 'allowed_file_types', 'require_bank',
    ];
    return Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(value || {}, key))
        .map(key => [key, value![key]]));
}
