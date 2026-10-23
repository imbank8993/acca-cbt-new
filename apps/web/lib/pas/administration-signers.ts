import type { jsPDF } from 'jspdf';

/** Gunakan pasangan nama/NIP pengawas aktif hanya jika sesuai dokumen tersimpan. */
export function resolveAdministrationInvigilators(
    assigned: Array<{ full_name: string; identity_number: string | null }>,
    saved: { invigilator_name: string; invigilator_nip?: string },
): Array<{ name: string; nip?: string }> {
    const people = assigned.filter(person => person.full_name.trim()).map(person => ({
        name: person.full_name.trim(), nip: person.identity_number?.trim() || undefined,
    }));
    if (people.length && people.map(person => person.name).join(', ') === saved.invigilator_name.trim()) return people;
    return [{ name: saved.invigilator_name || '-', nip: saved.invigilator_nip || undefined }];
}

/** Keep all signers together and leave the right column for the verification QR. */
export function drawAdministrationSigners(pdf: jsPDF, options: {
    y: number;
    marginLeft: number;
    pageWidth: number;
    marginRight: number;
    signedAt: string;
    invigilator: { name: string; nip?: string };
    invigilators?: Array<{ name: string; nip?: string }>;
    proctor: { name: string; nip?: string };
    committeeChair: { name: string; nip?: string };
}) {
    pdf.setFont('times', 'normal');
    pdf.setFontSize(10);
    const valueX = options.marginLeft + 38;
    const valueWidth = options.pageWidth - options.marginRight - 48 - valueX;
    const signers = options.invigilators?.length ? options.invigilators : [options.invigilator];
    const rows = [
        { label: 'Disahkan pada', people: [{ name: options.signedAt }] },
        { label: 'Pengawas Ruang', people: signers },
        { label: 'Proktor', people: [options.proctor] },
        { label: 'Mengetahui,\nKetua Panitia', people: [options.committeeChair] },
    ].map(row => {
        const labelLines = row.label.split('\n');
        const people = row.people.map((person, index) => {
            const prefix = row.label === 'Pengawas Ruang' && row.people.length > 1 ? `${index + 1}. ` : '';
            pdf.setFontSize(10);
            const lines = pdf.splitTextToSize(`${prefix}${person.name || '-'}`, valueWidth) as string[];
            pdf.setFontSize(8.5);
            const nipLines = person.nip && person.nip !== '-'
                ? pdf.splitTextToSize(`NIP. ${person.nip}`, valueWidth) as string[] : [];
            return { lines, nipLines, height: lines.length * 4.5 + nipLines.length * 3.8 + 1.5 };
        });
        const height = Math.max(labelLines.length * 4.5, people.reduce((sum, person) => sum + person.height, 0)) + 2;
        return { ...row, people, labelLines, height };
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
        let personY = y;
        for (const person of row.people) {
            pdf.setFontSize(10); pdf.setTextColor(0, 0, 0);
            pdf.text(person.lines, valueX, personY, { lineHeightFactor: 1.27 });
            if (person.nipLines.length) {
                pdf.setFontSize(8.5); pdf.setTextColor(85, 85, 85);
                pdf.text(person.nipLines, valueX, personY + person.lines.length * 4.5, { lineHeightFactor: 1.27 });
            }
            personY += person.height;
        }
        y += row.height;
    }
    return { topY, bottomY: y };
}
