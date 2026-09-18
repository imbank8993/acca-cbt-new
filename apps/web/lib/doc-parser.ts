/**
 * doc-parser.ts — Parse DOCX import template via JSZip + XML.
 * Membaca word/document.xml langsung dari dalam DOCX, bypass mammoth.
 * Dijalankan di server-side (Next.js "use server" / Server Actions).
 */
import * as JSZip from 'jszip';
import { QuestionType } from '@/lib/api/questions';
// @ts-ignore
import omml2mathml from 'omml2mathml';

const getDOMParser = () => {
    if (typeof window !== 'undefined' && (window as any).DOMParser) {
        return new (window as any).DOMParser();
    }
    const { DOMParser } = require('@xmldom/xmldom');
    return new DOMParser();
};

const getXMLSerializer = () => {
    if (typeof window !== 'undefined' && (window as any).XMLSerializer) {
        return new (window as any).XMLSerializer();
    }
    const { XMLSerializer } = require('@xmldom/xmldom');
    return new XMLSerializer();
};

async function preprocessDocx(file: File): Promise<ArrayBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const docXmlObj = zip.file('word/document.xml');
    if (!docXmlObj) return arrayBuffer;
    const docXml = await docXmlObj.async('string');
    
    const parser = getDOMParser();
    const doc = parser.parseFromString(docXml, 'application/xml');
    
    // Find all oMath elements
    let oMaths = Array.from(doc.getElementsByTagName('m:oMath')) as any[];
    if (oMaths.length === 0) {
        oMaths = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath')) as any[];
    }
    
    for (const oMath of oMaths) {
        try {
            const mathmlNode = omml2mathml(oMath);
            const mathmlString = mathmlNode.outerHTML;
            
            const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
            const wR = doc.createElementNS(wNs, 'w:r');
            const wT = doc.createElementNS(wNs, 'w:t');
            
            wT.textContent = `[EQUATION_START]${mathmlString}[EQUATION_END]`;
            wR.appendChild(wT);
            
            const parent = oMath.parentNode;
            if (parent) {
                parent.replaceChild(wR, oMath);
            }
        } catch (err) {
            console.error('[doc-parser] Failed to convert equation:', err);
        }
    }
    
    // Process paragraph alignments
    const paragraphs = Array.from(doc.getElementsByTagName('w:p')) as any[];
    for (const p of paragraphs) {
        const jc = p.getElementsByTagName('w:jc')[0];
        if (jc) {
            const align = jc.getAttribute('w:val') || jc.getAttribute('val');
            if (align && ['both', 'center', 'right'].includes(align)) {
                const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
                let firstRun = p.getElementsByTagName('w:r')[0];
                if (!firstRun) {
                    firstRun = doc.createElementNS(wNs, 'w:r');
                    const wT = doc.createElementNS(wNs, 'w:t');
                    wT.textContent = '';
                    firstRun.appendChild(wT);
                    const pPr = p.getElementsByTagName('w:pPr')[0];
                    if (pPr && pPr.nextSibling) {
                        p.insertBefore(firstRun, pPr.nextSibling);
                    } else {
                        p.appendChild(firstRun);
                    }
                }
                
                let wT = firstRun.getElementsByTagName('w:t')[0];
                if (!wT) {
                    wT = doc.createElementNS(wNs, 'w:t');
                    wT.textContent = '';
                    firstRun.appendChild(wT);
                }
                
                wT.textContent = `[ALIGN_${align.toUpperCase()}]` + wT.textContent;
            }
        }
    }
    
    const serializer = getXMLSerializer();
    const updatedDocXml = serializer.serializeToString(doc);
    
    zip.file('word/document.xml', updatedDocXml);
    return await zip.generateAsync({ type: 'arraybuffer' });
}

function decodeEntities(str: string): string {
    return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function postProcessHtml(html: string): string {
    if (!html) return '';
    
    let restored = html.replace(/\[EQUATION_START\]([\s\S]*?)\[EQUATION_END\]/g, (match, mathml) => {
        return decodeEntities(mathml);
    });
    
    const alignStyles: Record<string, string> = {
        'BOTH': 'justify',
        'CENTER': 'center',
        'RIGHT': 'right'
    };
    
    const markers = ['ALIGN_BOTH', 'ALIGN_CENTER', 'ALIGN_RIGHT'];
    
    for (const marker of markers) {
        const alignType = marker.split('_')[1];
        const styleVal = alignStyles[alignType];
        
        const regex = new RegExp(`<([p|td|th|h1|h2|h3|h4|h5|h6|div])([^>]*)>(((?!<p|<td|<tr>).)*?)\\[${marker}\\]`, 'gi');
        
        restored = restored.replace(regex, (match, tagName, attrs, intermediate) => {
            let newAttrs = attrs;
            const styleMatch = attrs.match(/style="([^"]*)"/i);
            if (styleMatch) {
                const existingStyle = styleMatch[1];
                const separator = existingStyle && !existingStyle.endsWith(';') ? ';' : '';
                newAttrs = attrs.replace(/style="([^"]*)"/i, `style="${existingStyle}${separator}text-align: ${styleVal};"`);
            } else {
                newAttrs = `${attrs} style="text-align: ${styleVal};"`;
            }
            return `<${tagName}${newAttrs}>${intermediate}`;
        });
    }
    
    return restored;
}

