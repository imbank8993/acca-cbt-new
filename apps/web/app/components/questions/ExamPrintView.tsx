"use client";

import Image from 'next/image';
import type { RefObject } from 'react';
import type { QuestionBank, QuestionRecord } from '@/lib/api/questions';
import {
    buildPrintItems,
    documentHost,
    optionLabel,
    optionText,
    totalScore,
    type PrintItem,
} from '@/lib/exam-print-model';
import { LatexRenderer } from './LatexRenderer';

interface ExamPrintViewProps {
    bankInfo: QuestionBank | null;
    questions: QuestionRecord[];
    /** Elemen akar lembar, dipakai mesin tata letak A4. */
    rootRef?: RefObject<HTMLDivElement | null>;
}

function HtmlContent({ html, className = '' }: { html: string; className?: string }) {
    if (!html) return null;
    return <LatexRenderer text={html} className={className} />;
}

const POPPINS = "var(--font-poppins), 'Poppins', sans-serif";

function stimulusOf(q: QuestionRecord | null | undefined): string {
    if (!q) return '';
    const stim = Array.isArray(q.stimulus) ? q.stimulus[0] : q.stimulus;
    return stim?.content || q.metadata?.import_stimulus || '';
}

function instructionOf(q: QuestionRecord | null | undefined): string {
    if (!q) return '';
    const inst = Array.isArray(q.instruction) ? q.instruction[0] : q.instruction;
    return inst?.content || q.metadata?.import_instruction || '';
}

const PRINT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');

#exam-pdf-content, #exam-pdf-content * { box-sizing: border-box; }
#exam-pdf-content {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    overflow-wrap: anywhere;
}
#exam-pdf-content .eqc-frame { width: 100%; border-collapse: collapse; border: none; table-layout: fixed; }
#exam-pdf-content .eqc-frame > thead > tr > td,
#exam-pdf-content .eqc-frame > tfoot > tr > td,
#exam-pdf-content .eqc-frame > tbody > tr > td { padding: 0; border: none; }
.eqc-page-spacer { height: 0; }

/* ── Isi kaya: tidak boleh ada yang melewati lebar kertas ── */
/* LatexRenderer memakai overflow-wrap: break-word (inline); "anywhere" juga
   memperkecil lebar minimum sel tabel sehingga URL/kata panjang ikut terlipat. */
#exam-pdf-content .latex-renderer { max-width: 100%; min-width: 0; overflow-wrap: anywhere !important; }
#exam-pdf-content .latex-renderer img,
#exam-pdf-content .eqc-img {
    max-width: 100% !important;
    height: auto !important;
    max-height: 170mm;
    object-fit: contain;
    break-inside: avoid;
}
#exam-pdf-content .latex-renderer table { max-width: 100%; border-collapse: collapse; margin: 6px 0; }
#exam-pdf-content .latex-renderer td,
#exam-pdf-content .latex-renderer th { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; overflow-wrap: break-word; }
/* Tabel isi soal tidak memotong kata: bila terlalu lebar, mesin tata letak memperkecilnya. */
#exam-pdf-content table[data-fit-wrap] td,
#exam-pdf-content table[data-fit-wrap] th { overflow-wrap: anywhere; }
#exam-pdf-content .latex-renderer pre { white-space: pre-wrap; }
#exam-pdf-content .katex-block,
#exam-pdf-content .katex-display { overflow: visible !important; padding-top: 2px !important; padding-bottom: 2px !important; margin: 6px 0 !important; }
#exam-pdf-content iframe,
#exam-pdf-content video,
#exam-pdf-content audio { display: none !important; }
#exam-pdf-content p { orphans: 3; widows: 3; }

