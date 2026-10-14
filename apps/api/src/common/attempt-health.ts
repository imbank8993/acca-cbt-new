import { examDeadline } from './exam-deadline';

export function attemptHealth(attempt: any, exam: any, answers: any[], now: Date, questionCount: number) {
    const report = attempt.metadata?.sync_health;
    const reportAt = typeof report?.receivedAt === 'string' ? report.receivedAt : null;
    const age = reportAt ? now.getTime() - Date.parse(reportAt) : Infinity;
    const fresh = Number.isFinite(age) && age >= 0 && age <= 45_000;
    const active = attempt.status === 'in_progress';
    const connection = !active ? 'inactive' : !attempt.last_seen_at ? 'unknown'
        : now.getTime() - Date.parse(attempt.last_seen_at) > 45_000 ? 'offline' : 'online';
    const deadline = examDeadline(attempt, exam);
    const deadlineAt = Number.isFinite(deadline.getTime()) ? deadline.toISOString() : null;
    const remaining = deadlineAt ? Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000)) : null;
    const saved = answers.filter(answer => {
        const value = answer.essay_answer ?? answer.selected_option_id;
        return value != null && !['', '[]', '{}', 'null'].includes(String(value).trim());
    }).length;
    const savedDates = answers.map(answer => answer.metadata?.answer_saved_at)
        .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort();
    const attention: string[] = [];
    if (active && connection !== 'online') attention.push('Tidak ada kabar terbaru dari perangkat');
    if (active && report?.pendingAnswerCount > 0) attention.push('Terakhir dilaporkan ada perubahan belum terkirim');
    if (active && report?.storageState === 'unavailable') attention.push('Perangkat melaporkan penyimpanan lokal gagal');
    if (active && remaining !== null && remaining <= 300 && (connection !== 'online' || report?.pendingAnswerCount > 0)) {
        attention.push('Waktu hampir habis dan sinkronisasi perlu diperiksa');
    }
    const grading = ['submitted', 'auto_submitted'].includes(attempt.status)
        ? attempt.total_score == null ? 'pending' : attempt.needs_manual_grading ? 'manual' : 'complete' : 'not_submitted';
    if (grading === 'pending') attention.push('Jawaban terkumpul, menunggu penilaian');
    return {
        client_context: attempt.metadata?.client_context || null,
        server_now: now.toISOString(), connection_status: connection, deadline_at: deadlineAt,
        remaining_seconds: remaining, saved_answer_count: saved, total_questions: questionCount,
        unanswered_count: Math.max(0, questionCount - saved), last_answer_saved_at: savedDates.at(-1) || null,
        sync_health: reportAt ? { localAnswerCount: report.localAnswerCount, pendingAnswerCount: report.pendingAnswerCount,
            storageState: report.storageState, receivedAt: reportAt, fresh } : null,
        grading_status: grading, attention_reasons: attention,
    };
}
