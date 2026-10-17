import type { jsPDF } from 'jspdf';

/** Keep all signers together and leave the right column for the verification QR. */
export function drawAdministrationSigners(pdf: jsPDF, options: {
    y: number;
    marginLeft: number;
    pageWidth: number;
    marginRight: number;
    signedAt: string;
    invigilator: { name: string; nip?: string };
    proctor: { name: string; nip?: string };
    committeeChair: { name: string; nip?: string };
}) {
    pdf.setFont('times', 'normal');
    pdf.setFontSize(10);
    const valueX = options.marginLeft + 38;
    const valueWidth = options.pageWidth - options.marginRight - 48 - valueX;
    const rows = [
        { label: 'Disahkan pada', name: options.signedAt },
        { label: 'Pengawas Ruang', ...options.invigilator },
        { label: 'Proktor', ...options.proctor },
        { label: 'Mengetahui,\nKetua Panitia', ...options.committeeChair },
    ].map(row => {
        const lines = pdf.splitTextToSize(row.name || '-', valueWidth) as string[];
        const labelLines = row.label.split('\n');
        pdf.setFontSize(8.5);
        const nipLines = row.nip && row.nip !== '-' ? pdf.splitTextToSize(`NIP. ${row.nip}`, valueWidth) as string[] : [];
        pdf.setFontSize(10);
        const height = Math.max(labelLines.length * 4.5, lines.length * 4.5 + nipLines.length * 3.8) + 2;
        return { ...row, lines, labelLines, nipLines, height };
    });
    const height = rows.reduce((total, row) => total + row.height, 0);
    let y = options.y;
    if (y + height > pdf.internal.pageSize.getHeight() - 15) { pdf.addPage(); y = 20; }
    const topY = y;
    for (const row of rows) {
        pdf.setFontSize(10);
        pdf.setTextColor(0, 0, 0);
        pdf.text(row.labelLines, options.marginLeft, y, { lineHeightFactor: 1.27 });
        pdf.text(':', options.marginLeft + 34, y);
        pdf.text(row.lines, valueX, y, { lineHeightFactor: 1.27 });
        if (row.nipLines.length) {
            pdf.setFontSize(8.5); pdf.setTextColor(85, 85, 85);
            pdf.text(row.nipLines, valueX, y + row.lines.length * 4.5, { lineHeightFactor: 1.27 });
        }
        y += row.height;
    }
    return { topY, bottomY: y };
}
