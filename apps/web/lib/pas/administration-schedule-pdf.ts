import type { PASClassSchedule, PASSession } from '@/app/types/pas';
import { getRoomSessionInvigilators, pasDay, type PASRoomMember } from '@/lib/api/pas';
import { loadKopLogo } from '@/lib/school-logo';
import { drawPdfKop } from './pdf-kop';
import { formatKopParts, type ProfilSekolah } from './print-kop';

export interface SchedulePrintPeriod {
    name: string;
    school_year?: string;
    semester?: string;
    profil_sekolah?: ProfilSekolah | null;
    pas_class_schedules?: PASClassSchedule[];
}

export interface SchedulePrintRoom {
    id: string;
    name: string;
    pas_room_invigilators?: PASRoomMember[];
}

export type SchedulePrintSession = Pick<PASSession, 'id' | 'name' | 'start_time' | 'end_time'>;

export interface AdministrationScheduleRow {
    date: string;
    session: string;
    time: string;
    exam: string;
    className: string;
    room: string;
    invigilators: string;
    status: string;
}

export interface ScheduleMergeRun { start: number; length: number }

/** Merge hanya baris berurutan di halaman yang sama; sesi tidak melintasi hari. */
export function getAdministrationScheduleMergeRuns(rows: AdministrationScheduleRow[]) {
    const runsFor = (key: (row: AdministrationScheduleRow) => string): ScheduleMergeRun[] => {
        const runs: ScheduleMergeRun[] = [];
        rows.forEach((row, index) => {
            if (index && key(rows[index - 1]) === key(row)) runs[runs.length - 1].length++;
            else runs.push({ start: index, length: 1 });
        });
        return runs;
    };
    return {
        dates: runsFor(row => row.date),
        sessions: runsFor(row => `${row.date}\u0000${row.session}\u0000${row.time}`),
    };
}

const statusLabels: Record<string, string> = {
    scheduled: 'Terjadwal', active: 'Aktif', finished: 'Selesai', cancelled: 'Dibatalkan',
};

function dateLabel(date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || '-';
    return new Date(`${date}T12:00:00Z`).toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
}

/** Satu baris untuk setiap jadwal dan ruang yang dipakai oleh kelas tersebut. */
export function buildAdministrationScheduleRows(
    schedules: PASClassSchedule[], rooms: SchedulePrintRoom[], sessions: SchedulePrintSession[],
): AdministrationScheduleRow[] {
    const roomById = new Map(rooms.map(room => [room.id, room]));
    const sessionById = new Map(sessions.map(session => [session.id, session]));
    return schedules.flatMap(schedule => {
        const date = pasDay(schedule.scheduled_date);
        const session = sessionById.get(schedule.session_id || '');
        const allocated = [...new Set(schedule.allocated_room_ids || [])]
            .map(id => roomById.get(id)).filter((room): room is SchedulePrintRoom => Boolean(room));
        const named = rooms.find(room => room.name.toLocaleLowerCase('id-ID') === String(schedule.room || '').trim().toLocaleLowerCase('id-ID'));
        const usedRooms = allocated.length ? allocated : named ? [named] : [null];
        const subject = schedule.subjects?.name?.trim() || '';
        const bank = schedule.question_banks?.title?.trim() || schedule.exams?.title?.trim() || 'Bank soal belum ditetapkan';
        const exam = subject && subject.toLocaleLowerCase('id-ID') !== bank.toLocaleLowerCase('id-ID')
            ? `${subject}\n${bank}` : bank;
        const sessionTime = session
            ? `${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)}`
            : schedule.scheduled_time?.slice(0, 5) || '-';
        return usedRooms.map(room => ({
            date,
            session: session?.name || 'Sesi belum ditetapkan',
            time: `${sessionTime} · ${schedule.duration_minutes || '-'} menit`,
            exam,
            className: schedule.classes?.name || 'Kelas belum ditetapkan',
            room: room?.name || schedule.room?.trim() || 'Belum ditetapkan',
            invigilators: room && session
                ? getRoomSessionInvigilators(room, session.id, date)
                    .map(inv => inv.profiles?.full_name || 'Pengawas')
                    .sort((a, b) => a.localeCompare(b, 'id-ID')).join(', ') || 'Belum ditugaskan'
                : 'Belum ditugaskan',
            status: statusLabels[schedule.status] || schedule.status || '-',
        }));
    }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
        || a.session.localeCompare(b.session, 'id-ID') || a.room.localeCompare(b.room, 'id-ID')
        || a.className.localeCompare(b.className, 'id-ID'));
}

