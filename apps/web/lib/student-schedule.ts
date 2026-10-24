import type { StudentScheduledExam } from './api/students';
/** Pemulihan proktor yang masih berlaku: ujian tetap bisa dibuka walau jadwalnya sudah lewat. */
export function recoveryActive(exam: StudentScheduledExam, now: number): boolean {
    const until = exam.recoveryUntil ? Date.parse(exam.recoveryUntil) : NaN;
    return Number.isFinite(until) && Number.isFinite(now) && until > now;
}

/** Teks jendela pribadi siswa: susulan, kirim ulang jawaban, atau lanjut mengerjakan. */
export function recoveryLabel(exam: StudentScheduledExam): { badge: string; action: string; button: string } {
    // Kirim-saja didahulukan: susulan yang kemudian dipulihkan untuk pengiriman
    // tidak boleh tampil sebagai "Kerjakan Susulan".
    if (exam.recoverySubmitOnly) return { badge: 'Pemulihan', action: 'Kirim jawaban', button: 'Kirim Jawaban' };
    if (exam.isMakeup) return { badge: 'Susulan', action: 'Kerjakan', button: 'Kerjakan Susulan' };
    return { badge: 'Pemulihan', action: 'Lanjutkan', button: 'Lanjutkan' };
}

export function scheduleState(exam: StudentScheduledExam, now: number): 'open' | 'upcoming' | 'closed' | 'invalid' {
    if (exam.isCompleted) return 'closed';
    if (!exam.is_published || exam.status === 'archived') return 'closed';
    if (recoveryActive(exam, now)) return 'open';
    const start = exam.start_time ? Date.parse(exam.start_time) : -Infinity;
    const end = exam.end_time ? Date.parse(exam.end_time) : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start || !Number.isFinite(now)) return 'invalid';
    if (now > end) return 'closed';
    return now < start ? 'upcoming' : 'open';
}

/** Dashboard hanya menampilkan ujian yang masih bisa dikerjakan atau akan datang. */
export function dashboardExams(exams: StudentScheduledExam[], now: number): StudentScheduledExam[] {
    return exams.filter(exam => {
        const state = scheduleState(exam, now);
        return state === 'open' || state === 'upcoming';
    }).sort((a, b) => {
        const aOpen = scheduleState(a, now) === 'open';
        const bOpen = scheduleState(b, now) === 'open';
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        const aStart = a.start_time ? Date.parse(a.start_time) : Infinity;
        const bStart = b.start_time ? Date.parse(b.start_time) : Infinity;
        return aStart - bStart;
    });
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
