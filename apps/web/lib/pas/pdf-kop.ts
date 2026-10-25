import type { jsPDF } from 'jspdf';
import { fitLogo, type KopLogo } from '@/lib/school-logo';
import type { formatKopParts } from './print-kop';

type KopParts = ReturnType<typeof formatKopParts>;

export interface PdfKopOptions {
    left: number;
    right: number;
    /** Tepi atas kop (mm). */
    top?: number;
    /** Sisi kotak logo (mm). */
    logoSize?: number;
}

const MM_PER_PT = 25.4 / 72;
const LINE_FACTOR = 1.22;
/** Jarak baseline dari tepi atas baris, sebagai pecahan tinggi baris (font Times). */
const BASELINE = 0.76;

interface KopLine { text: string; size: number; bold: boolean }

/**
 * Kop surat resmi untuk semua PDF administrasi ujian.
 *
 * Logo berada di kiri dalam kotak persegi, diskalakan sesuai rasio aslinya
 * dan diletakkan di tengah tinggi kop. Ruang selebar kotak logo juga disisakan
 * di kanan, sehingga teks tetap simetris di tengah halaman dan baris panjang
 * (alamat, kontak) dibungkus alih-alih menabrak logo. Mengembalikan posisi y
 * (mm) tepat di bawah garis ganda.
 */
export function drawPdfKop(pdf: jsPDF, kop: KopParts, logo: KopLogo | null, options: PdfKopOptions): number {
    const { left, right, top = 10, logoSize = 22 } = options;
    const reserve = logoSize + 4;
    const center = (left + right) / 2;
    const textWidth = Math.max(40, right - left - 2 * reserve);

    const lines: KopLine[] = [];
    const add = (text: string, size: number, bold: boolean) => {
        if (!text) return;
        pdf.setFont('times', bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        (pdf.splitTextToSize(text, textWidth) as string[]).forEach(part => lines.push({ text: part, size, bold }));
    };
    if (kop.isMadrasah) {
        add(kop.kemenagLine1, 11.5, true);
        add(kop.kemenagLine2, 11.5, true);
    }
    add(kop.namaMadrasah, 14.5, true);
    add(kop.alamatLine, 8.8, false);
    add(kop.kontakLine, 8.8, false);

    const lineHeight = (size: number) => size * MM_PER_PT * LINE_FACTOR;
    const textHeight = lines.reduce((sum, line) => sum + lineHeight(line.size), 0);
    const blockHeight = Math.max(textHeight, logo ? logoSize : 0);

    pdf.setTextColor(0, 0, 0);
    let y = top + (blockHeight - textHeight) / 2;
    for (const line of lines) {
        const height = lineHeight(line.size);
        pdf.setFont('times', line.bold ? 'bold' : 'normal');
        pdf.setFontSize(line.size);
        pdf.text(line.text, center, y + height * BASELINE, { align: 'center' });
        y += height;
    }

    if (logo) {
        const box = fitLogo(logo, logoSize, logoSize);
        try {
            pdf.addImage(logo.dataUrl, 'PNG', left + (logoSize - box.width) / 2,
                top + (blockHeight - box.height) / 2, box.width, box.height, undefined, 'FAST');
        } catch { /* Kop teks tetap dicetak bila logo tidak dapat disematkan. */ }
    }

    const ruleY = top + blockHeight + 2.4;
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.8);
    pdf.line(left, ruleY, right, ruleY);
    pdf.setLineWidth(0.25);
    pdf.line(left, ruleY + 1, right, ruleY + 1);
    return ruleY + 1;
}