function getCellInnerHTML(cell: any): string {
    if (typeof cell.innerHTML !== 'undefined') {
        return cell.innerHTML;
    }
    const serializer = getXMLSerializer();
    let html = '';
    if (cell.childNodes) {
        for (let i = 0; i < cell.childNodes.length; i++) {
            html += serializer.serializeToString(cell.childNodes[i]);
        }
    }
    return html;
}


export interface ParsedQuestion {
    question_text: string;
    type: QuestionType;
    difficulty: 'easy' | 'medium' | 'hard';
    scoreDefault: number;
    options: {
        text: string;
        isCorrect: boolean;
        order: number;
        weight: number;
        metadata?: any;
    }[];
    metadata: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Ambil semua teks dari XML element (recursive, termasuk nested runs) */
function getXmlText(node: Element | null): string {
    if (!node) return '';
    let text = '';
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.nodeType === 3) {
            text += child.textContent || '';
        } else if (child.nodeType === 1) {
            text += getXmlText(child as Element);
        }
    }
    return text;
}

/** Extract text from all <w:t> elements in a cell (most reliable) */
function getCellText(cell: Element): string {
    const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const tElements = cell.getElementsByTagNameNS(wNs, 't');
    let text = '';
    for (let i = 0; i < tElements.length; i++) {
        text += tElements[i].textContent || '';
    }
    return text.trim();
}

function isBlank(s: string | undefined | null): boolean {
    if (!s) return true;
    // Jangan treat "..." (placeholder) sebagai blank
    if (s.trim() === '...') return false;
    // Jika ada gambar atau elemen khusus, maka tidak kosong
    if (s.includes('<img') || s.includes('<table') || s.includes('<iframe')) return false;
    // Hapus semua tag HTML dan cek apakah tersisa hanya spasi/kosong
    const textOnly = s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return /^\s*$/.test(textOnly);
}

