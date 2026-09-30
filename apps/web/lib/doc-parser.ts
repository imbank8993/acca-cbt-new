/**
 * doc-parser.ts — Parse DOCX import template via JSZip + XML.
 * Membaca word/document.xml langsung dari dalam DOCX, bypass mammoth.
 * Dijalankan di server-side (Next.js "use server" / Server Actions).
 */
import { QuestionType } from '@/lib/api/questions';
import { DOMParser as XMLDOMParser,XMLSerializer as XMLXMLSerializer } from '@xmldom/xmldom';
import * as JSZip from 'jszip';
import { readQuestionArchive } from './question-archive';
import omml2mathml from 'omml2mathml';

const getDOMParser = () => {
    if (typeof globalThis.DOMParser !== 'undefined') {
        return new globalThis.DOMParser();
    }
    const ServerDOMParser = XMLDOMParser as unknown as typeof DOMParser;
    return new ServerDOMParser();
};

const getXMLSerializer = () => {
    if (typeof globalThis.XMLSerializer !== 'undefined') {
        return new globalThis.XMLSerializer();
    }
    const ServerXMLSerializer = XMLXMLSerializer as unknown as typeof XMLSerializer;
    return new ServerXMLSerializer();
};

async function preprocessDocx(file: File): Promise<ArrayBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const docXmlObj = zip.file('word/document.xml');
    if (!docXmlObj) return arrayBuffer;
    const docXml = await docXmlObj.async('string');
    
    const parser = getDOMParser();
    const doc = parser.parseFromString(docXml, 'application/xml');
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    
    // Find all oMath elements
    let oMaths = Array.from(doc.getElementsByTagName('m:oMath'));
    if (oMaths.length === 0) {
        oMaths = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath'));
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

    // Mammoth drops literal Word tab runs. Replace them with a marker that can
    // be restored as a rendered tab after the DOCX has been converted to HTML.
    const wordTabs = Array.from(doc.getElementsByTagNameNS(wordNamespace, 'tab'));
    for (const wordTab of wordTabs) {
        const text = doc.createElementNS(wordNamespace, 'w:t');
        text.textContent = '[WORD_TAB]';
        wordTab.parentNode?.replaceChild(text, wordTab);
    }
    
    // Process paragraph alignments
    const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
    for (const p of paragraphs) {
        const paragraphProperties = elementChildren(p).find((child) => child.localName === 'pPr');
        const indent = paragraphProperties
            ? elementChildren(paragraphProperties).find((child) => child.localName === 'ind')
            : undefined;
        const readIndent = (name: string): string => {
            if (!indent) return '';
            return indent.getAttributeNS(wordNamespace, name) || indent.getAttribute(`w:${name}`) || '';
        };
        const indentLength = (twips: string, chars: string): string => {
            if (/^-?\d+$/.test(twips)) return `${Number(twips) / 20}pt`;
            if (/^-?\d+$/.test(chars)) return `${Number(chars) / 100}em`;
            return '';
        };
        const indentStyles: string[] = [];
        const leftIndent = indentLength(readIndent('left') || readIndent('start'), readIndent('leftChars') || readIndent('startChars'));
        const rightIndent = indentLength(readIndent('right') || readIndent('end'), readIndent('rightChars') || readIndent('endChars'));
        const firstLineIndent = indentLength(readIndent('firstLine'), readIndent('firstLineChars'));
        const hangingIndent = indentLength(readIndent('hanging'), readIndent('hangingChars'));
        if (leftIndent) indentStyles.push(`margin-left:${leftIndent}`);
        if (rightIndent) indentStyles.push(`margin-right:${rightIndent}`);
        if (hangingIndent) indentStyles.push(`text-indent:-${hangingIndent}`);
        else if (firstLineIndent) indentStyles.push(`text-indent:${firstLineIndent}`);

        const jc = paragraphProperties?.getElementsByTagName('w:jc')[0];
        const align = jc?.getAttribute('w:val') || jc?.getAttribute('val') || '';
        const alignmentMarker = ['both', 'center', 'right'].includes(align)
            ? `[ALIGN_${align.toUpperCase()}]`
            : '';
        const indentMarker = indentStyles.length > 0
            ? `[CBT_INDENT:${indentStyles.join(';')}]`
            : '';

        if (indentMarker || alignmentMarker) {
            let firstRun = elementChildren(p).find((child) => child.localName === 'r');
            if (!firstRun) {
                firstRun = doc.createElementNS(wordNamespace, 'w:r');
                if (paragraphProperties?.nextSibling) {
                    p.insertBefore(firstRun, paragraphProperties.nextSibling);
                } else {
                    p.appendChild(firstRun);
                }
            }

            let text = elementChildren(firstRun).find((child) => child.localName === 't');
            if (!text) {
                text = doc.createElementNS(wordNamespace, 'w:t');
                firstRun.appendChild(text);
            }
            text.textContent = `${indentMarker}${alignmentMarker}${text.textContent || ''}`;
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

    restored = restored.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs: string, content: string) => {
        const indentDeclarations: string[] = [];
        const updatedContent = content.replace(/\[CBT_INDENT:([^\]]+)\]/g, (_marker, declarations: string) => {
            for (const declaration of declarations.split(';')) {
                if (/^(?:margin-left|margin-right|text-indent):-?\d+(?:\.\d+)?(?:pt|em)$/.test(declaration)) {
                    indentDeclarations.push(declaration);
                }
            }
            return '';
        });

        if (indentDeclarations.length === 0) return `<p${attrs}>${updatedContent}</p>`;

        const styleMatch = attrs.match(/\sstyle="([^"]*)"/i);
        const style = styleMatch
            ? `${styleMatch[1]}${styleMatch[1] && !styleMatch[1].trimEnd().endsWith(';') ? ';' : ''}${indentDeclarations.join(';')};`
            : `${indentDeclarations.join(';')};`;
        const updatedAttrs = styleMatch
            ? attrs.replace(styleMatch[0], ` style="${style}"`)
            : `${attrs} style="${style}"`;
        return `<p${updatedAttrs}>${updatedContent}</p>`;
    });

    restored = restored.replace(
        /\[WORD_TAB\]/g,
        '<span style="white-space:pre;tab-size:8">&#9;</span>'
    );
    
    return restored;
}