/* ── Blok soal ── */
.eqc-question { margin-bottom: 20px; }
.eqc-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); column-gap: 4px; align-items: start; }
.eqc-number {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 24px; height: 24px; padding: 0 6px; border-radius: 6px;
    background: #eff6ff; border: 1px solid #bfdbfe; color: #3083FF;
    font-size: 12px; font-weight: 700; font-family: ${POPPINS};
}
.eqc-body { min-width: 0; }
.eqc-qtext { font-size: 13px !important; line-height: 1.7 !important; margin-bottom: 8px; }
.eqc-qtext p, .eqc-opt-content p, .eqc-stimulus p { margin: 0 0 6px 0; }
.eqc-qtext p:last-child, .eqc-opt-content p:last-child, .eqc-stimulus p:last-child { margin-bottom: 0; }
.eqc-stimulus { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }
.eqc-stimulus-title { font-weight: bold; margin-bottom: 8px; color: #3083FF; break-after: avoid; }
.eqc-instruction { font-style: italic; color: #475569; margin-bottom: 10px; font-size: 12px; break-after: avoid; }

/* ── Opsi: kolom ditentukan otomatis (--eqc-cols) ── */
.eqc-options { display: grid; grid-template-columns: repeat(var(--eqc-cols, 1), minmax(0, 1fr)); column-gap: 16px; row-gap: 2px; padding-left: 4px; }
.eqc-opt { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 12px; line-height: 1.6; min-width: 0; break-inside: avoid; }
.eqc-opt-label { font-weight: bold; flex-shrink: 0; min-width: 20px; }
.eqc-opt-content { flex: 1; min-width: 0; font-size: 12px !important; line-height: 1.6 !important; }
.eqc-checkbox { width: 16px; height: 16px; border: 1.5px solid #64748b; border-radius: 3px; flex-shrink: 0; margin-top: 2px; display: inline-block; }

.eqc-table { border-collapse: collapse; width: 100%; margin: 12px 0 0; table-layout: auto; }
.eqc-table td, .eqc-table th { border: 1px solid #d1d5db; padding: 5px 8px; font-size: 12px; overflow-wrap: anywhere; }
.eqc-table th { background: #f1f5f9; font-weight: bold; }
.eqc-table tr { break-inside: avoid; }
.eqc-table thead { display: table-header-group; }
.eqc-choice-cell { width: 60px; text-align: center; vertical-align: middle; }

.eqc-matching { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; margin-top: 12px; }
.eqc-match-head { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 6px; }
.eqc-match-item { display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-start; font-size: 12px; break-inside: avoid; }
.eqc-match-key { font-weight: 700; color: #334155; min-width: 18px; flex-shrink: 0; }
.eqc-answer-box { flex-shrink: 0; width: 34px; height: 22px; border: 1px solid #94a3b8; border-radius: 4px; margin-left: auto; }

.eqc-line { border-bottom: 1px dashed #94a3b8; height: 24px; margin-bottom: 8px; }
.eqc-likert { margin: 28px 0 20px; width: 100%; max-width: 550px; display: flex; justify-content: space-between; align-items: flex-start; position: relative; padding: 0 16px; }

@media print {
    /* margin 0 => browser tidak mencetak header/footer (tanggal, judul, URL) */
    @page { size: A4 portrait; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    #exam-pdf-content {
        width: 210mm !important;
        max-width: 210mm !important;
        min-height: auto !important;
        padding: 0 15mm !important;
        margin: 0 !important;
        box-shadow: none !important;
    }
    /* thead/tfoot diulang tiap halaman => pengganti margin atas/bawah */
    .eqc-page-spacer { height: 12mm; }
    .eqc-keep { break-inside: avoid; }
    .eqc-header-block { break-after: avoid; }
}
`;

function OptionGrid({ item, marker }: { item: PrintItem<QuestionRecord>; marker: 'letter' | 'checkbox' }) {
    return (
        <div
            className="eqc-options"
            data-columns-initial={item.columns}
            data-columns={item.columns}
            style={{ ['--eqc-cols' as string]: item.columns }}
        >
            {item.options.map((o, oi) => (
                <div key={o.id || oi} className="eqc-opt">
                    {marker === 'letter'
                        ? <span className="eqc-opt-label">{optionLabel(oi)}.</span>
                        : <span className="eqc-checkbox" />}
                    <HtmlContent html={optionText(o)} className="eqc-opt-content" />
                </div>
            ))}
        </div>
    );
}

function ChoiceTable({ item, columns, round = false }: { item: PrintItem<QuestionRecord>; columns: string[]; round?: boolean }) {
    return (
        <table className="eqc-table">
            <thead>
                <tr>
                    <th style={{ textAlign: 'left' }}>Pernyataan</th>
                    {columns.map(col => <th key={col} className="eqc-choice-cell">{col}</th>)}
                </tr>
            </thead>
            <tbody>
                {item.options.map((o, oi) => (
                    <tr key={o.id || oi}>
                        <td><HtmlContent html={optionText(o)} /></td>
                        {columns.map(col => (
                            <td key={col} className="eqc-choice-cell">
                                <div className="eqc-checkbox" style={{ margin: '0 auto', borderRadius: round ? '50%' : undefined }} />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function AnswerArea({ item }: { item: PrintItem<QuestionRecord> }) {
    const q = item.question;
    switch (q.type) {
        case 'mcq':
        case 'sjt':
            return <OptionGrid item={item} marker="letter" />;
        case 'mcq_complex':
        case 'forced_choice':
        case 'paired_comparison':
            return <OptionGrid item={item} marker="checkbox" />;
        case 'true_false':
            return <ChoiceTable item={item} columns={['Benar', 'Salah']} />;
        case 'checklist':
            return <ChoiceTable item={item} columns={['Ya', 'Tidak']} round />;
        case 'likert':
            return (
                <div className="eqc-likert">
                    <div style={{ position: 'absolute', top: '14px', left: '36px', right: '36px', height: '2px', background: '#94a3b8', zIndex: 1 }} />
                    {[1, 2, 3, 4, 5].map((val, idx) => (
                        <div key={val} style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '60px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#fff', border: '2px solid #64748b', marginBottom: '6px' }} />
                            {(idx === 0 || idx === 4) && (
                                <div style={{ fontSize: '8px', fontWeight: 'bold', color: '#64748b', textAlign: 'center', lineHeight: '1.3', textTransform: 'uppercase' }}>
                                    {idx === 0 ? 'Sangat Tidak Setuju' : 'Sangat Setuju'}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            );
        case 'matching':
            return (
                <div className="eqc-matching">
                    <div>
                        <div className="eqc-match-head">Pernyataan · Jawaban</div>
                        {item.options.map((o, oi) => (
                            <div key={o.id || oi} className="eqc-match-item">
                                <span className="eqc-match-key">{oi + 1}.</span>
                                <div style={{ flex: 1, minWidth: 0 }}><HtmlContent html={optionText(o)} /></div>
                                <span className="eqc-answer-box" aria-label="Tulis huruf jawaban" />
                            </div>
                        ))}
                    </div>
                    <div>
                        <div className="eqc-match-head">Pilihan</div>
                        {item.rightItems.map((right, ri) => (
                            <div key={`${ri}-${right}`} className="eqc-match-item">
                                <span className="eqc-match-key">{optionLabel(ri)}.</span>
                                <div style={{ flex: 1, minWidth: 0 }}><HtmlContent html={right} /></div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        case 'categorization':
            return (
                <table className="eqc-table">
                    <thead>
                        <tr>
                            <th style={{ textAlign: 'left' }}>Pernyataan / Item</th>
                            {item.categories.map((cat, ci) => (
                                <th key={`${ci}-${cat}`} style={{ width: `${Math.max(56, Math.min(96, 320 / Math.max(1, item.categories.length)))}px`, textAlign: 'center' }}>
                                    <HtmlContent html={cat} />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {item.options.map((o, oi) => (
                            <tr key={o.id || oi}>
                                <td>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <span style={{ fontWeight: 700, color: '#334155' }}>{oi + 1}.</span>
                                        <div style={{ flex: 1, minWidth: 0 }}><HtmlContent html={optionText(o)} /></div>
                                    </div>
                                </td>
                                {item.categories.map((cat, ci) => (
                                    <td key={`${ci}-${cat}`} className="eqc-choice-cell"><div className="eqc-checkbox" style={{ margin: '0 auto' }} /></td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        case 'ordering':
        case 'ranking':
            return (
                <table className="eqc-table">
                    <thead>
                        <tr>
                            <th style={{ textAlign: 'left' }}>Pernyataan</th>
                            <th style={{ width: '80px', textAlign: 'center' }}>Urutan</th>
                        </tr>
                    </thead>
                    <tbody>
                        {item.options.map((o, oi) => (
                            <tr key={o.id || oi}>
                                <td><HtmlContent html={optionText(o)} /></td>
                                <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                    <div style={{ width: '40px', height: '30px', border: '1px solid #64748b', margin: '0 auto', borderRadius: '4px' }} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        case 'short_answer': {
            const blanks = q.metadata?.blanks || [];
            return (
                <div style={{ marginTop: '16px' }}>
                    {blanks.length > 0 ? blanks.map((_, bi) => (
                        <div key={bi} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>({bi + 1})</span>
                            <div className="eqc-line" style={{ flex: 1, height: '14px' }} />
                        </div>
                    )) : <div className="eqc-line" style={{ width: '100%' }} />}
                </div>
            );
        }
        default:
            // Esai/uraian dan tipe lain yang dijawab bebas.
            return (
                <div style={{ marginTop: '16px' }}>
                    {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="eqc-line" />)}
                </div>
            );
    }
}

export function ExamPrintView({ bankInfo, questions, rootRef }: ExamPrintViewProps) {
    const list = questions || [];
    const items = buildPrintItems(list);
    const title = bankInfo?.title || bankInfo?.name || 'Bank Soal';

    return (
        <div ref={rootRef} id="exam-pdf-content" style={{
            fontFamily: "'Merriweather','Source Serif 4',Georgia,'Segoe UI',Arial,sans-serif",
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#1e293b',
            background: '#ffffff',
            width: '210mm',
            minHeight: '297mm',
            padding: '8mm 15mm 15mm 15mm',
        }}>
            <style>{PRINT_CSS}</style>

            <table className="eqc-frame">
                <thead><tr><td><div className="eqc-page-spacer" /></td></tr></thead>
                <tfoot><tr><td><div className="eqc-page-spacer" /></td></tr></tfoot>
                <tbody><tr><td>

                    <div className="eqc-header-block" data-print-block>
                        {/* ── Kop ── */}
                        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #3083FF', paddingBottom: '12px', marginBottom: '16px' }}>
                            <Image src="/logo-sidebar.png" alt="ACCA Logo" width={180} height={48} style={{ height: '40px', width: 'auto', objectFit: 'contain' }} priority />
                        </div>

                        {/* ── Judul ── */}
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <div style={{ fontFamily: POPPINS, fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase' }}>LEMBAR SOAL UJIAN</div>
                            <div style={{ fontFamily: POPPINS, fontSize: '14px', color: '#3083FF', marginTop: '4px', fontWeight: 600 }}>{title}</div>
                        </div>

                        {/* ── Identitas siswa ── */}
                        <table style={{ fontFamily: POPPINS, width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '12px', tableLayout: 'fixed' }}>
                            <tbody>
                                {[['NAMA', 'NISN'], ['SEKOLAH', 'KELAS']].map(([left, right]) => (
                                    <tr key={left}>
                                        {[[left, '70%', '70px'], [right, '30%', '50px']].map(([label, width, labelWidth]) => (
                                            <td key={label} style={{ border: '1px solid #cbd5e1', padding: '8px 12px', width }}>
                                                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                                    <strong style={{ color: '#3083FF', width: labelWidth, flexShrink: 0 }}>{label}</strong>
                                                    <span style={{ marginRight: '8px', fontWeight: 'bold' }}>:</span>
                                                    <div style={{ flex: 1, borderBottom: '2px dotted #cbd5e1', marginBottom: '3px' }} />
                                                </div>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* ── Petunjuk umum ── */}
                        <div style={{ fontFamily: POPPINS, background: '#f1f5f9', borderLeft: '4px solid #3083FF', padding: '8px 12px', fontSize: '12px', color: '#475569', marginBottom: '20px' }}>
                            <strong style={{ color: '#3083FF' }}>Petunjuk Umum:</strong><br />
                            1. Berdoalah sebelum mengerjakan soal.<br />
                            2. Bacalah setiap soal dengan seksama.<br />
                            3. Total soal: {list.length} butir | Nilai Total: {totalScore(list)} poin.
                        </div>
                    </div>

                    {items.length === 0 && (
                        <div style={{ padding: '32px 0', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                            Bank soal ini belum berisi soal.
                        </div>
                    )}

                    {/* ── Soal ── */}
                    {items.map((item, idx) => {
                        const q = item.question;
                        const stimulusHtml = stimulusOf(q);
                        const showStimulus = !!stimulusHtml && stimulusHtml !== stimulusOf(list[idx - 1]);
                        const instructionHtml = instructionOf(q);
                        const showInstruction = !!instructionHtml && instructionHtml !== instructionOf(list[idx - 1]);
                        let stimulusEnd = idx;
                        if (showStimulus) {
                            while (stimulusEnd + 1 < list.length && stimulusOf(list[stimulusEnd + 1]) === stimulusHtml) stimulusEnd++;
                        }

                        return (
                            <section key={q.id || idx} className="eqc-question" data-print-block data-question-number={item.number}>
                                {showStimulus && (
                                    <div className="eqc-stimulus">
                                        <div className="eqc-stimulus-title">
                                            Bacalah teks/informasi berikut untuk menjawab soal nomor {item.number}{stimulusEnd > idx ? ` s.d. ${stimulusEnd + 1}` : ''}:
                                        </div>
                                        <HtmlContent html={stimulusHtml} />
                                    </div>
                                )}

                                {showInstruction && (
                                    <div className="eqc-instruction">
                                        <HtmlContent html={instructionHtml} />
                                    </div>
                                )}

                                <div className="eqc-row">
                                    <div><span className="eqc-number">{item.number}</span></div>
                                    <div className="eqc-body">
                                        <HtmlContent html={q.question_text || ''} className="eqc-qtext" />
                                        <AnswerArea item={item} />
                                    </div>
                                </div>
                            </section>
                        );
                    })}

                    {/* ── Footer ── */}
                    <div style={{ marginTop: '30px', paddingTop: '12px', borderTop: '2px solid #e2e8f0', fontSize: '11px', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', breakInside: 'avoid' }}>
                        <div style={{ minWidth: 0 }}>Dicetak dari {title}</div>
                        <div style={{ fontWeight: 'bold', color: '#3083FF', flexShrink: 0 }}>{documentHost()}</div>
                    </div>

                </td></tr></tbody>
            </table>
        </div>
    );
}
