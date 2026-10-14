import type { ExamAttemptRecord } from './api/proctor';
import { monitoringTime } from './monitoring-time';

export function activeMonitoringFacts(attempt: ExamAttemptRecord, elapsed = 0) {
    const timing = monitoringTime(attempt, elapsed);
    const now = Date.parse(attempt.server_now || '') + elapsed * 1000;
    const seen = Date.parse(attempt.last_seen_at || '');
    const connection = !Number.isFinite(now) || !Number.isFinite(seen) ? 'unknown'
        : now - seen > 45_000 ? 'offline' : 'online';
    const health = attempt.sync_health;
    const fresh = Boolean(health && Number.isFinite(now) && now - Date.parse(health.receivedAt) <= 45_000 && now >= Date.parse(health.receivedAt));
    const pending = health?.pendingAnswerCount || 0;
    const ending = timing.remainingSeconds !== null && timing.remainingSeconds <= 300;
    const reasons: string[] = [];
    if (connection === 'offline') reasons.push('Tidak ada kontak terbaru');
    if (connection === 'unknown') reasons.push('Koneksi belum dilaporkan');
    if (pending > 0) reasons.push(`${fresh ? '' : 'Terakhir: '}${pending} jawaban menunggu sinkronisasi`);
    if (health?.storageState === 'unavailable') reasons.push('Penyimpanan perangkat gagal');
    if (ending) reasons.push(timing.remainingSeconds === 0 ? 'Batas waktu tercapai' : 'Waktu tersisa ≤5 menit');
    if ((attempt.warning_count || 0) > 0) reasons.push(`${attempt.warning_count} peringatan tercatat`);
    const priority = ((connection === 'offline' || ending) && pending > 0) || health?.storageState === 'unavailable' ? 3
        : connection === 'offline' || ending ? 2 : reasons.length ? 1 : 0;
    return { ...timing, connection, fresh, pending, ending, reasons, priority };
}

export type ActiveMonitoringFilter = 'all' | 'attention' | 'offline' | 'ending';
export function activeMonitoringRows(attempts: ExamAttemptRecord[], filter: ActiveMonitoringFilter, elapsed = 0) {
    return attempts.filter(attempt => attempt.status === 'in_progress')
        .map(attempt => ({ attempt, facts: activeMonitoringFacts(attempt, elapsed) }))
        .filter(({ facts }) => filter === 'all' || (filter === 'attention' && facts.priority > 0)
            || (filter === 'offline' && facts.connection === 'offline') || (filter === 'ending' && facts.ending))
        .sort((a, b) => b.facts.priority - a.facts.priority
            || (a.facts.remainingSeconds ?? Infinity) - (b.facts.remainingSeconds ?? Infinity)
            || String(a.attempt.profiles?.full_name || '').localeCompare(String(b.attempt.profiles?.full_name || ''), 'id')
            || a.attempt.id.localeCompare(b.attempt.id));
}