function elementChildren(node: Element): Element[] {
    return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function getCellInnerHTML(cell: Element): string {
    if ('innerHTML' in cell && typeof cell.innerHTML === 'string') {
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
        metadata?: ParsedOptionMetadata;
    }[];
    metadata: ParsedQuestionMetadata;
}

interface ParsedOptionMetadata {
    match_texts?: string[];
    category_names?: string[];
    dimension?: string;
    [key: string]: unknown;
}

interface KisiData {
    materi?: string;
    indikator_soal?: string;
    level_kognitif?: string;
}

interface ParsedQuestionMetadata {
    import_stimulus?: string;
    import_instruction?: string;
    import_source_number?: number;
    _stimulus_code?: string;
    _instruction_code?: string;
    stimulus_title?: string;
    instruction_title?: string;
    kisi_kisi?: string;
    kisi_kisi_data?: KisiData | null;
    dimension?: string;
    isComplex?: boolean;
    correct_order?: string[];
    // Arsip Excel lama tidak selalu memiliki ID blank; ID baru dibuat ketika
    // pertanyaan disimpan ke bank soal.
    blanks?: { id?: string; answer: string; variations: string[] }[];
    right_items?: string[];
    categories?: string[];
    [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────



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
    if (/^(CL|CEK)$|CHECKLIST/i.test(raw)) return 'checklist' as QuestionType;
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
    const mammothOptions = typeof window === 'undefined'
        ? { buffer: Buffer.from(preprocessedBuffer) }
        : { arrayBuffer: preprocessedBuffer };
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
        
        const trList: Element[] = [];
        // Cari baris utama secara dangkal agar tidak mengambil baris dari tabel bersarang
        elementChildren(tbl).forEach((child) => {
            if (child.tagName.toLowerCase() === 'tr') {
                trList.push(child);
            } else if (['tbody', 'thead', 'tfoot'].includes(child.tagName.toLowerCase())) {
                elementChildren(child).forEach((gc) => {
                    if (gc.tagName.toLowerCase() === 'tr') {
                        trList.push(gc);
                    }
                });
            }
        });

        for (let r = 0; r < trList.length; r++) {
            const tr = trList[r];
            const tcList = elementChildren(tr).filter(c => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th');
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

/** Samakan "01", "1.", dan "Soal 1" agar referensi stimulus tidak meleset. */
function normalizeQuestionNumber(value: string): string {
    const match = stripHtml(value).match(/^(?:SOAL\s*)?0*(\d+)\s*[.)]?$/i);
    return match ? String(Number(match[1])) : '';
}

/** Mendukung daftar nomor umum: 1,2; 1 dan 2; serta rentang 1-3. */
function parseQuestionReferences(value: string): string[] {
    const normalized = stripHtml(value).replace(/\bdan\b/gi, ',');
    const result: string[] = [];
    for (const part of normalized.split(/[,;|]+/)) {
        const range = part.match(/^\s*(\d+)\s*[-–—]\s*(\d+)\s*\.?\s*$/);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            if (end >= start && end - start <= 500) {
                for (let number = start; number <= end; number++) result.push(String(number));
            }
            continue;
        }
        const number = normalizeQuestionNumber(part);
        if (number) result.push(number);
    }
    return [...new Set(result)];
}

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
        const hasKisiHeader = /KISI|KD\/CP/i.test(headerStr) ||
            (headers.some(header => /MATERI/i.test(header)) &&
                headers.some(header => /INDIKATOR\s*SOAL/i.test(header)));

        // ── Kisi-kisi table ───────────────────────────────────────────────────
        if (hasKisiHeader) {
            console.log(`[doc-parser] → Table ${i} is KISI-KISI`);
            for (let r = 1; r < rows.length; r++) {
                const cells = rows[r].cells;
                if (cells.length < 2) continue;
                const numbers = parseQuestionReferences(cells[0]);
                if (numbers.length === 0) continue;
                
                const materiColumn = headers.findIndex(header => /MATERI/i.test(header));
                const indikatorColumn = headers.findIndex(header => /INDIKATOR\s*SOAL/i.test(header));
                const levelColumn = headers.findIndex(header => /LEVEL/i.test(header));
                if (materiColumn >= 0 && indikatorColumn >= 0) {
                    const kisiObj: KisiData = {
                        materi: stripHtml(cells[materiColumn]),
                        indikator_soal: stripHtml(cells[indikatorColumn]),
                        level_kognitif: levelColumn >= 0 ? stripHtml(cells[levelColumn]) : '',
                    };
                    for (const num of numbers) {
                        kisiMap[num] = JSON.stringify(kisiObj);
                    }
                    console.log(`[doc-parser]   ✓ Soal ${numbers.join(', ')} (JSON): "${kisiObj.materi}"`);
                } else {
                    // Fallback to old text parsing
                    const parts = [];
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
                    const numbers = parseQuestionReferences(cells[0]);
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
                    const numbers = parseQuestionReferences(cells[0]);
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
    let currentMetadata: ParsedQuestionMetadata = {};

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
        const questionNumber = normalizeQuestionNumber(noRaw);
        const tipeRaw = getColText('tipe');
        const soalRaw = getCol('soal'); // Tetap simpan format HTML untuk soal
        const kunciRaw = getColText('kunci');
        const skorRaw = getColText('skor');

        const isNumberedRow = questionNumber !== '';

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
            
            const resolvedStimulus = stimulusMap[questionNumber] || '';
            const resolvedInstruction = instructionMap[questionNumber] || '';
            const resolvedKisi = kisiMap[questionNumber] || '';
            
            const isPersonality = ['sjt', 'likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(type);

            let kisiData: KisiData | null = null;
            let kisiString = resolvedKisi || '';
            try {
                if (kisiString.startsWith('{')) {
                    const parsed: unknown = JSON.parse(kisiString);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        const record = parsed as Record<string, unknown>;
                        kisiData = {
                            materi: typeof record.materi === 'string' ? record.materi : '',
                            indikator_soal: typeof record.indikator_soal === 'string' ? record.indikator_soal : '',
                            level_kognitif: typeof record.level_kognitif === 'string' ? record.level_kognitif : '',
                        };
                        kisiString = [kisiData.materi, kisiData.indikator_soal].filter(Boolean).join(' — ');
                    }
                }
            } catch (e) {
                console.error('[doc-parser] Failed to parse Kisi-kisi JSON', e);
            }

            currentMetadata = {
                import_stimulus: resolvedStimulus || '',
                import_instruction: resolvedInstruction || '',
                import_source_number: Number(questionNumber),
                _stimulus_code: resolvedStimulus ? questionNumber : '',
                _instruction_code: resolvedInstruction ? questionNumber : '',
                stimulus_title: stimulusTitles[questionNumber] || '',
                instruction_title: instructionTitles[questionNumber] || '',
                kisi_kisi: kisiString,
                kisi_kisi_data: kisiData,
                dimension: isPersonality ? (kunciRaw || '') : '',
            };
            if (type === 'mcq_complex') currentMetadata.isComplex = true;
            if (type === 'ordering' && currentKunci) {
                currentMetadata.correct_order = currentKunci.split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
            }

            if (type === 'short_answer' && currentKunci) {
                const blanks = currentKunci.split('|').flatMap((part, idx) => {
                    const vars = part.split(',').map(s => s.trim()).filter(Boolean);
                    if (!vars[0]) return [];
                    return [{ id: `blank_${Date.now()}_${idx}`, answer: vars[0], variations: vars.slice(1) }];
                });
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

            console.log(`[doc-parser] Q${questionNumber} type=${type}: "${soalRaw.substring(0, 60)}"`);

        } else if (current) {
            // Kunci untuk sub-row: jika kolom Kunci sub-row kosong, gunakan kunci baris utama
            // (untuk BS: kunci baris utama seperti "B|S"; untuk MJ/CAT: kolom Kunci sub-row TERISI)
            const effectiveKunci = (!isBlank(kunciRaw)) ? kunciRaw : currentKunci;

            // ── Opsi PG/PGK: Tipe = A/B/C/D/E di kolom Tipe, teks di kolom Soal ─
            if (['mcq', 'mcq_complex'].includes(current.type) && /^[A-Z]+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                // Tipe = huruf opsi (A-E) → cek apakah ada di kunci baris utama
                const kunciArr = currentKunci.split(/[,;|\/\\]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
                const isCorrect = kunciArr.includes(tipeRaw.toUpperCase());
                currentOpts.push({ text: stripOptionHtml(soalRaw), isCorrect, order: currentOpts.length, weight: isCorrect ? 1 : 0 });
            }
            // ── Sub-item BS: Tipe = P1/P2/P3... ───────────────────────────────────
            else if (current.type === 'true_false' && /^(P)?\d+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                const pNum = parseInt(tipeRaw.replace(/^P/i, ''));
                // Kunci dari baris utama, contoh: "B|S|B" → ["B","S","B"]
                const kunciArr = effectiveKunci.split('|').map(s => s.trim().toUpperCase());
                const key = kunciArr.length === 1 ? kunciArr[0] : kunciArr[pNum - 1];
                if (!['B', 'S'].includes(key)) throw new Error(`Kunci Benar/Salah P${pNum} tidak valid.`);
                const isBenar = key === 'B';
                currentOpts.push({ text: stripOptionHtml(soalRaw), isCorrect: isBenar, order: currentOpts.length, weight: isBenar ? 1 : 0 });
            }
            // ── Sub-item MJ: Tipe = MJ1/MJ2/... ──────────────────────────────────
            else if (current.type === 'matching' && /^(MJ)?\d+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
                // Kunci sub-row MJ = item kanan (jawaban yang cocok)
                const matchText = (!isBlank(kunciRaw)) ? kunciRaw.trim() : '';
                currentOpts.push({
                    text: stripOptionHtml(soalRaw),
                    isCorrect: true,
                    order: currentOpts.length,
                    weight: 1,
                    metadata: { match_texts: matchText ? matchText.split(' | ').map(s => s.trim()).filter(Boolean) : [] }
                });
                if (matchText && current.metadata) {
                    const ri = current.metadata.right_items || [];
                    for (const text of matchText.split(' | ').map(s => s.trim()).filter(Boolean)) {
                        if (!ri.includes(text)) ri.push(text);
                    }
                    current.metadata.right_items = ri;
                }
            }
            // ── Sub-item CAT: Tipe = CAT1/CAT2/... ───────────────────────────────
            else if (current.type === 'categorization' && /^(CAT)?\d+$/i.test(tipeRaw) && !isBlank(soalRaw)) {
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
                });
                // Auto-derive question-level categories list from sub-rows
                if (current.metadata) {
                    const existingCats = current.metadata.categories || [];
                    for (const cat of categories) {
                        if (!existingCats.includes(cat)) existingCats.push(cat);
                    }
                    current.metadata.categories = existingCats;
                }
            }
            // ── Sub-item SJT: Tipe = A/B/C/D/E di kolom Tipe, skor/bobot di kolom Poin ─
            else if (current.type === 'sjt' && (/^[A-Z]+$/i.test(tipeRaw) || !tipeRaw) && !isBlank(soalRaw)) {
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
            else if (['likert', 'forced_choice', 'checklist', 'ranking', 'paired_comparison'].includes(current.type)) {
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

    questions.sort((left, right) => {
        const a = left.metadata?.import_source_number;
        const b = right.metadata?.import_source_number;
        return typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) ? a - b : 0;
    });
    console.log('[doc-parser] Total parsed questions:', questions.length);
    return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
// Keep option images and math; rendering sanitizes the HTML at its boundary.
const stripOptionHtml = (text: string) => text ? String(text).trim() : '';

export async function parseDocxToQuestions(file: File): Promise<ParsedQuestion[]> {
    try {
        const archived = await readQuestionArchive(await file.arrayBuffer());
        if (archived) return archived.map(q => ({ ...q, options: q.options.map(o => ({
            ...o, isCorrect: o.isCorrect ?? o.is_correct ?? false,
        })) }));
        const { tables, tableHeaders } = await extractTablesFromDocx(file);
        if (tables.length === 0) {
            console.warn('[doc-parser] Tidak ada tabel ditemukan dalam DOCX');
            return [];
        }
        const { questions } = parseAllTables(tables, tableHeaders);
        return questions;
    } catch (err) {
        console.error('[doc-parser] Error:', err);
        throw err;
    }
}

export async function parseDocxToStimuliOrInstructions(file: File, kind?: 'stimulus' | 'instruction'): Promise<{ title: string, content: string }[]> {
    try {
        const mammoth = await import('mammoth');
        const preprocessedBuffer = await preprocessDocx(file);
        const mammothOptions = typeof window === 'undefined'
            ? { buffer: Buffer.from(preprocessedBuffer) }
            : { arrayBuffer: preprocessedBuffer };
        const result = await mammoth.convertToHtml(mammothOptions);
        const html = result.value;

        const parser = getDOMParser();
        const wrappedHtml = typeof window === 'undefined' ? `<div id="root">${html}</div>` : html;
        const doc = parser.parseFromString(wrappedHtml, typeof window === 'undefined' ? 'text/xml' : 'text/html');
        const tablesList = doc.getElementsByTagName ? doc.getElementsByTagName('table') : doc.querySelectorAll('table');
        const tables = Array.from(tablesList) as Element[];

        if (tables.length === 0) {
            return [];
        }

        // Tabel referensi stimulus/petunjuk harus:
        // - punya 2 atau 3 kolom
        // - kolom pertama = "Nomor Soal"
        // - kolom terakhir mengandung "Isi Stimulus" / "Isi Petunjuk" (atau generic "Isi")
        // Tabel soal (8 kolom) tidak boleh ikut.

        const getFirstRow = (table: Element): Element | null => {
            const rows = table.getElementsByTagName('tr');
            return rows.length > 0 ? rows[0] : null;
        };

        const matchesKind = (table: Element, targetKind: 'stimulus' | 'instruction' | undefined) => {
            if (!targetKind) return true; // tidak ada filter → terima semua
            const firstRow = getFirstRow(table);
            if (!firstRow) return false;
            const headers = elementChildren(firstRow)
                .filter((cell) => ['th', 'td'].includes(cell.tagName.toLowerCase()))
                .map((cell) => (cell.textContent || '').trim());
            // Harus 2 atau 3 kolom
            if (headers.length < 2 || headers.length > 3) return false;
            // Kolom pertama harus mengandung "Nomor" atau "No"
            if (!/^(NOMOR(\s+SOAL)?|NO(\.)?)$/i.test(headers[0])) return false;
            // Kolom terakhir harus berisi "Isi Stimulus" (untuk stimulus) atau "Isi Petunjuk"/"Isi Instruksi" (untuk instruction)
            const lastHeader = headers[headers.length - 1].toUpperCase();
            if (targetKind === 'stimulus') return /ISI\s*STIMULUS|STIMULUS/i.test(lastHeader);
            return /ISI\s*(PETUNJUK|INSTRUKSI)|PETUNJUK|INSTRUKSI/i.test(lastHeader);
        };

        const hasNumberedRows = (rows: ArrayLike<Element>): boolean => {
            for (let r = 1; r < rows.length; r++) {
                const firstCell = elementChildren(rows[r])
                    .find((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()));
                const text = (firstCell?.textContent || '').trim();
                // Ada setidaknya 1 angka di baris manapun
                if (/\d+/.test(text)) return true;
            }
            return false;
        };

        const candidateTables: Element[] = [];
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
                const headers = elementChildren(firstRow)
                    .filter((cell) => ['th', 'td'].includes(cell.tagName.toLowerCase()))
                    .map((cell) => (cell.textContent || '').trim());
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
                const cells = elementChildren(rows[i])
                    .filter((cell) => cell.tagName.toLowerCase() === 'td');
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
    } catch (err) {
        console.error('[doc-parser] Error parsing stimuli/instructions from docx:', err);
        return [];
    }
}