/** Unduh jadwal lengkap sebagai PDF A4 lanskap dengan kop profil sekolah. */
export async function downloadAdministrationSchedulePdf(period: SchedulePrintPeriod, rooms: SchedulePrintRoom[], sessions: SchedulePrintSession[]) {
    const rows = buildAdministrationScheduleRows(period.pas_class_schedules || [], rooms, sessions);
    if (!rows.length) throw new Error('Belum ada jadwal ujian untuk dicetak.');

    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const kop = formatKopParts(period.profil_sekolah);
    const logo = await loadKopLogo(kop.logoUrl);
    const left = 12, right = 285, center = 148.5;
    const widths = [9, 29, 32, 55, 28, 36, 65, 19];
    const headers = ['No', 'Hari / Tanggal', 'Sesi / Jam', 'Mata Pelajaran / Bank Soal', 'Kelas', 'Ruang', 'Pengawas', 'Status'];
    const xs = widths.map((_, index) => left + widths.slice(0, index).reduce((sum, width) => sum + width, 0));
    let y = 0;

    const drawPageHeader = () => {
        y = drawPdfKop(pdf, kop, logo, { left, right, top: 8, logoSize: 21 }) + 5.5;
        pdf.setFont('times', 'bold'); pdf.setFontSize(12);
        pdf.text('JADWAL PELAKSANAAN UJIAN', center, y, { align: 'center' }); y += 5;
        pdf.setFont('times', 'normal'); pdf.setFontSize(9);
        pdf.text(`${period.name} · Tahun Pelajaran ${period.school_year || '-'} · Semester ${period.semester || '-'}`, center, y, { align: 'center' }); y += 6;
        pdf.setFont('times', 'bold'); pdf.setFontSize(8);
        headers.forEach((header, index) => {
            pdf.setFillColor(241, 245, 249);
            pdf.rect(xs[index], y, widths[index], 8, 'F');
            pdf.setDrawColor(71, 85, 105);
            pdf.rect(xs[index], y, widths[index], 8, 'S');
            pdf.setTextColor(15, 23, 42);
            pdf.text(header, xs[index] + widths[index] / 2, y + 5, { align: 'center' });
        });
        y += 8;
    };

    drawPageHeader();
    type PreparedRow = { row: AdministrationScheduleRow; lines: string[][]; height: number };
    const prepared = rows.map((row, index): PreparedRow => {
        const values = [String(index + 1), dateLabel(row.date), `${row.session}\n${row.time}`,
            row.exam, row.className, row.room, row.invigilators, row.status];
        pdf.setFont('times', 'normal'); pdf.setFontSize(8);
        const lines = values.map((value, column) => pdf.splitTextToSize(value, widths[column] - 3) as string[]);
        const height = Math.max(8, ...lines.map(item => item.length * 3.6 + 3));
        return { row, lines, height };
    });

    const drawCell = (item: PreparedRow, column: number, cellY: number, height: number) => {
        pdf.rect(xs[column], cellY, widths[column], height);
        pdf.text(item.lines[column], xs[column] + 1.5, cellY + 3.8, { lineHeightFactor: 1.16 });
    };
    const drawPageRows = (pageRows: PreparedRow[], startY: number) => {
        pdf.setFont('times', 'normal'); pdf.setFontSize(8); pdf.setTextColor(15, 23, 42);
        pdf.setDrawColor(71, 85, 105);
        const positions: number[] = [];
        let rowY = startY;
        pageRows.forEach(item => {
            positions.push(rowY);
            [0, 3, 4, 5, 6, 7].forEach(column => drawCell(item, column, rowY, item.height));
            rowY += item.height;
        });
        const groups = getAdministrationScheduleMergeRuns(pageRows.map(item => item.row));
        for (const [column, runs] of [[1, groups.dates], [2, groups.sessions]] as const) {
            runs.forEach(run => {
                const height = pageRows.slice(run.start, run.start + run.length).reduce((sum, item) => sum + item.height, 0);
                drawCell(pageRows[run.start], column, positions[run.start], height);
            });
        }
    };
    let pageRows: PreparedRow[] = [];
    let pageStartY = y;
    prepared.forEach(item => {
        if (pageRows.length && y + item.height > 189) {
            drawPageRows(pageRows, pageStartY);
            pdf.addPage(); drawPageHeader();
            pageRows = [];
            pageStartY = y;
        }
        pageRows.push(item);
        y += item.height;
    });
    drawPageRows(pageRows, pageStartY);

    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        pdf.setPage(page);
        pdf.setFont('times', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90, 90, 90);
        pdf.text(`${period.name} · ${rows.length} baris jadwal`, left, 200);
        pdf.text(`Halaman ${page} dari ${pages}`, right, 200, { align: 'right' });
    }
    const safeName = period.name.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'ujian';
    pdf.save(`Jadwal-Ujian-${safeName}.pdf`);
}
