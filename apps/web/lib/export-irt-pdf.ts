import DOMPurify from 'dompurify';
import { renderIrtPdfMath } from './irt-pdf-math';
import { extractMathExpressions } from '@/app/components/questions/math-utils';
import { difficultyLabel, type IrtCalibration, type IrtCalibrationItem } from './irt-calibration';
import { getSchoolTimeZone, getSchoolTimeZoneLabel } from './school-time';

const MARGIN = 14;
const BOTTOM = 278;
const PX_PER_MM = 96 / 25.4;

export function irtPdfFileName(title: string): string {
    const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').slice(0, 100) || 'Ujian';
    return `Analisis_IRT_${safe}.pdf`;
}

/** Sanitise teacher-authored HTML before adding self-contained equation images. */
export function renderIrtPdfQuestion(text: string): HTMLDivElement {
    const content = document.createElement('div');
    content.innerHTML = DOMPurify.sanitize(text || '-', {
        FORBID_TAGS: ['iframe', 'object', 'embed', 'video', 'audio', 'form', 'input', 'button', 'style'],
    });
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const node of nodes) {
        const value = node.nodeValue || '';
        const expressions = extractMathExpressions(value);
        if (!expressions.length) continue;
        const fragment = document.createDocumentFragment();
        let offset = 0;
        for (const expression of expressions) {
            fragment.append(document.createTextNode(value.slice(offset, expression.start)));
            const span = document.createElement('span');
            const svg = renderIrtPdfMath(expression.latex, expression.displayMode);
            const image = document.createElement('img');
            const svgElement = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
            image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
            image.alt = expression.latex;
            image.className = 'irt-pdf-equation';
            image.style.width = svgElement.getAttribute('width') || 'auto';
            image.style.height = svgElement.getAttribute('height') || 'auto';
            image.style.verticalAlign = svgElement.style.verticalAlign || 'middle';
            if (expression.displayMode) span.className = 'irt-pdf-display-equation';
            span.append(image);
            fragment.append(span);
            offset = expression.end;
        }
        fragment.append(document.createTextNode(value.slice(offset)));
        node.parentNode?.replaceChild(fragment, node);
    }
    return content;
}

async function captureQuestion(item: IrtCalibrationItem, width: number): Promise<{ canvas: HTMLCanvasElement; breaks: number[] }> {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:absolute;left:-20000px;top:0;width:${width * PX_PER_MM}px;background:#fff;color:#172b45;font:13px/1.8 Arial,sans-serif;overflow-wrap:anywhere;text-align:left;color-scheme:light;`;
    const style = document.createElement('style');
    style.textContent = `
        .irt-pdf-content{box-sizing:border-box;font-size:13px!important;line-height:1.8!important}
        .irt-pdf-content p{margin:0 0 8px!important}
        .irt-pdf-content p:last-child{margin-bottom:0!important}
        .irt-pdf-content img{max-width:100%!important;vertical-align:middle!important}
        .irt-pdf-content img:not(.irt-pdf-equation){height:auto!important}
        .irt-pdf-content .irt-pdf-equation{display:inline-block;max-width:none!important}
        .irt-pdf-display-equation{display:block;margin:8px 0;text-align:center}
        .irt-pdf-content table{width:100%;border-collapse:collapse}
        .irt-pdf-content td,.irt-pdf-content th{padding:4px;border:1px solid #cbd5e1}
    `;
    host.append(style);
    const content = renderIrtPdfQuestion(item.text);
    content.className = 'irt-pdf-content';
    host.append(content);
    if (item.part) {
        const part = renderIrtPdfQuestion(item.part);
        part.className = 'irt-pdf-content';
        part.style.cssText = 'margin-top:6px;padding-top:5px;border-top:1px solid #e2e8f0;font-size:12px';
        host.append(part);
    }
    document.body.append(host);
    try {
        // Measure first so newly introduced math fonts are included in fonts.ready.
        host.getBoundingClientRect();
        await document.fonts.ready;
        await Promise.all(Array.from(host.querySelectorAll('img')).map(async image => {
            await image.decode().catch(() => undefined);
            if (!image.naturalWidth) throw new Error(`Gambar pada soal ${item.number} belum dapat dimuat. Coba ekspor kembali.`);
        }));
        // Rich-text paragraphs and table rows are safe page boundaries.
        // Equations are indivisible images, including fractions and radicals.
        const top = host.getBoundingClientRect().top;
        const blocks = Array.from(host.querySelectorAll('p,li,tr,figure'))
            .filter(element => !element.querySelector('p,li,tr,figure'))
            .map(element => element.getBoundingClientRect())
            .filter(rect => rect.height > 0)
            .sort((a, b) => a.top - b.top);
        const breaks = blocks.map((block, index) => {
            const next = blocks[index + 1];
            return Math.floor(((next && next.top >= block.bottom ? (block.bottom + next.top) / 2 : block.bottom) - top) * 3);
        });
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(host, { backgroundColor: '#ffffff', scale: 3, logging: false, useCORS: true,
            width: Math.ceil(Math.max(host.clientWidth, host.scrollWidth)), height: Math.ceil(host.scrollHeight) });
        return { canvas, breaks };
    } finally {
        host.remove();
    }
}

