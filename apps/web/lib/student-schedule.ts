import type { StudentScheduledExam } from './api/students';
export function scheduleState(exam: StudentScheduledExam, now: number): 'open' | 'upcoming' | 'closed' | 'invalid' {
    if (exam.isCompleted) return 'closed';
    if (!exam.is_published || exam.status === 'archived') return 'closed';
    const start = exam.start_time ? Date.parse(exam.start_time) : -Infinity;
    const end = exam.end_time ? Date.parse(exam.end_time) : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start || !Number.isFinite(now)) return 'invalid';
    if (now > end) return 'closed';
    return now < start ? 'upcoming' : 'open';
}
export function scheduleCountdown(date: string, now: number): string {
    const diff = Date.parse(date) - now;
    if (!Number.isFinite(diff) || diff <= 0) return '';
    const minutes = Math.floor(diff / 60000);
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    if (days) return `${days} hari ${hours} jam lagi`;
    if (hours) return `${hours} jam ${minutes % 60} menit lagi`;
    return minutes ? `${minutes} menit lagi` : 'Kurang dari 1 menit lagi';
}
