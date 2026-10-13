"use client";

import Image from 'next/image';
import type { QuestionBank } from '@/lib/api/questions';
import type { QuestionRecord } from '@/lib/api/questions';
import { LatexRenderer } from './LatexRenderer';


interface ExamPrintViewProps {
    bankInfo: QuestionBank | null;
    questions: QuestionRecord[];
}

function HtmlContent({ html, className = '' }: { html: string; className?: string }) {
    if (!html) return null;
    return <LatexRenderer text={html} className={className} />;
}

export function ExamPrintView({ bankInfo, questions }: ExamPrintViewProps) {
    if (!questions || questions.length === 0) return null;
    const totalScore = questions.reduce((sum, question) => sum + (question.score_default || 1), 0);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    return (
        <div id="exam-pdf-content" style={{
            fontFamily: "'Merriweather','Source Serif 4',Georgia,'Segoe UI',Arial,sans-serif",
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#1e293b',
            background: '#ffffff',
            width: '210mm',
            minHeight: '297mm',
            padding: '8mm 15mm 15mm 15mm',
            boxSizing: 'border-box',
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
                .eqc-page-spacer { height: 0; }
                @media print {
                    /* margin 0 => browser tidak mencetak header/footer (tanggal, judul, URL) */
                    @page { margin: 0; size: A4; }
                    html, body { margin: 0 !important; padding: 0 !important; }
                    #exam-pdf-content {
                        width: 100% !important;
                        max-width: 100% !important;
                        min-height: auto !important;
                        padding: 0 15mm !important;
                        margin: 0 !important;
                    }
                    /* thead/tfoot diulang tiap halaman => pengganti margin atas/bawah */
                    .eqc-page-spacer { height: 12mm; }
                }
                .eqc-img { max-width: 100%; height: auto; border-radius: 3px; }
                .eqc-table { border-collapse: collapse; width: 100%; margin: 8px 0; }
                .eqc-table td, .eqc-table th { border: 1px solid #d1d5db; padding: 5px 8px; font-size: 12px; }
                .eqc-table th { background: #f1f5f9; font-weight: bold; }
                .eqc-qtext { font-size: 13px !important; line-height: 1.7 !important; margin-bottom: 8px; }
                .eqc-qtext p, .eqc-mc-content p, .eqc-stimulus p { margin: 0 0 6px 0; }
                .eqc-qtext p:last-child, .eqc-mc-content p:last-child, .eqc-stimulus p:last-child { margin-bottom: 0; }
                .eqc-qtext img { max-width: 100%; height: auto; border-radius: 3px; }
                .eqc-mc { padding-left: 4px; }
                .eqc-mc-row { display: flex; align-items: flex-start; gap: 12px; padding: 4px 0; font-size: 12px !important; line-height: 1.6 !important; }
                .eqc-mc-content { flex: 1; font-size: 12px !important; line-height: 1.6 !important; }
                .eqc-bs-row { display: flex; align-items: flex-start; gap: 12px; padding: 4px 0; font-size: 12px; justify-content: space-between; }
                .eqc-bs-options { display: flex; gap: 8px; font-weight: bold; flex-shrink: 0; }
                .eqc-mj-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; font-size: 12px; justify-content: space-between; }
                .eqc-underline { flex-shrink: 0; border-bottom: 1px dashed #94a3b8; height: 18px; width: 150px; }
                .eqc-line { border-bottom: 1px dashed #94a3b8; height: 24px; margin-bottom: 8px; }
                .eqc-checkbox { width: 16px; height: 16px; border: 1.5px solid #64748b; border-radius: 3px; flex-shrink: 0; margin-top: 2px; display: inline-block; }
                .eqc-number-box { width: 24px; height: 24px; border: 1px solid #64748b; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-top: 2px; }
                .eqc-stimulus { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }
                .eqc-instruction { font-style: italic; color: #475569; margin-bottom: 10px; font-size: 12px; }
            `}</style>

            <table style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
            <thead><tr><td style={{ padding: 0, border: 'none' }}><div className="eqc-page-spacer" /></td></tr></thead>
            <tfoot><tr><td style={{ padding: 0, border: 'none' }}><div className="eqc-page-spacer" /></td></tr></tfoot>
            <tbody><tr><td style={{ padding: 0, border: 'none' }}>

            {/* ── Header (Kop Surat) ── */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #3083FF', paddingBottom: '12px', marginBottom: '16px' }}>
                <Image src="/logo-sidebar.png" alt="ACCA Logo" width={180} height={48} style={{ height: '40px', width: 'auto', objectFit: 'contain' }} priority />
            </div>

            {/* ── Judul Ujian (Di Bawah Garis) ── */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ fontFamily: "var(--font-poppins), 'Poppins', sans-serif", fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase' }}>LEMBAR SOAL UJIAN</div>
                <div style={{ fontFamily: "var(--font-poppins), 'Poppins', sans-serif", fontSize: '14px', color: '#3083FF', marginTop: '4px', fontWeight: 600 }}>{bankInfo?.title || bankInfo?.name || 'Bank Soal'}</div>
            </div>

            {/* ── Info Siswa (Proporsional & Seimbang) ── */}
            <table style={{ fontFamily: "var(--font-poppins), 'Poppins', sans-serif", width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '12px', tableLayout: 'fixed' }}>
                <tbody>
                    <tr>
                        <td style={{ border: '1px solid #cbd5e1', padding: '8px 12px', width: '70%' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <strong style={{ color: '#3083FF', width: '70px' }}>NAMA</strong>
                                <span style={{ marginRight: '8px', fontWeight: 'bold' }}>:</span>
                                <div style={{ flex: 1, borderBottom: '2px dotted #cbd5e1', marginBottom: '3px' }}></div>
                            </div>
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '8px 12px', width: '30%' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <strong style={{ color: '#3083FF', width: '50px' }}>NISN</strong>
                                <span style={{ marginRight: '8px', fontWeight: 'bold' }}>:</span>
                                <div style={{ flex: 1, borderBottom: '2px dotted #cbd5e1', marginBottom: '3px' }}></div>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style={{ border: '1px solid #cbd5e1', padding: '8px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <strong style={{ color: '#3083FF', width: '70px' }}>SEKOLAH</strong>
                                <span style={{ marginRight: '8px', fontWeight: 'bold' }}>:</span>
                                <div style={{ flex: 1, borderBottom: '2px dotted #cbd5e1', marginBottom: '3px' }}></div>
                            </div>
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '8px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <strong style={{ color: '#3083FF', width: '50px' }}>KELAS</strong>
                                <span style={{ marginRight: '8px', fontWeight: 'bold' }}>:</span>
                                <div style={{ flex: 1, borderBottom: '2px dotted #cbd5e1', marginBottom: '3px' }}></div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>

            {/* ── Petunjuk Umum ── */}
            <div style={{ fontFamily: "var(--font-poppins), 'Poppins', sans-serif", background: '#f1f5f9', borderLeft: '4px solid #3083FF', padding: '8px 12px', fontSize: '12px', color: '#475569', marginBottom: '20px' }}>
                <strong style={{ color: '#3083FF' }}>Petunjuk Umum:</strong><br/>
                1. Berdoalah sebelum mengerjakan soal.<br/>
                2. Bacalah setiap soal dengan seksama.<br/>
                3. Total soal: {questions.length} butir | Nilai Total: {totalScore} poin.
            </div>

            {/* ── Soal ── */}
            {questions.map((q, idx) => {
                const opts = q.bank_question_options || q.options || [];
                const sortedOpts = [...opts]
                    .filter((o) => {
                        const t = (o.option_text || o.text || '').trim();
                        const clean = t.replace(/<p>(\s|<br>|&nbsp;)*<\/p>/gi, '').replace(/(\s|<br>|&nbsp;)+/g, '').trim();
                        if (!clean && !t.includes('<img') && !t.includes('<math')) return false;
                        return true;
                    })
                    .sort((a, b) => (a.order || 0) - (b.order || 0));
                
                // Grouping Logic for Stimulus
                const stim = Array.isArray(q.stimulus) ? q.stimulus[0] : q.stimulus;
                const stimulusHtml = stim?.content || q.metadata?.import_stimulus || '';
                
                const prevQ = idx > 0 ? questions[idx - 1] : null;
                const prevStim = prevQ ? (Array.isArray(prevQ.stimulus) ? prevQ.stimulus[0] : prevQ.stimulus) : null;
                const prevStimulusHtml = prevStim?.content || prevQ?.metadata?.import_stimulus || '';
                
                const showStimulus = stimulusHtml && stimulusHtml !== prevStimulusHtml;

                // Grouping Logic for Instruction
                const inst = Array.isArray(q.instruction) ? q.instruction[0] : q.instruction;
                const instructionHtml = inst?.content || q.metadata?.import_instruction || '';
                
                const prevInst = prevQ ? (Array.isArray(prevQ.instruction) ? prevQ.instruction[0] : prevQ.instruction) : null;
                const prevInstructionHtml = prevInst?.content || prevQ?.metadata?.import_instruction || '';
                
                const showInstruction = instructionHtml && instructionHtml !== prevInstructionHtml;

                return (
                    <div key={q.id || idx} style={{ marginBottom: '24px' }}>
                        
                        {/* Render Stimulus */}
                        {showStimulus && (
                            <div className="eqc-stimulus">
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#3083FF' }}>Bacalah teks/informasi berikut untuk menjawab soal nomor {idx + 1} {
                                    // Cari soal ke berapa stimulus ini berakhir
                                    (() => {
                                        let endIdx = idx;
                                        while (endIdx + 1 < questions.length) {
                                            const nextQ = questions[endIdx + 1];
                                            const nextStim = Array.isArray(nextQ.stimulus) ? nextQ.stimulus[0] : nextQ.stimulus;
                                            const nextStimulusHtml = nextStim?.content || nextQ.metadata?.import_stimulus || '';
                                            if (nextStimulusHtml === stimulusHtml) {
                                                endIdx++;
                                            } else {
                                                break;
                                            }
                                        }
                                        return endIdx > idx ? `s.d. ${endIdx + 1}` : '';
                                    })()
                                }:</div>
                                <HtmlContent html={stimulusHtml} />
                            </div>
                        )}

                        {/* Render Instruction */}
                        {showInstruction && (
                            <div className="eqc-instruction">
                                <HtmlContent html={instructionHtml} />
                            </div>
                        )}

                        <table style={{ width: '100%', borderCollapse: 'collapse', border: 'none', background: '#fff' }}>
                            <tbody>
                                <tr>
                                    {/* Question number */}
                                    <td style={{ verticalAlign: 'top', width: '38px', paddingTop: '1px', border: 'none' }}>
                                        <div style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minWidth: '24px',
                                            height: '24px',
                                            padding: '0 6px',
                                            borderRadius: '6px',
                                            background: '#eff6ff',
                                            border: '1px solid #bfdbfe',
                                            color: '#3083FF',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            fontFamily: "var(--font-poppins), 'Poppins', sans-serif",
                                            boxSizing: 'border-box'
                                        }}>
                                            {idx + 1}
                                        </div>
                                    </td>
                                    
                                    {/* Question content */}
                                    <td style={{ verticalAlign: 'top', border: 'none', padding: 0 }}>
                                        <HtmlContent html={q.question_text || ''} className="eqc-qtext" />

                                {/* 1. MCQ (Pilihan Ganda) & SJT */}
                                {['mcq', 'sjt'].includes(q.type) && (
                                    <div className="eqc-mc">
                                        {sortedOpts.map((o, oi) => (
                                            <div key={oi} className="eqc-mc-row">
                                                <div style={{ fontWeight: 'bold', width: '20px', flexShrink: 0 }}>{letters[oi] || '-'}.</div>
                                                <HtmlContent html={o.option_text || o.text || ''} className="eqc-mc-content" />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 2. MCQ Complex (Pilihan Ganda Kompleks) & Forced Choice */}
                                {['mcq_complex', 'forced_choice', 'paired_comparison'].includes(q.type) && (
                                    <div className="eqc-mc">
                                        {sortedOpts.map((o, oi) => (
                                            <div key={oi} className="eqc-mc-row">
                                                <div className="eqc-checkbox" />
                                                <HtmlContent html={o.option_text || o.text || ''} className="eqc-mc-content" />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 3. Likert (Skala Kepribadian) */}
                                {q.type === 'likert' && (
                                    <div style={{ marginTop: '32px', marginBottom: '24px', width: '100%', maxWidth: '550px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', padding: '0 16px' }}>
                                        {/* Horizontal Line with Arrows */}
                                        <div style={{ position: 'absolute', top: '14px', left: '36px', right: '36px', height: '2px', background: '#94a3b8', zIndex: 1 }}>
                                            <div style={{ position: 'absolute', top: '-5px', left: '-10px', width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: '10px solid #94a3b8' }}></div>
                                            <div style={{ position: 'absolute', top: '-5px', right: '-10px', width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '10px solid #94a3b8' }}></div>
                                        </div>
                                        {[1, 2, 3, 4, 5].map((val, idx) => (
                                            <div key={val} style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '60px' }}>
                                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#fff', border: '2px solid #64748b', marginBottom: '6px' }}></div>
                                                {(idx === 0 || idx === 4) && (
                                                    <div style={{ fontSize: '8px', fontWeight: 'bold', color: '#64748b', textAlign: 'center', lineHeight: '1.3', textTransform: 'uppercase' }}>
                                                        {idx === 0 ? 'Sangat Tidak Setuju' : 'Sangat Setuju'}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 4. Checklist */}
                                {q.type === 'checklist' && (
                                    <table className="eqc-table" style={{ marginTop: '12px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ textAlign: 'left', width: 'auto' }}>Pernyataan</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>Ya</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>Tidak</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedOpts.map((o, oi) => (
                                                <tr key={oi}>
                                                    <td>
                                                        <HtmlContent html={o.option_text || o.text || ''} />
                                                    </td>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <div className="eqc-checkbox" style={{ borderRadius: '50%', margin: '0 auto' }}></div>
                                                    </td>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <div className="eqc-checkbox" style={{ borderRadius: '50%', margin: '0 auto' }}></div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}


                                {/* 3. True/False (Benar/Salah) */}
                                {q.type === 'true_false' && (
                                    <table className="eqc-table" style={{ marginTop: '12px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ textAlign: 'left', width: 'auto' }}>Pernyataan</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>Benar</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>Salah</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedOpts.map((o, oi) => (
                                                <tr key={oi}>
                                                    <td>
                                                        <HtmlContent html={o.option_text || o.text || ''} />
                                                    </td>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <div className="eqc-checkbox" style={{ margin: '0 auto' }}></div>
                                                    </td>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <div className="eqc-checkbox" style={{ margin: '0 auto' }}></div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}

                                {/* 4. Matching (Menjodohkan) */}
                                {q.type === 'matching' && (
                                    <div style={{ marginTop: '12px', display: 'flex', gap: '24px' }}>
                                        <div style={{ flex: 1 }}>
                                            {sortedOpts.map((o, oi) => (
                                                <div key={`left-${oi}`} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                                    <span style={{ fontWeight: 700, color: '#334155', minWidth: '16px' }}>{oi + 1}.</span>
                                                    <HtmlContent html={o.option_text || o.text || ''} />
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            {(q.metadata?.right_items || []).map((item, idx) => (
                                                <div key={`right-${idx}`} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                                    <span style={{ fontWeight: 700, color: '#334155', minWidth: '16px' }}>{String.fromCharCode(65 + idx)}.</span>
                                                    <HtmlContent html={item} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 5. Categorization (Kategorisasi) */}
                                {q.type === 'categorization' && (
                                    <table className="eqc-table" style={{ marginTop: '12px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ textAlign: 'left', width: 'auto' }}>Pernyataan / Item</th>
                                                {(q.metadata?.categories || []).map((cat, cidx) => (
                                                    <th key={`cat-${cidx}`} style={{ width: '80px', textAlign: 'center' }}>
                                                        {cat || `Kategori ${cidx + 1}`}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedOpts.map((o, oi) => (
                                                <tr key={oi}>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <span style={{ fontWeight: 700, color: '#334155' }}>{oi + 1}.</span>
                                                            <HtmlContent html={o.option_text || o.text || ''} />
                                                        </div>
                                                    </td>
                                                    {(q.metadata?.categories || []).map((cat, cidx) => (
                                                        <td key={`cell-${oi}-${cidx}`} style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                            <div className="eqc-checkbox" style={{ margin: '0 auto' }}></div>
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                                {/* 5. Ordering & Ranking (Pengurutan) */}
                                {['ordering', 'ranking'].includes(q.type) && (
                                    <table className="eqc-table" style={{ marginTop: '12px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ textAlign: 'left', width: 'auto' }}>Pernyataan</th>
                                                <th style={{ width: '80px', textAlign: 'center' }}>Urutan</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedOpts.map((o, oi) => (
                                                <tr key={oi}>
                                                    <td>
                                                        <HtmlContent html={o.option_text || o.text || ''} />
                                                    </td>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <div style={{ width: '40px', height: '30px', border: '1px solid #64748b', margin: '0 auto', borderRadius: '4px' }}></div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}

                                {/* 6. Short Answer (Isian Singkat) */}
                                {q.type === 'short_answer' && (
                                    <div style={{ marginTop: '16px' }}>
                                        {(q.metadata?.blanks || []).length > 0 ? (
                                            (q.metadata?.blanks || []).map((_, bi) => (
                                                <div key={bi} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '11px', color: '#64748b' }}>({bi + 1})</span>
                                                    <div className="eqc-line" style={{ flex: 1, height: '14px' }} />
                                                </div>
                                            ))
                                        ) : (
                                            <div className="eqc-line" style={{ width: '100%' }} />
                                        )}
                                    </div>
                                )}

                                {/* 7. Essay (Uraian) */}
                                {['essay', 'esay', 'uraian'].includes(q.type) && (
                                    <div style={{ marginTop: '16px' }}>
                                        {[0,1,2,3,4,5].map(i => <div key={i} className="eqc-line" />)}
                                    </div>
                                )}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                );
            })}

            {/* ── Footer ── */}
            <div style={{ marginTop: '30px', paddingTop: '12px', borderTop: '2px solid #e2e8f0', fontSize: '11px', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    Dicetak dari {bankInfo?.title || bankInfo?.name || 'Bank Soal'}
                </div>
                <div style={{ fontWeight: 'bold', color: '#3083FF' }}>
                    acca-cbt.icgowa.sch.id
                </div>
            </div>

            </td></tr></tbody>
            </table>
        </div>
    );
}
