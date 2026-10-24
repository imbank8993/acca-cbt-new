import { hasStoredAnswer } from '@acca-cbt/shared';
import { examDeadline } from './exam-deadline';

/** Jejak masa offline yang perlu dilihat pengawas sebelum memulihkan. */
export function offlineReview(attempt: any, logs: any[] = []) {
    const lastReset = logs.filter(log => ['RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED'].includes(log.event_type))
        .map(log => log.created_at).sort().pop();
    const lateEvidence = logs.filter(log => log.event_type === 'LATE_SECURITY_EVIDENCE' &&
        (!lastReset || log.created_at > lastReset)).length;
    const lost = attempt.status === 'auto_submitted' && attempt.metadata?.closed_by_expiry === true
        ? attempt.metadata?.connection_lost_at_close || null : null;
    // Percobaan membuka ujian dari perangkat lain sejak reset terakhir. Perangkat
    // lain selalu ditolak; pengawas perlu tahu supaya tidak mengira siswa
    // "sudah lanjut" padahal jawabannya tertahan di perangkat pertama.
    const blocked = logs.filter(log => log.event_type === 'DEVICE_SWITCH_BLOCKED' &&
        (!lastReset || log.created_at > lastReset));
    const uncounted = attempt.metadata?.local_answers_not_counted;
    const uncountedCount = Number.isInteger(uncounted?.count) && uncounted.count > 0 ? uncounted.count : 0;
    return {
        connection_lost_at_close: lost && typeof lost === 'object' ? {
            last_seen_at: lost.last_seen_at ?? null, deadline_at: lost.deadline_at ?? null, gap_seconds: lost.gap_seconds ?? null,
        } : null,
        uncounted_local_answers: uncountedCount ? { count: uncountedCount, reported_at: uncounted.reported_at ?? null } : null,
        late_security_evidence: lateEvidence,
        other_device_attempts: blocked.length
            ? { count: blocked.length, last_at: blocked.map(log => log.created_at).sort().pop() ?? null } : null,
    };
}

export function attemptHealth(attempt: any, exam: any, answers: any[], now: Date, questionCount: number, logs: any[] = []) {
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
    const saved = answers.filter(hasStoredAnswer).length;
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
    const review = offlineReview(attempt, logs);
    if (review.connection_lost_at_close) attention.push('Perangkat tanpa kontak saat waktu habis');
    if (review.uncounted_local_answers) {
        attention.push(`${review.uncounted_local_answers.count} jawaban lokal belum masuk — perlu pemulihan`);
    }
    if (review.late_security_evidence) attention.push('Ada catatan pengawasan susulan dari masa offline');
    if (review.other_device_attempts && attempt.status !== 'submitted') {
        attention.push(`Mencoba masuk dari perangkat lain (${review.other_device_attempts.count}×) — jawaban hanya bisa dikirim dari perangkat pertama`);
    }
    return {
        client_context: attempt.metadata?.client_context || null,
        server_now: now.toISOString(), connection_status: connection, deadline_at: deadlineAt,
        remaining_seconds: remaining, saved_answer_count: saved, total_questions: questionCount,
        unanswered_count: Math.max(0, questionCount - saved), last_answer_saved_at: savedDates.at(-1) || null,
        sync_health: reportAt ? { localAnswerCount: report.localAnswerCount, pendingAnswerCount: report.pendingAnswerCount,
            storageState: report.storageState, receivedAt: reportAt, fresh } : null,
        grading_status: grading, attention_reasons: attention, offline_review: review,
    };
}
