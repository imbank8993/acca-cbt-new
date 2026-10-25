import type { PASRoomParticipants } from '@/lib/api/pas';
import { fileDateStamp, safeFileName } from '@/lib/exam-print-model';
import { logoDataUrl } from './administration-schedule-pdf';
import { formatKopParts, type ProfilSekolah } from './print-kop';

export interface RoomParticipantsPeriod {
    name: string;
    school_year?: string | null;
    semester?: string | null;
    profil_sekolah?: ProfilSekolah | null;
}

/** Ringkasan kelas di sebuah ruang, mis. "XII A (12), XII D (8)". */
export function classSummary(room: PASRoomParticipants): string {
    const counts = new Map<string, number>();
    room.students.forEach(student => {
        const name = student.class_name || 'Tanpa kelas';
        counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'id', { numeric: true }))
        .map(([name, count]) => `${name} (${count})`).join(', ') || '-';
}

/** Nama file: Daftar_Peserta_<ruang atau folder>_<tanggal>.pdf */
export function roomParticipantsFileName(period: RoomParticipantsPeriod, rooms: PASRoomParticipants[]): string {
    const subject = rooms.length === 1 ? `${rooms[0].name}_${period.name}` : `Semua_Ruang_${period.name}`;
    return `Daftar_Peserta_${safeFileName(subject, 'Ruang')}_${fileDateStamp()}.pdf`;
}

/**
 * Unduh daftar peserta ruang sebagai PDF A4. Setiap ruang dimulai di halaman
 * baru dengan kop sekolahnya sendiri (1 ruang = 1 kop); bila peserta sebuah
 * ruang tidak muat satu halaman, halaman lanjutannya hanya memuat judul ruang
 * dan kepala tabel.
 */