const pdfText = (text: string) => text.replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...');

/** A4 portrait: vector labels/parameters, high-resolution question maths, no split table headers. */
export async function buildIrtParametersPdf(irt: IrtCalibration, title: string, timeZone?: string) {
    const { jsPDF } = await import('jspdf');
    const zone = timeZone || await getSchoolTimeZone();
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: `Analisis IRT - ${title}`, subject: 'Parameter butir soal IRT', creator: 'ACCA CBT' });
    const showA = irt.models.some(model => model === 'irt_2pl' || model === 'irt_3pl');
    const showC = irt.models.includes('irt_3pl');
    const models = irt.models.map(model => model.replace('irt_', '').toUpperCase()).join(' / ') || 'IRT';
    const calculated = new Date(irt.calculated_at);
    const date = Number.isNaN(calculated.getTime()) ? '-' : calculated.toLocaleString('id-ID', {
        timeZone: zone, dateStyle: 'long', timeStyle: 'short',
    });
    const columns = [
        { label: 'No', width: 9 },
        { label: 'Soal', width: 107 - (showA ? 16 : 0) - (showC ? 14 : 0) },
        { label: 'Benar (p)', width: 21 },
        { label: 'Kesulitan (b)', width: 18 },
        ...(showA ? [{ label: 'Daya beda (a)', width: 16 }] : []),
        ...(showC ? [{ label: 'Tebakan (c)', width: 14 }] : []),
        { label: 'Catatan', width: 27 },
    ];
    const xs = columns.map((_, index) => MARGIN + columns.slice(0, index).reduce((sum, col) => sum + col.width, 0));
    let y = 0;
    let bodyTop = 0;
    const header = (first: boolean) => {
        pdf.setFillColor(38, 91, 151); pdf.rect(MARGIN, 13, 10, 1.2, 'F');
        pdf.setTextColor(38, 91, 151); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
        pdf.text('ANALISIS BUTIR SOAL', MARGIN + 13, 14.5);
        pdf.setTextColor(18, 38, 63); pdf.setFontSize(first ? 19 : 13);
        pdf.text('Parameter soal IRT', MARGIN, first ? 26 : 24);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(first ? 10 : 9);
        const titleLines = pdf.splitTextToSize(pdfText(title), 182) as string[];
        pdf.text(titleLines, MARGIN, first ? 34 : 31, { lineHeightFactor: 1.25 });
        y = (first ? 34 : 31) + (titleLines.length - 1) * (first ? 4.5 : 4) + 7;
        pdf.setFontSize(8); pdf.setTextColor(100, 116, 139);
        pdf.text(`Dihitung ${date} ${getSchoolTimeZoneLabel(zone)}`, MARGIN, y);
        y += 6;
        if (first) {
            const metrics = [['PESERTA', String(irt.participant_count)], ['BUTIR SOAL', String(irt.items.length)],
                ['MODEL', models], ['PERLU DITINJAU', String(irt.items.filter(item => item.flags.length).length)]];
            metrics.forEach(([label, value], index) => {
                const x = MARGIN + index * 46;
                pdf.setFillColor(245, 248, 252); pdf.roundedRect(x, y, 44, 16, 1.5, 1.5, 'F');
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139); pdf.text(label, x + 3, y + 5);
                pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(18, 38, 63); pdf.text(value, x + 3, y + 12);
            });
            y += 22;
        } else y += 2;
        pdf.setFillColor(231, 238, 247); pdf.rect(MARGIN, y, 182, 12, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(38, 65, 100);
        columns.forEach((column, index) => {
            const lines = pdf.splitTextToSize(column.label, column.width - 4) as string[];
            pdf.text(lines, xs[index] + 2, y + (lines.length > 1 ? 4.5 : 7), { lineHeightFactor: 1.15 });
        });
        y += 12;
        bodyTop = y;
    };
    header(true);
    for (const item of irt.items) {
        const { canvas, breaks } = await captureQuestion(item, columns[1].width - 5);
        let imageWidth = columns[1].width - 5;
        let mmPerPixel = imageWidth / canvas.width;
        const noteLines = pdf.splitTextToSize(pdfText(item.flags.join(', ') || '-'), 23) as string[];
        const notesHeight = noteLines.length * 3.4;
        const fullHeight = Math.max(16, canvas.height * mmPerPixel + 6, notesHeight + 6);
        if (y + fullHeight > BOTTOM && y > bodyTop) { pdf.addPage(); header(false); }
        let offset = 0;
        while (offset < canvas.height) {
            const capacity = BOTTOM - y;
            let pixels = Math.min(canvas.height - offset, Math.floor((capacity - 6) / mmPerPixel + 1e-6));
            if (offset + pixels < canvas.height) {
                const safeBreak = breaks.filter(end => end > offset && end <= offset + pixels).at(-1);
                if (safeBreak) pixels = safeBreak - offset;
                else {
                    // An indivisible oversized equation/figure must be fitted, never sliced.
                    pixels = canvas.height - offset;
                    mmPerPixel = (capacity - 6) / pixels;
                    imageWidth = canvas.width * mmPerPixel;
                }
            }
            if (pixels <= 0) { pdf.addPage(); header(false); continue; }
            const height = Math.max(16, pixels * mmPerPixel + 6, notesHeight + 6);
            pdf.setFillColor(255, 255, 255);
            pdf.rect(MARGIN, y, 182, height, 'F');
            if (item.flags.length) {
                pdf.setFillColor(232, 176, 76); pdf.rect(MARGIN, y + 2, 0.6, height - 4, 'F');
            }
            let image = canvas;
            if (offset || pixels < canvas.height) {
                image = document.createElement('canvas'); image.width = canvas.width; image.height = pixels;
                const context = image.getContext('2d');
                if (!context) throw new Error('Rumus soal belum dapat dirender ke PDF.');
                context.drawImage(canvas, 0, offset, canvas.width, pixels, 0, 0, canvas.width, pixels);
            }
            pdf.addImage(image.toDataURL('image/png'), 'PNG', xs[1] + 2.5, y + (height - pixels * mmPerPixel) / 2, imageWidth, pixels * mmPerPixel);
            const centerY = y + height / 2;
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(18, 38, 63);
            pdf.text(String(item.number || '-'), xs[0] + 2, centerY - (offset ? 2 : 0), { baseline: 'middle' });
            pdf.setFont('helvetica', 'normal');
            const values = [`${(item.p * 100).toFixed(1)}%`, item.b.toFixed(2), ...(showA ? [item.a.toFixed(2)] : []), ...(showC ? [item.c.toFixed(2)] : [])];
            values.forEach((value, index) => pdf.text(value, xs[index + 2] + 2, centerY - (index < 2 ? 2.1 : 0), { baseline: 'middle' }));
            pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139);
            pdf.text(`${item.correct}/${item.total}`, xs[2] + 2, centerY + 2.1, { baseline: 'middle' });
            pdf.text(difficultyLabel(item.b).label, xs[3] + 2, centerY + 2.1, { baseline: 'middle' });
            if (offset) pdf.text('lanj.', xs[0] + 1, centerY + 2, { baseline: 'middle' });
            pdf.setFontSize(7); pdf.setTextColor(item.flags.length ? 146 : 100, item.flags.length ? 86 : 116, item.flags.length ? 18 : 139);
            pdf.text(noteLines, xs[xs.length - 1] + 2, centerY - (noteLines.length - 1) * 3.334 / 2, { lineHeightFactor: 1.35, baseline: 'middle' });
            pdf.setDrawColor(224, 231, 240); pdf.setLineWidth(0.18); pdf.line(MARGIN, y + height, 196, y + height);
            y += height;
            offset += pixels;
            if (offset < canvas.height) { pdf.addPage(); header(false); }
        }
    }
    if (!irt.items.length) { pdf.setFontSize(9); pdf.text('Belum ada butir objektif yang dihitung.', MARGIN + 3, y + 10); }
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        pdf.setPage(page); pdf.setDrawColor(224, 231, 240); pdf.line(MARGIN, 284, 196, 284);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(100, 116, 139);
        pdf.text(`ACCA CBT  /  IRT ${models}  /  ${irt.items.length} butir`, MARGIN, 289);
        pdf.text(`Halaman ${page} dari ${pages}`, 196, 289, { align: 'right' });
    }
    return pdf;
}

export async function exportIrtParametersToPdf(irt: IrtCalibration, title: string, timeZone?: string) {
    const pdf = await buildIrtParametersPdf(irt, title, timeZone);
    pdf.save(irtPdfFileName(title));
}