/** Normalize teks header: hapus slash, dash, spasi berlebihan */
function normalize(s: string): string {
    return s.toUpperCase().replace(/[\/\\|\-_–\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseQuestionType(raw: string): QuestionType {
    const s = normalize(raw);
    if (/^(PG|PILIHAN\s*GANDA|MCQ)$/i.test(raw)) return 'mcq';
    if (/PGK|COMPLEX|KOMPLEKS/i.test(raw)) return 'mcq_complex';
    if (/^BS|BENAR\s*SALAH|B\/S|TF|TRUEFALSE$/i.test(raw)) return 'true_false';
    if (/^MJ|MATCHING|MENJODOHKAN/i.test(raw)) return 'matching';
    if (/^CAT|KATEGORISASI|PENGELOMPOKAN/i.test(raw)) return 'categorization';
    if (/^ISIAN|SHORT|ISI\s*SINGKAT/i.test(raw)) return 'short_answer';
    if (/^ESAI|URAIAN|ESSAY/i.test(raw)) return 'essay';
    if (/SJT|SITUATIONAL/i.test(raw)) return 'sjt';
    if (/URUT|PENGURUTAN|ORDERING/i.test(raw)) return 'ordering';
    if (/LIKERT/i.test(raw)) return 'likert' as QuestionType;
    if (/FC|FORCED/i.test(raw)) return 'forced_choice' as QuestionType;
    if (/CEK|CHECKLIST/i.test(raw)) return 'checklist' as QuestionType;
    if (/RANK/i.test(raw)) return 'ranking' as QuestionType;
    if (/PC|PAIRED/i.test(raw)) return 'paired_comparison' as QuestionType;
    return 'mcq';
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCX → TABLES (via JSZip)
// ─────────────────────────────────────────────────────────────────────────────

interface RowData {
    cells: string[];
}

function getTableHeaders(rows: RowData[]): string[] {
    if (rows.length === 0) return [];
    return rows[0].cells.map(c => c.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
}

async function extractTablesFromDocx(file: File): Promise<{ tables: RowData[][]; tableHeaders: string[][] }> {
    const mammoth = await import('mammoth');
    const preprocessedBuffer = await preprocessDocx(file);
    
    // Konversi langsung ke HTML untuk mempertahankan gambar dan tabel bersarang
    const mammothOptions: any = {};
    if (typeof window === 'undefined') {
        mammothOptions.buffer = Buffer.from(preprocessedBuffer);
    } else {
        mammothOptions.arrayBuffer = preprocessedBuffer;
    }
    const result = await mammoth.convertToHtml(mammothOptions);
    const html = result.value;

    const parser = getDOMParser();
    const wrappedHtml = typeof window === 'undefined' ? `<div id="root">${html}</div>` : html;
    const doc = parser.parseFromString(wrappedHtml, typeof window === 'undefined' ? 'text/xml' : 'text/html');
    const tblElements = doc.getElementsByTagName ? doc.getElementsByTagName('table') : doc.querySelectorAll('table');

    const tables: RowData[][] = [];
    const tableHeaders: string[][] = [];

    for (let t = 0; t < tblElements.length; t++) {
        const tbl = tblElements[t];
        const rows: RowData[] = [];
        
        let trList: HTMLTableRowElement[] = [];
        // Cari baris utama secara dangkal agar tidak mengambil baris dari tabel bersarang
        Array.from(tbl.children || []).forEach((child: any) => {
            if (child.tagName.toLowerCase() === 'tr') {
                trList.push(child as HTMLTableRowElement);
            } else if (['tbody', 'thead', 'tfoot'].includes(child.tagName.toLowerCase())) {
                Array.from(child.children || []).forEach((gc: any) => {
                    if (gc.tagName.toLowerCase() === 'tr') {
                        trList.push(gc as HTMLTableRowElement);
                    }
                });
            }
        });

        for (let r = 0; r < trList.length; r++) {
            const tr = trList[r];
            const tcList = Array.from(tr.children).filter(c => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
            const cells: string[] = [];

            for (let c = 0; c < tcList.length; c++) {
                // Simpan format HTML seutuhnya! (Tabel & Gambar akan tetap ada di sini)
                cells.push(postProcessHtml(getCellInnerHTML(tcList[c])));
            }

            if (cells.length > 0) {
                rows.push({ cells });
            }
        }

        if (rows.length > 0) {
            tables.push(rows);
            tableHeaders.push(getTableHeaders(rows));
        }
    }

    console.log('[doc-parser] Mammoth extracted', tables.length, 'tables');
    return { tables, tableHeaders };
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE → QUESTIONS
// ─────────────────────────────────────────────────────────────────────────────

const stripHtml = (html: string | undefined | null) => html ? html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : '';

function parseAllTables(tables: RowData[][], tableHeaders: string[][]): { questions: ParsedQuestion[]; stimulusMap: Record<string, string>; instructionMap: Record<string, string>; kisiMap: Record<string, string> } {
    // ── Phase 1: Extract stimulus, instruction and kisi-kisi tables ─────────────
    const stimulusMap: Record<string, string> = {};
    const instructionMap: Record<string, string> = {};
    const kisiMap: Record<string, string> = {};
    const stimulusTitles: Record<string, string> = {};
    const instructionTitles: Record<string, string> = {};

    for (let i = 0; i < tables.length; i++) {
        const headers = tableHeaders[i];
        const rows = tables[i];
        console.log(`[doc-parser] Table ${i}: ${rows.length} rows, ${headers.length} cols, headers="${headers.join('|')}"`);

        // Detect by header text
        const headerStr = headers.join('|').toUpperCase();
        const hasStimHeader = /STIMULUS|DAFTAR\s*STIMULUS/i.test(headerStr);
        const hasInstHeader = /PETUNJUK|INSTRUKSI|DAFTAR\s*PETUNJUK/i.test(headerStr);
        const hasKisiHeader = /KISI|KD\/CP/i.test(headerStr);

        // ── Kisi-kisi table ───────────────────────────────────────────────────
        if (hasKisiHeader) {
            console.log(`[doc-parser] → Table ${i} is KISI-KISI`);
            for (let r = 1; r < rows.length; r++) {
                const cells = rows[r].cells;
                if (cells.length < 2) continue;
                const numbers = cells[0].replace(/<[^>]*>/g, '').split(',').map(s => s.trim()).filter(Boolean);
                if (numbers.length === 0) continue;
                
                // If it's the new 5-column format: Nomor Soal | Nomor KD/CP | KD/CP | Materi | Indikator Soal
                if (headers.length >= 5) {
                    const kisiObj = {
                        nomor_kd: stripHtml(cells[1]),
                        kd_cp: stripHtml(cells[2]),
                        materi: stripHtml(cells[3]),
                        indikator_soal: stripHtml(cells[4]),
                        level_kognitif: stripHtml(cells[5])
                    };
                    for (const num of numbers) {
                        kisiMap[num] = JSON.stringify(kisiObj);
                    }
                    console.log(`[doc-parser]   ✓ Soal ${numbers.join(', ')} (JSON): "${kisiObj.nomor_kd} - ${kisiObj.materi}"`);
                } else {
                    // Fallback to old text parsing
                    let parts = [];
                    for (let c = 1; c < cells.length; c++) {
                        const header = headers[c] || `Kolom ${c}`;
                        const val = stripHtml(cells[c]);
                        if (val) {
                            parts.push(`${header}: ${val}`);
                        }
                    }
                    const content = parts.join('\n');
                    if (content) {
                        for (const num of numbers) {
                            kisiMap[num] = content;
                        }
                        console.log(`[doc-parser]   ✓ Soal ${numbers.join(', ')} (Text): "${content.substring(0, 50).replace(/\n/g, ' ')}..."`);
                    }
                }
            }
            continue;
        }

        // ── Instruction table ─────────────────────────────────────────────────
        if (hasInstHeader) {
            if (headers.length >= 2) {
                console.log(`[doc-parser] → Table ${i} is INSTRUCTION`);
                for (let r = 1; r < rows.length; r++) {
                    const cells = rows[r].cells;
                    if (cells.length < 2) continue;
                    const numbers = cells[0].replace(/<[^>]*>/g, '').split(',').map(s => s.trim()).filter(Boolean);
                    if (numbers.length === 0) continue;
                    // 3-col: Nomor Soal | Judul | Isi Petunjuk
                    const is3Col = headers.length >= 3;
                    const contentStr = is3Col ? cells[2] : cells[cells.length - 1];
                    const content = contentStr ? contentStr.trim() : '';
                    const title = is3Col ? stripHtml(cells[1]) : '';
                    if (content) {
                        for (const num of numbers) {
                            instructionMap[num] = content;
                            instructionTitles[num] = title;
                        }
                        console.log(`[doc-parser]   ✓ Soal ${numbers.join(', ')} [${title}]: "${content.substring(0, 50)}"`);
                    } else {
                        console.log(`[doc-parser]   ✗ Soal ${numbers.join(', ')} skipped — empty content`);
                    }
                }
                continue;
            }
        }

        // ── Stimulus table ────────────────────────────────────────────────────
        if (hasStimHeader) {
            if (headers.length >= 2) {
                console.log(`[doc-parser] → Table ${i} is STIMULUS`);
                for (let r = 1; r < rows.length; r++) {
                    const cells = rows[r].cells;
                    if (cells.length < 2) continue;
                    const numbers = cells[0].replace(/<[^>]*>/g, '').split(',').map(s => s.trim()).filter(Boolean);
                    if (numbers.length === 0) continue;
                    // 3-col: Nomor Soal | Judul | Isi Stimulus
                    const is3Col = headers.length >= 3;
                    const contentStr = is3Col ? cells[2] : cells[cells.length - 1];
                    const content = contentStr ? contentStr.trim() : '';
                    const title = is3Col ? stripHtml(cells[1]) : '';
                    if (content) {
                        for (const num of numbers) {
                            stimulusMap[num] = content;
                            stimulusTitles[num] = title;
                        }
                        console.log(`[doc-parser]   ✓ Soal ${numbers.join(', ')} [${title}]: "${content.substring(0, 50)}"`);
                    } else {
                        console.log(`[doc-parser]   ✗ Soal ${numbers.join(', ')} skipped — empty content`);
                    }
                }
                continue;
            }
        }
    }

    console.log(`[doc-parser] Stimulus map:`, JSON.stringify(stimulusMap));
    console.log(`[doc-parser] Instruction map:`, JSON.stringify(instructionMap));
    console.log(`[doc-parser] Kisi-kisi map:`, JSON.stringify(kisiMap));

    // ── Phase 2: Find question table ─────────────────────────────────────────
    let questionTable: RowData[] | null = null;

    // Cari tabel dengan header "No" dan "Soal"
    for (let i = 0; i < tables.length; i++) {
        const rows = tables[i];
        if (rows.length < 2) continue;
        const headers = tableHeaders[i].map(normalize); // Use pre-stripped headers

        const hasNo = headers.some(h => /^(NO\.?|NOMOR|#)$/i.test(h));
        const hasSoal = headers.some(h => h.includes('SOAL') || h.includes('PERTANYAAN') || h.includes('PERNYATAAN') || h.includes('ITEM') || h.includes('OPSI'));

        if (hasNo && hasSoal) {
            if (!questionTable || rows.length > questionTable.length) {
                questionTable = rows;
                console.log('[doc-parser] Identified question table:', rows.length, 'rows');
            }
        }
    }

    // Fallback: cari tabel dengan baris data bernomor
    if (!questionTable) {
        for (const rows of tables) {
            if (rows.length < 3) continue;
            let numCount = 0;
            for (let r = 1; r < rows.length; r++) {
                if (/^\d+$/.test(stripHtml(rows[r].cells[0]))) numCount++;
            }
            if (numCount >= 2) {
                questionTable = rows;
                console.log('[doc-parser] Using fallback table with', numCount, 'numbered rows');
                break;
            }
        }
    }

    if (!questionTable) {
        console.warn('[doc-parser] Tidak ada tabel soal yang ditemukan');
        return { questions: [], stimulusMap, instructionMap, kisiMap };
    }

    return {
        questions: parseQuestionTable(questionTable, stimulusMap, instructionMap, stimulusTitles, instructionTitles, kisiMap),
        stimulusMap,
        instructionMap,
        kisiMap
    };
}

function parseQuestionTable(
    rows: RowData[],
    stimulusMap: Record<string, string> = {},
    instructionMap: Record<string, string> = {},
    stimulusTitles: Record<string, string> = {},
    instructionTitles: Record<string, string> = {},
    kisiMap: Record<string, string> = {}
): ParsedQuestion[] {
    const headers = getTableHeaders(rows).map(normalize);

    // Column mapping
    const colMap: Record<string, number> = {};
    for (let c = 0; c < headers.length; c++) {
        const h = headers[c];
        if (colMap['no'] === undefined && /^(NO\.?|NOMOR|#)$/i.test(h)) colMap['no'] = c;
        else if (colMap['tipe'] === undefined && /^(TIPE|JENIS|TYPE)$/i.test(h)) colMap['tipe'] = c;
        else if (colMap['soal'] === undefined && (h.includes('SOAL') || h.includes('PERTANYAAN') || h.includes('PERNYATAAN') || h.includes('ITEM') || h.includes('OPSI'))) colMap['soal'] = c;
        else if (colMap['stimulus'] === undefined && /^STIMULUS$/i.test(h)) colMap['stimulus'] = c;
        else if (colMap['petunjuk'] === undefined && /^(PETUNJUK|INSTRUKSI|ARAHAN)$/i.test(h)) colMap['petunjuk'] = c;
        else if (colMap['kisi'] === undefined && /kisi/i.test(h)) colMap['kisi'] = c;
        else if (colMap['kunci'] === undefined && /^(KUNCI|JAWABAN|DIMENSI)$/i.test(h)) colMap['kunci'] = c;
        else if (colMap['skor'] === undefined && /^(SKOR|POIN|NILAI|SCORE|BOBOT)$/i.test(h)) colMap['skor'] = c;
        else if (colMap['optA'] === undefined && h === 'A') colMap['optA'] = c;
        else if (colMap['optB'] === undefined && h === 'B') colMap['optB'] = c;
        else if (colMap['optC'] === undefined && h === 'C') colMap['optC'] = c;
        else if (colMap['optD'] === undefined && h === 'D') colMap['optD'] = c;
        else if (colMap['optE'] === undefined && h === 'E') colMap['optE'] = c;
    }

    console.log('[doc-parser] Column map:', JSON.stringify(colMap));

    if (colMap['no'] === undefined || colMap['soal'] === undefined) {
        console.warn('[doc-parser] Kolom wajib tidak ditemukan. no=', colMap['no'], 'soal=', colMap['soal']);
        return [];
    }

    const questions: ParsedQuestion[] = [];
    let current: ParsedQuestion | null = null;
    let currentOpts: ParsedQuestion['options'] = [];
    let currentKunci = '';
    let currentMetadata: any = {};

    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].cells;

        const getCol = (key: string): string => {
            const idx = colMap[key];
            return idx !== undefined && idx < cells.length ? cells[idx] : '';
        };

        const getColText = (key: string): string => {
            return getCol(key).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        };

        const noRaw = getColText('no');
        const tipeRaw = getColText('tipe');
        const soalRaw = getCol('soal'); // Tetap simpan format HTML untuk soal
        const kunciRaw = getColText('kunci');
        const skorRaw = getColText('skor');

        const isNumberedRow = /^\d+$/.test(noRaw);

        if (isNumberedRow) {
            if (current) {
                current.options = currentOpts;
                questions.push(current);
            }

            // Jika sub-baris (angka) muncul BUKAN di awal file
            // dan baris ini TIDAK memiliki teks soal → sub-item dari pertanyaan aktif
            if (!current && i > 1 && isBlank(soalRaw)) {
                // Sub-item BS/MJ/CAT tanpa teks pertanyaan utama
                // Abaikan baris ini, lanjut ke baris berikutnya
                continue;
            }

            if (isBlank(soalRaw)) {
                current = null; currentOpts = []; currentKunci = ''; currentMetadata = {};
                continue;
            }

            const type = parseQuestionType(tipeRaw);
            const score = /^\d+(\.\d+)?$/.test(skorRaw) ? parseFloat(skorRaw) : 1;

            currentKunci = kunciRaw;
            
            const resolvedStimulus = stimulusMap[noRaw] || '';
            const resolvedInstruction = instructionMap[noRaw] || '';
            const resolvedKisi = kisiMap[noRaw] || '';
            
            const isPersonality = ['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(type);

            let kisiData = null;
            let kisiString = resolvedKisi || '';
            try {
                if (kisiString.startsWith('{')) {
                    kisiData = JSON.parse(kisiString);
                    kisiString = `KD: ${kisiData.nomor_kd}, Materi: ${kisiData.materi}`;
                }
            } catch (e) {
                console.error('[doc-parser] Failed to parse Kisi-kisi JSON', e);
            }

            currentMetadata = {
                import_stimulus: resolvedStimulus || '',
                import_instruction: resolvedInstruction || '',
                _stimulus_code: resolvedStimulus ? noRaw : '',
                _instruction_code: resolvedInstruction ? noRaw : '',
                stimulus_title: stimulusTitles[noRaw] || '',
                instruction_title: instructionTitles[noRaw] || '',
                kisi_kisi: kisiString,
                kisi_kisi_data: kisiData,
                dimension: isPersonality ? (kunciRaw || '') : '',
            };
            if (type === 'mcq_complex') currentMetadata.isComplex = true;

            if (type === 'short_answer' && currentKunci) {
                const blanks = currentKunci.split('|').map((part, idx) => {
                    const vars = part.split(',').map(s => s.trim()).filter(Boolean);
                    if (!vars[0]) return null;
                    return { id: `blank_${Date.now()}_${idx}`, answer: vars[0], variations: vars.slice(1) };
                }).filter(Boolean);
                if (blanks.length > 0) currentMetadata.blanks = blanks;
            }

            // Collect right_items from sub-baris Kunci for matching question
            if (type === 'matching') {
                currentMetadata.right_items = [];
            }
            // NOTE: untuk CAT, categories di-populate dari sub-bariskarena kunci sub-row = nama kategori

            current = {
                question_text: soalRaw,
                type,
                difficulty: 'medium',
                scoreDefault: score,
                options: [],
                metadata: currentMetadata,
            };
            currentOpts = [];

            console.log(`[doc-parser] Q${noRaw} type=${type}: "${soalRaw.substring(0, 60)}"`);

        } else if (current) {
            const tipeUpper = tipeRaw.toUpperCase().trim();
            // Kunci untuk sub-row: jika kolom Kunci sub-row kosong, gunakan kunci baris utama
            // (untuk BS: kunci baris utama seperti "B|S"; untuk MJ/CAT: kolom Kunci sub-row TERISI)
            const effectiveKunci = (!isBlank(kunciRaw)) ? kunciRaw : currentKunci;

            // ── Opsi PG/PGK: Tipe = A/B/C/D/E di kolom Tipe, teks di kolom Soal ─
            if (['mcq', 'mcq_complex'].includes(current.type) && /^[A-E]$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                // Tipe = huruf opsi (A-E) → cek apakah ada di kunci baris utama
                const kunciArr = currentKunci.split(/[,;|\/\\]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
                const isCorrect = kunciArr.includes(tipeRaw.toUpperCase());
                currentOpts.push({ text: stripOptionHtml(soalRaw), isCorrect, order: currentOpts.length, weight: isCorrect ? 1 : 0 });
            }
            // ── Sub-item BS: Tipe = P1/P2/P3... ───────────────────────────────────
            else if (current.type === 'true_false' && /^P\d+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                const pNum = parseInt(tipeRaw.substring(1));
                // Kunci dari baris utama, contoh: "B|S|B" → ["B","S","B"]
                const kunciArr = effectiveKunci.split('|').map(s => s.trim().toUpperCase());
                const isBenar = kunciArr[pNum - 1] === 'B';
                currentOpts.push({ text: stripOptionHtml(soalRaw), isCorrect: isBenar, order: currentOpts.length, weight: isBenar ? 1 : 0 });
            }
            // ── Sub-item MJ: Tipe = MJ1/MJ2/... ──────────────────────────────────
            else if (current.type === 'matching' && /^MJ\d+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                // Kunci sub-row MJ = item kanan (jawaban yang cocok)
                const matchText = (!isBlank(kunciRaw)) ? kunciRaw.trim() : '';
                currentOpts.push({
                    text: stripOptionHtml(soalRaw),
                    isCorrect: true,
                    order: currentOpts.length,
                    weight: 1,
                    metadata: { match_texts: matchText ? [matchText] : [] }
                } as any);
                if (matchText && current.metadata) {
                    const ri = (current.metadata.right_items as string[]);
                    if (!ri.includes(matchText)) ri.push(matchText);
                }
            }
            // ── Sub-item CAT: Tipe = CAT1/CAT2/... ───────────────────────────────
            else if (current.type === 'categorization' && /^CAT\d+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                // Kunci sub-row CAT = nama kategori(2)
                const categoryRaw = (!isBlank(kunciRaw)) ? kunciRaw.trim() : '';
                // Support comma-separated: "Mamalia, Vertebrata" → both categories assigned
                const categories = categoryRaw
                    ? categoryRaw.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                currentOpts.push({
                    text: stripOptionHtml(soalRaw),
                    isCorrect: true,
                    order: currentOpts.length,
                    weight: 1,
                    metadata: { category_names: categories }
                } as any);
                // Auto-derive question-level categories list from sub-rows
                if (current.metadata) {
                    const existingCats = (current.metadata.categories as string[]) || [];
                    for (const cat of categories) {
                        if (!existingCats.includes(cat)) existingCats.push(cat);
                    }
                    current.metadata.categories = existingCats;
                }
            }
            // ── Sub-item SJT: Tipe = A/B/C/D/E di kolom Tipe, skor/bobot di kolom Poin ─
            else if (current.type === 'sjt' && /^[A-E]$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                const kunciArr = currentKunci.split(/[,;|\/\\]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
                const isCorrect = kunciArr.includes(tipeRaw.toUpperCase());
                const weight = !isNaN(parseFloat(skorRaw)) ? parseFloat(skorRaw) : 0;
                currentOpts.push({ text: stripOptionHtml(soalRaw), isCorrect, order: currentOpts.length, weight, metadata: effectiveKunci ? { dimension: effectiveKunci } : {} });
            }
            // ── Sub-item Ordering: Tipe = 1/2/3... atau U1/U2... di kolom Tipe ────────────────
            else if (current.type === 'ordering' && /^(U|u)?\d+$/.test(tipeRaw) && !isBlank(soalRaw)) {
                currentOpts.push({ text: stripOptionHtml(soalRaw), isCorrect: true, order: currentOpts.length, weight: 1 });
            }
            // ── Sub-item Kepribadian (FC/CEK/RANK/PC): Tipe = FC1, C1, R1, P1, A, B, dsb. ────
            else if (['forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(current.type)) {
                if (/^(FC|C|R|P|U|A|B|C|D|E|PC)?[\w-]*$/i.test(tipeRaw.trim()) && !isBlank(soalRaw)) {
                     const weight = !isNaN(parseFloat(skorRaw)) ? parseFloat(skorRaw) : (current.type === 'checklist' ? 1 : 0);
                     currentOpts.push({
                         text: stripOptionHtml(soalRaw),
                         isCorrect: true, 
                         order: currentOpts.length,
                         weight: weight,
                         metadata: { dimension: effectiveKunci || '' }
                     });
                }
            }
            // ── Sub-item ISIAN: Tipe = ISIAN ─────────────────────────────────────
            // Baris utama ISIAN sudah di-parse di atas, tidak ada sub-item Opsi
        }
    }

    if (current) {
        current.options = currentOpts;
        questions.push(current);
    }

    // Auto-detect true_false dari teks opsi
    for (const q of questions) {
        if (q.type === 'mcq' && q.options.length === 2) {
            const texts = q.options.map(o => (o.text || '').toUpperCase());
            const hasBenar = texts.some(t => /^(BENAR|TRUE|BETUL)$/.test(t.trim()));
            const hasSalah = texts.some(t => /^(SALAH|FALSE|TIDAK)$/.test(t.trim()));
            if (hasBenar && hasSalah) q.type = 'true_false';
        }
        if (!q.scoreDefault || isNaN(q.scoreDefault)) q.scoreDefault = 1;
    }

    console.log('[doc-parser] Total parsed questions:', questions.length);
    return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
const stripOptionHtml = (text: string) => text ? String(text).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() : '';

export async function parseDocxToQuestions(file: File): Promise<ParsedQuestion[]> {
    try {
        const { tables, tableHeaders } = await extractTablesFromDocx(file);
        if (tables.length === 0) {
            console.warn('[doc-parser] Tidak ada tabel ditemukan dalam DOCX');
            return [];
        }
        const { questions } = parseAllTables(tables, tableHeaders);
        return questions;
    } catch (err: any) {
        console.error('[doc-parser] Error:', err);
        return [];
    }
}

export async function parseDocxToStimuliOrInstructions(file: File, kind?: 'stimulus' | 'instruction'): Promise<{ title: string, content: string }[]> {
    try {
        const mammoth = await import('mammoth');
        const preprocessedBuffer = await preprocessDocx(file);
        const mammothOptions: any = {};
        if (typeof window === 'undefined') {
            mammothOptions.buffer = Buffer.from(preprocessedBuffer);
        } else {
            mammothOptions.arrayBuffer = preprocessedBuffer;
        }
        const result = await mammoth.convertToHtml(mammothOptions);
        const html = result.value;

        const parser = getDOMParser();
        const wrappedHtml = typeof window === 'undefined' ? `<div id="root">${html}</div>` : html;
        const doc = parser.parseFromString(wrappedHtml, typeof window === 'undefined' ? 'text/xml' : 'text/html');
        const tablesList = doc.getElementsByTagName ? doc.getElementsByTagName('table') : doc.querySelectorAll('table');
        const tables = Array.from(tablesList) as HTMLTableElement[];

        if (tables.length === 0) {
            return [];
        }

        // Tabel referensi stimulus/petunjuk harus:
        // - punya 2 atau 3 kolom
        // - kolom pertama = "Nomor Soal"
        // - kolom terakhir mengandung "Isi Stimulus" / "Isi Petunjuk" (atau generic "Isi")
        // Tabel soal (8 kolom) tidak boleh ikut.

        const getFirstRow = (table: any) => {
            const rows = table.getElementsByTagName('tr');
            return rows.length > 0 ? rows[0] : null;
        };

        const matchesKind = (table: HTMLTableElement, targetKind: 'stimulus' | 'instruction' | undefined) => {
            if (!targetKind) return true; // tidak ada filter → terima semua
            const firstRow = getFirstRow(table);
            if (!firstRow) return false;
            const headers = Array.from(firstRow.children || firstRow.childNodes)
                .filter((c: any) => c.tagName && ['th', 'td'].includes(c.tagName.toLowerCase()))
                .map((c: any) => (c.textContent || '').trim());
            // Harus 2 atau 3 kolom
            if (headers.length < 2 || headers.length > 3) return false;
            // Kolom pertama harus mengandung "Nomor" atau "No"
            if (!/^(NOMOR(\s+SOAL)?|NO(\.)?)$/i.test(headers[0])) return false;
            // Kolom terakhir harus berisi "Isi Stimulus" (untuk stimulus) atau "Isi Petunjuk"/"Isi Instruksi" (untuk instruction)
            const lastHeader = headers[headers.length - 1].toUpperCase();
            if (targetKind === 'stimulus') return /ISI\s*STIMULUS|STIMULUS/i.test(lastHeader);
            return /ISI\s*(PETUNJUK|INSTRUKSI)|PETUNJUK|INSTRUKSI/i.test(lastHeader);
        };

        const hasNumberedRows = (rows: any): boolean => {
            for (let r = 1; r < rows.length; r++) {
                const firstCell = Array.from(rows[r].children || rows[r].childNodes)
                    .find((c: any) => c.tagName && ['td', 'th'].includes(c.tagName.toLowerCase())) as any;
                const text = (firstCell?.textContent || '').trim();
                // Ada setidaknya 1 angka di baris manapun
                if (/\d+/.test(text)) return true;
            }
            return false;
        };

        const candidateTables: HTMLTableElement[] = [];
        tables.forEach((table) => {
            const rows = table.getElementsByTagName('tr');
            if (kind && matchesKind(table, kind) && hasNumberedRows(rows)) candidateTables.push(table);
            else if (!kind) {
                if (matchesKind(table, 'stimulus') && hasNumberedRows(rows)) candidateTables.push(table);
                else if (matchesKind(table, 'instruction') && hasNumberedRows(rows)) candidateTables.push(table);
            }
        });

        // Fallback: jika kind ditentukan tapi tidak ada tabel match (mis. dokumen khusus-stimulus/petunjuk
        // tanpa tabel soal), ambil tabel pertama yang punya 2-3 kolom dan baris data non-kosong.
        if (candidateTables.length === 0 && kind) {
            for (const table of Array.from(tables)) {
                const rows = table.getElementsByTagName('tr');
                if (rows.length < 2) continue;
                const firstRow = rows[0];
                const headers = Array.from(firstRow.children || firstRow.childNodes)
                    .filter((c: any) => c.tagName && ['th', 'td'].includes(c.tagName.toLowerCase()))
                    .map((c: any) => (c.textContent || '').trim());
                if (headers.length >= 2 && headers.length <= 3) {
                    candidateTables.push(table);
                    break;
                }
            }
        }

        const items: { title: string, content: string }[] = [];

        for (const table of candidateTables) {
            const rows = table.getElementsByTagName('tr');

            for (let i = 1; i < rows.length; i++) {
                const cells = Array.from(rows[i].children || rows[i].childNodes)
                    .filter((c: any) => c.tagName && c.tagName.toLowerCase() === 'td') as any[];
                if (cells.length < 2) continue;

                let title = '';
                let content = '';

                if (cells.length >= 3) {
                    title = postProcessHtml(getCellInnerHTML(cells[1]).trim());
                    content = postProcessHtml(getCellInnerHTML(cells[2]).trim());
                } else {
                    title = postProcessHtml(getCellInnerHTML(cells[0]).trim());
                    content = postProcessHtml(getCellInnerHTML(cells[1]).trim());
                }

                // Clean title tag wrap
                title = title.replace(/<[^>]*>/g, '').trim();
                // Strip empty content
                const contentText = content.replace(/<[^>]*>/g, '').trim();

                if (contentText) {
                    items.push({ title, content });
                }
            }
        }

        return items;
    } catch (err: any) {
        console.error('[doc-parser] Error parsing stimuli/instructions from docx:', err);
        return [];
    }
}