export async function downloadRoomParticipantsPdf(period: RoomParticipantsPeriod, rooms: PASRoomParticipants[]) {
    const printable = rooms.filter(room => room.students.length > 0);
    if (!printable.length) throw new Error('Belum ada peserta yang ditempatkan di ruang ujian.');

    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const kop = formatKopParts(period.profil_sekolah);
    const logo = await logoDataUrl(kop.logoUrl);
    const left = 20, right = 190, center = (left + right) / 2, bottomLimit = 275;
    const widths = [10, 72, 32, 28, 28];
    const headers = ['No', 'Nama Peserta', 'NIS / NISN', 'Kelas', 'Keterangan'];
    const xs = widths.map((_, index) => left + widths.slice(0, index).reduce((sum, width) => sum + width, 0));
    const subtitle = [period.name, period.school_year ? `Tahun Pelajaran ${period.school_year}` : '',
        period.semester ? `Semester ${period.semester[0].toUpperCase()}${period.semester.slice(1)}` : '']
        .filter(Boolean).join(' · ');
    const roomPages: Array<{ room: string; first: number; last: number }> = [];
    let y = 0;

    const drawKop = () => {
        y = 14;
        if (logo) {
            try { pdf.addImage(logo, logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', left, 11, 20, 20); }
            catch { /* Kop teks tetap dicetak bila format logo tidak didukung. */ }
        }
        pdf.setTextColor(0, 0, 0);
        pdf.setFont('times', 'bold');
        if (kop.isMadrasah) {
            pdf.setFontSize(11);
            pdf.text(kop.kemenagLine1, center + 6, y, { align: 'center' }); y += 4.6;
            pdf.text(kop.kemenagLine2, center + 6, y, { align: 'center' }); y += 4.8;
        }
        pdf.setFontSize(14);
        pdf.text(kop.namaMadrasah, center + 6, y, { align: 'center' }); y += 4.8;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(8.5);
        const contact = [kop.alamatLine, kop.kontakLine].filter(Boolean);
        contact.forEach(line => {
            (pdf.splitTextToSize(line, right - left - 26) as string[]).forEach(part => {
                pdf.text(part, center + 6, y, { align: 'center' }); y += 3.7;
            });
        });
        y = Math.max(y, 34);
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.8); pdf.line(left, y, right, y);
        pdf.setLineWidth(0.25); pdf.line(left, y + 0.9, right, y + 0.9);
        y += 8;
    };

    const drawTableHeader = () => {
        pdf.setFont('times', 'bold'); pdf.setFontSize(9.5);
        pdf.setDrawColor(51, 51, 51); pdf.setLineWidth(0.2);
        headers.forEach((header, index) => {
            pdf.setFillColor(241, 245, 249);
            pdf.rect(xs[index], y, widths[index], 8, 'FD');
            pdf.setTextColor(0, 0, 0);
            pdf.text(header, xs[index] + widths[index] / 2, y + 5.3, { align: 'center' });
        });
        y += 8;
    };

    printable.forEach((room, roomIndex) => {
        if (roomIndex > 0) pdf.addPage();
        const first = pdf.getNumberOfPages();
        drawKop();
        pdf.setFont('times', 'bold'); pdf.setFontSize(13);
        pdf.text('DAFTAR PESERTA UJIAN', center, y, { align: 'center' });
        const titleWidth = pdf.getTextWidth('DAFTAR PESERTA UJIAN');
        pdf.setLineWidth(0.3); pdf.line(center - titleWidth / 2, y + 1, center + titleWidth / 2, y + 1);
        y += 5.5;
        pdf.setFont('times', 'normal'); pdf.setFontSize(10);
        if (subtitle) { pdf.text(subtitle, center, y, { align: 'center' }); y += 8; } else y += 3;

        const meta: Array<[string, string]> = [
            ['Ruang', room.name],
            ['Jumlah Peserta', `${room.students.length} orang${room.capacity ? ` (kapasitas ${room.capacity})` : ''}`],
            ['Kelas', classSummary(room)],
        ];
        pdf.setFontSize(10.5);
        meta.forEach(([label, value]) => {
            const lines = pdf.splitTextToSize(value, right - left - 40) as string[];
            pdf.setFont('times', 'normal'); pdf.text(label, left, y);
            pdf.text(':', left + 34, y);
            pdf.setFont('times', label === 'Ruang' ? 'bold' : 'normal');
            pdf.text(lines, left + 38, y, { lineHeightFactor: 1.2 });
            y += 5.5 + (lines.length - 1) * 4.6;
        });
        y += 2;
        drawTableHeader();

        room.students.forEach((student, index) => {
            pdf.setFont('times', 'normal'); pdf.setFontSize(10);
            const values = [String(index + 1), student.full_name || 'Tanpa Nama', student.nis || '-', student.class_name || '-', ''];
            const lines = values.map((value, column) => pdf.splitTextToSize(value, widths[column] - 3) as string[]);
            const height = Math.max(7.5, ...lines.map(item => item.length * 4.3 + 3.2));
            if (y + height > bottomLimit) {
                pdf.addPage();
                y = 18;
                pdf.setFont('times', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(0, 0, 0);
                pdf.text(`Daftar Peserta — ${room.name} (lanjutan)`, left, y);
                y += 5;
                drawTableHeader();
                pdf.setFont('times', 'normal'); pdf.setFontSize(10);
            }
            pdf.setDrawColor(51, 51, 51); pdf.setLineWidth(0.2); pdf.setTextColor(0, 0, 0);
            values.forEach((_, column) => {
                pdf.rect(xs[column], y, widths[column], height);
                const align = column === 0 || column === 3 ? 'center' : 'left';
                const x = align === 'center' ? xs[column] + widths[column] / 2 : xs[column] + 1.8;
                pdf.text(lines[column], x, y + 5, { align, lineHeightFactor: 1.2 });
            });
            y += height;
        });
        roomPages.push({ room: room.name, first, last: pdf.getNumberOfPages() });
    });

    for (const { room, first, last } of roomPages) {
        for (let page = first; page <= last; page++) {
            pdf.setPage(page);
            pdf.setFont('times', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90, 90, 90);
            pdf.text(`${period.name} · ${room}`, left, 288);
            pdf.text(`Halaman ${page - first + 1} dari ${last - first + 1}`, right, 288, { align: 'right' });
        }
    }
    pdf.save(roomParticipantsFileName(period, printable));
    return { rooms: printable.length, pages: pdf.getNumberOfPages() };
}
