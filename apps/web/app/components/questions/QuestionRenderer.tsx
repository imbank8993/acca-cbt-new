"use client";
import type { Question,QuestionOption,QuestionType } from '@/app/types';
import { AnswerValue,normalizeShortAnswer,parseAnswer,parseMCQComplexAnswer } from '@/lib/answer-parser';
import { optionLabel } from '@/lib/option-label';
import { attachmentLabel,safeExternalUrl } from '@/lib/safe-url';
import { AnimatePresence,motion } from 'framer-motion';
import { AlertTriangle,Check,Info,X } from 'lucide-react';
import React,{ useCallback,useEffect,useRef,useState } from 'react';
import { createRoot,Root } from 'react-dom/client';
import AssignmentUploader from './AssignmentUploader';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import { InteractiveMatching } from './InteractiveMatching';
import { LatexRenderer } from './LatexRenderer';
import { StimulusViewer } from './StimulusViewer';

// In QuestionRenderer, we no longer string-replace the placeholder because it breaks SSR hydration.
// Instead, the raw [data-video-embed] placeholder is rendered, and the useEffect mountNodes
// below will find it in the DOM and replace it with CustomVideoPlayer.
function preprocessVideoEmbeds(html: string): string {
    return html;
}


// Combined renderer: LatexRenderer handles both math AND text with alignment
export const QuestionContent = React.memo(({ content, className = '' }: { content: string; className?: string }) => {
    const [isClient, setIsClient] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsClient(true);
    }, []);

    // Effect to mount CustomVideoPlayer into mount points using MutationObserver
    useEffect(() => {
        if (!containerRef.current) return;
        const rootsMap = new Map<Element, Root>();
        
        const mountNodes = () => {
            if (!containerRef.current) return;
            // Find both legacy mount points and new [data-video-embed] placeholders
            const mountPoints = containerRef.current.querySelectorAll('.cbt-custom-video-mount, [data-video-embed]');
            mountPoints.forEach(el => {
                if (el.hasAttribute('data-mounted')) return;

                let url = el.getAttribute('data-video-url') || el.getAttribute('data-src');
                if (!url) {
                    const iframe = el.querySelector('iframe');
                    if (iframe) url = iframe.getAttribute('src');
                }
                const width = el.getAttribute('data-video-width') || el.getAttribute('data-width') || '100%';

                if (url) {
                    // Clear the placeholder content and styles
                    el.innerHTML = '';
                    el.className = 'cbt-custom-video-mount';
                    el.removeAttribute('style');
                    el.setAttribute('data-mounted', 'true');
                    
                    const root = createRoot(el);
                    rootsMap.set(el, root);
                    root.render(<CustomVideoPlayer url={url} width={width} />);
                }
            });
        };

        // Initial mount check
        mountNodes();

        // Setup observer for dynamically added content by LatexRenderer
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    shouldCheck = true;
                }
            });
            if (shouldCheck) {
                mountNodes();
            }
        });

        observer.observe(containerRef.current, {
            childList: true,
            subtree: true
        });

        return () => {
            observer.disconnect();
            rootsMap.forEach((root, el) => {
                setTimeout(() => {
                    try { root.unmount(); } catch {}
                }, 0);
                el.removeAttribute('data-mounted');
            });
            rootsMap.clear();
        };
    }, [content, isClient]);

    if (!content) return null;

    if (!isClient) {
        return (
            <div className={`question-content ${className}`}>
                <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                    <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                </div>
            </div>
        );
    }

    const processed = preprocessVideoEmbeds(content);

    return (
        <div className={`question-content ${className}`} ref={containerRef}>
            <LatexRenderer
                text={processed}
                className={className}
            />
        </div>
    );
});
QuestionContent.displayName = 'QuestionContent';

interface QuestionRendererProps {
    question: Question;
    answer: AnswerValue;
    onAnswerChange: (answer: AnswerValue) => void;
    isPreview?: boolean;
    showFeedback?: boolean;
    showFeedbackLabels?: boolean;
    showQuestion?: boolean;
    showOptions?: boolean;
    questionNumber?: number;
    examId?: string;
    userId?: string;
}

type QuestionMetadata = NonNullable<Question['metadata']>;

function normalizeQuestionMetadata(raw: unknown): QuestionMetadata {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as QuestionMetadata
                : {};
        } catch {
            return {};
        }
    }
    return typeof raw === 'object' && !Array.isArray(raw)
        ? raw as QuestionMetadata
        : {};
}

function firstContentItem(
    value: Question['stimulus'] | Question['question_stimuli'] | Question['instruction'] | Question['question_instructions']
) {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export const QuestionRenderer = React.memo<QuestionRendererProps>(({
    question,
    answer,
    onAnswerChange,
    showFeedback = false,
    showFeedbackLabels = true,
    showQuestion = true,
    showOptions = true,
    questionNumber,
    examId,
    userId
}) => {
    const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
    const [showInstructions, setShowInstructions] = useState(false);

    // Lebar kontainer tabel kategorisasi — dipantau agar header otomatis
    // beralih ke label singkat (K1, K2, …) saat ruangnya sempit, mis. pada
    // tampilan split 2 kolom atau layar mobile.
    const [catWidth, setCatWidth] = useState(0);
    const catObserverRef = useRef<ResizeObserver | null>(null);
    const catWrapRef = useCallback((node: HTMLDivElement | null) => {
        if (catObserverRef.current) {
            catObserverRef.current.disconnect();
            catObserverRef.current = null;
        }
        if (node) {
            setCatWidth(node.clientWidth);
            const ro = new ResizeObserver((entries) => {
                for (const entry of entries) setCatWidth(entry.contentRect.width);
            });
            ro.observe(node);
            catObserverRef.current = ro;
        }
    }, []);

    if (!question) return null;

    const type: QuestionType = question.type;
    const options: QuestionOption[] = question?.bank_question_options ?? [];

    const metadata = normalizeQuestionMetadata(question.metadata);

    // Helper to safely parse JSON answers (imported from lib/answer-parser.ts)


    return (
        <>
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,700&family=Amiri:ital,wght@0,400;0,700;1,400;1,700&family=Cairo:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');

                .question-content {
                    font-family: 'Merriweather', 'Source Serif 4', 'Libre Baskerville', 'Crimson Pro', Georgia, serif;
                    font-size: 13.5px;
                    line-height: 1.6;
                    word-break: normal;
                    overflow-wrap: anywhere;
                    overflow: visible;
                    text-rendering: optimizeLegibility;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }
                .question-content p {
                    margin: 0 0 0.35rem 0;
                    text-align: inherit;
                    overflow: visible;
                }
                .question-content p:last-child {
                    margin-bottom: 0;
                }
                .question-content h1,
                .question-content h2,
                .question-content h3 {
                    font-weight: 700;
                    margin: 0.6rem 0 0.3rem 0;
                    font-size: 0.95rem;
                    color: #1e293b;
                }
                .question-content h1:first-child,
                .question-content h2:first-child,
                .question-content h3:first-child {
                    margin-top: 0;
                }
                .question-content ul,
                .question-content ol {
                    padding-left: 1.5rem;
                    margin: 0.5rem 0;
                }
                .question-content li {
                    margin: 0.25rem 0;
                }
                .question-content img {
                    max-width: 100%;
                    height: auto;
                    border-radius: 0.5rem;
                    margin: 0.5rem 0;
                    display: block;
                }
                .question-content a {
                    color: #3b82f6;
                    text-decoration: underline;
                }
                .question-content blockquote {
                    border-left: 3px solid #e2e8f0;
                    padding-left: 1rem;
                    margin: 0.5rem 0;
                    color: #64748b;
                }
                .question-content code {
                    background-color: #f1f5f9;
                    padding: 0.125rem 0.25rem;
                    border-radius: 0.25rem;
                    font-size: 0.875em;
                    font-family: monospace;
                }

                /* ── KaTeX fraction baseline alignment ── */
                .question-content .katex { font-size: 1em !important; line-height: 1 !important; }
                .question-content .katex-display {
                  display: block !important;
                  margin: 0.75em 0 !important;
                  text-align: center !important;
                  overflow-x: auto !important;
                  overflow-y: hidden !important;
                  max-width: 100% !important;
                  padding: 0.5em 0 !important;
                }

                /* ── Embedded video (YouTube / Vimeo) ── */
                .question-content .cbt-video-embed {
                  position: relative;
                  padding-bottom: 56.25%;
                  height: 0;
                  overflow: hidden;
                  border-radius: 0.75rem;
                  margin: 0.75rem 0;
                  background: #000;
                  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
                }
                .question-content .cbt-video-embed iframe {
                  position: absolute;
                  inset: 0;
                  width: 100%;
                  height: 100%;
                  border: 0;
                }

                /* ── Tipografi Bahasa Arab vs Teks Latin ── */
                .question-content .cbt-arabic-text,
                .cbt-arabic-text {
                  font-family: 'Amiri', 'Noto Naskh Arabic', 'Cairo', 'Traditional Arabic', serif !important;
                  font-size: clamp(19.5px, 1.42em, 23px) !important;
                  line-height: 2.15 !important;
                  font-weight: 500;
                  letter-spacing: 0 !important;
                  word-spacing: 0.05em;
                  direction: rtl;
                  unicode-bidi: isolate;
                  display: inline;
                }

                .question-content .cbt-latin-text,
                .cbt-latin-text {
                  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                  font-size: clamp(12.5px, 0.88em, 14px) !important;
                  line-height: 1.55 !important;
                  font-weight: 400;
                  letter-spacing: 0.01em;
                  direction: ltr;
                  unicode-bidi: isolate;
                  display: inline;
                }

                .question-content .cbt-latin-gloss,
                .cbt-latin-gloss {
                  font-size: clamp(12px, 0.84em, 13.5px) !important;
                  font-style: italic;
                  opacity: 0.88;
                  margin: 0 4px;
                }
            `}</style>

            <div className="w-full space-y-4">
            {/* STIMULUS VIEWER */}
            {(() => {
                const stim = firstContentItem(question.stimulus || question.question_stimuli);
                return showQuestion && stim ? <StimulusViewer stimulus={stim} /> : null;
            })()}

            {/* INSTRUCTIONS MODAL */}
            <AnimatePresence>
                {(() => {
                    const inst = firstContentItem(question.instruction || question.question_instructions);
                    const hasInst = metadata.instructions || inst?.content;

                    return showQuestion && showInstructions && hasInst ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
                            onClick={() => setShowInstructions(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                                className="bg-white rounded-md shadow-xl max-w-lg w-full overflow-hidden"
                                onClick={e => e.stopPropagation()}
                            >
                                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600">
                                            <Info size={16} />
                                        </div>
                                        <h3 className="font-bold text-slate-800">Petunjuk Pengerjaan Soal</h3>
                                    </div>
                                    <button onClick={() => setShowInstructions(false)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-200 rounded-lg transition-colors">
                                        <X size={16} />
                                    </button>
                                </div>
                                <div className="p-6 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
                                    {inst?.content ? (
                                        <QuestionContent content={inst.content} />
                                    ) : (
                                        metadata.instructions
                                    )}
                                </div>
                            </motion.div>
                        </motion.div>
                    ) : null;
                })()}
            </AnimatePresence>

            {/* QUESTION TEXT */}
            {showQuestion && type !== 'short_answer' && (
                <div className={`flex items-start gap-4 relative ${type === 'likert' ? 'flex-col items-center text-center justify-center' : ''}`}>
                    {questionNumber !== undefined && (
                        <div className="hidden">{questionNumber}</div>
                    )}
                    <div className={`flex-1 min-w-0 ${type === 'likert' ? 'w-full max-w-4xl mx-auto px-4 sm:px-8' : ''}`}>
                        <QuestionContent content={question.question_text || ''} className="text-sm leading-relaxed text-slate-800" />
                    </div>
                    {(() => {
                        const inst = firstContentItem(question.instruction || question.question_instructions);
                        const hasInst = metadata.instructions || inst?.content;
                        
                        return hasInst ? (
                            <button
                                onClick={() => setShowInstructions(true)}
                                className="shrink-0 flex items-center justify-center w-9 h-9 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 hover:text-amber-700 transition-colors shadow-sm"
                                title="Petunjuk Soal"
                            >
                                <Info size={18} />
                            </button>
                        ) : null;
                    })()}
                </div>
            )}

            {/* OPTIONS */}
            {showOptions && (
                <div className="space-y-3">

                    {/* ── MCQ ── */}
                    {type === 'mcq' && (() => {
                        const seen = new Set<string>();
                        const uniqueOptions = options.filter((opt) => {
                            if (!opt.id) return true;
                            if (seen.has(opt.id)) return false;
                            seen.add(opt.id);
                            return (opt.option_text || opt.text || '').trim().length > 0;
                        });
                        return uniqueOptions.map((opt, idx) => {
                        const isSelected = answer === opt.id;
                        
                        const label = optionLabel(idx);
                        const isCorrect = opt.is_correct || opt.isCorrect;

                        let borderClass = 'border-slate-200 hover:border-slate-300 dark:border-slate-700/80 dark:hover:border-primary/60';
                        let bgClass = 'bg-white hover:bg-slate-50/60 dark:bg-[#1a233a] dark:hover:bg-[#222f4b]';
                        let labelClass = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-[#24324f] dark:text-slate-200 dark:border-slate-600';
                        let textClass = 'text-slate-700 dark:text-slate-200';
                        let checkClass = '';

                        // Sama seperti PGK: pilihan siswa harus terlihat terpisah
                        // dari kunci. Kunci yang tidak dipilih tampil bergaris
                        // putus-putus tanpa tanda centang.
                        if (showFeedback) {
                            if (isSelected && isCorrect) {
                                borderClass = 'border-[#3083FF] shadow-sm dark:border-primary';
                                bgClass = 'bg-blue-50/70 dark:bg-blue-950/40';
                                labelClass = 'bg-[#3083FF] text-white border-[#3083FF] dark:bg-primary dark:text-white dark:border-primary';
                                textClass = 'text-slate-900 dark:text-white font-medium';
                                checkClass = 'bg-[#3083FF] text-white';
                            } else if (isSelected) {
                                borderClass = 'border-rose-300 dark:border-rose-700';
                                bgClass = 'bg-rose-50/70 dark:bg-rose-950/40';
                                labelClass = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-700 font-bold';
                                textClass = 'text-rose-900 dark:text-rose-200 font-medium';
                                checkClass = 'bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-700';
                            } else if (isCorrect) {
                                borderClass = 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/40';
                                bgClass = 'bg-emerald-50/50 dark:bg-emerald-950/40';
                                labelClass = 'bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-600 dark:text-white dark:border-emerald-500 font-bold';
                                textClass = 'text-emerald-950 dark:text-emerald-200 font-medium';
                                checkClass = 'bg-emerald-500 text-white';
                            } else {
                                textClass = 'text-slate-400 dark:text-slate-500';
                                bgClass = 'bg-white/60 dark:bg-[#1a233a]/60 opacity-60';
                            }
                        } else if (isSelected) {
                            borderClass = 'border-[#3083FF] shadow-sm dark:border-primary ring-1 ring-[#3083FF]/30 dark:ring-primary/40';
                            bgClass = 'bg-blue-50/50 dark:bg-primary/20';
                            labelClass = 'bg-[#3083FF] text-white border-[#3083FF] dark:bg-primary dark:text-white dark:border-primary';
                            textClass = 'text-slate-900 dark:text-white font-medium';
                            checkClass = 'bg-[#3083FF] text-white';
                        }

                        return (
                            <label
                                key={opt.id}
                                data-cbt-option
                                data-selected={isSelected}
                                data-correct={showFeedback && isCorrect}
                                data-wrong={showFeedback && isSelected && !isCorrect}
                                className={`cbt-option-item flex items-start gap-2.5 p-2.5 sm:p-3 rounded-lg border ${borderClass} ${bgClass} cursor-pointer transition-all duration-150 hover:shadow-sm`}
                            >
                                <input type="radio" className="hidden" checked={isSelected} disabled={showFeedback} onChange={() => onAnswerChange(opt.id)} />
                                <div
                                    data-cbt-badge
                                    data-selected={isSelected}
                                    data-correct={showFeedback && isCorrect}
                                    data-wrong={showFeedback && isSelected && !isCorrect}
                                    className={`cbt-option-badge w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded flex items-center justify-center font-bold text-xs leading-none border-2 transition-colors ${labelClass}`}
                                >
                                    {label}
                                </div>
                                <div className={`flex-1 min-w-0 text-xs sm:text-sm font-normal transition-colors ${textClass}`}>
                                    <QuestionContent content={(opt.option_text || opt.text || '')} />
                                </div>
                                {isSelected && !showFeedback && (
                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${checkClass}`}>
                                        <Check size={12} strokeWidth={3} />
                                    </motion.div>
                                )}
                                {showFeedback && showFeedbackLabels && (
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        {isSelected && isCorrect && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3083FF] text-white flex items-center gap-1">
                                                <Check size={10} strokeWidth={3} /> Jawaban Siswa & Kunci
                                            </span>
                                        )}
                                        {isSelected && !isCorrect && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
                                                <X size={10} strokeWidth={3} /> Jawaban Siswa (Salah)
                                            </span>
                                        )}
                                        {!isSelected && isCorrect && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                                <Check size={10} strokeWidth={3} /> Kunci Jawaban
                                            </span>
                                        )}
                                    </div>
                                )}
                                {showFeedback && (isSelected || isCorrect) && (
                                    <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${checkClass}`}>
                                        {isSelected && !isCorrect ? <X size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
                                    </div>
                                )}
                            </label>
                        );
                        });
                    })()}

                    {/* ── TRUE FALSE ── */}
                    {type === 'true_false' && (() => {
                        const seen = new Set<string>();
                        const uniqueOptions = options.filter((opt) => {
                            if (!opt.id) return true;
                            if (seen.has(opt.id)) return false;
                            seen.add(opt.id);
                            return (opt.option_text || opt.text || '').trim().length > 0;
                        });
                        return (
                            <div className="space-y-2">
                                {uniqueOptions.map((opt) => {
                                    const studentAnswers = parseAnswer(answer, {}) as Record<string, string>;
                                    const currentVal = studentAnswers[opt.id];
                                    const isCorrectAnswer = opt.is_correct;

                                    return (
                                        <div key={opt.id} data-cbt-option className="cbt-option-item flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-white dark:bg-[#1a233a] border border-slate-200 dark:border-slate-700/80 rounded-md">
                                            <div className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200">
                                                <QuestionContent content={opt.option_text || ''} />
                                            </div>
                                            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                                                <button
                                                    type="button"
                                                    disabled={showFeedback}
                                                    onClick={() => {
                                                        const next = { ...studentAnswers, [opt.id]: 'benar' };
                                                        onAnswerChange(JSON.stringify(next));
                                                    }}
                                                    className={`flex-1 sm:flex-none px-3.5 sm:px-4 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold uppercase tracking-wider transition-all
                                                        ${currentVal === 'benar'
                                                            ? (showFeedback ? (isCorrectAnswer ? 'bg-[#3083FF] text-white shadow-sm' : 'bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-700 font-bold') : 'bg-[#3083FF] text-white')
                                                            : (showFeedback && isCorrectAnswer ? 'bg-emerald-500 text-white border border-emerald-500 shadow-sm font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#24324f] dark:text-slate-200 dark:border-slate-600 dark:hover:bg-[#2e3e62] border border-slate-200')
                                                        }`}
                                                >
                                                    Benar
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={showFeedback}
                                                    onClick={() => {
                                                        const next = { ...studentAnswers, [opt.id]: 'salah' };
                                                        onAnswerChange(JSON.stringify(next));
                                                    }}
                                                    className={`flex-1 sm:flex-none px-3.5 sm:px-4 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold uppercase tracking-wider transition-all
                                                        ${currentVal === 'salah'
                                                            ? (showFeedback ? (!isCorrectAnswer ? 'bg-[#3083FF] text-white shadow-sm' : 'bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-700 font-bold') : 'bg-[#3083FF] text-white')
                                                            : (showFeedback && !isCorrectAnswer ? 'bg-emerald-500 text-white border border-emerald-500 shadow-sm font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#24324f] dark:text-slate-200 dark:border-slate-600 dark:hover:bg-[#2e3e62] border border-slate-200')
                                                        }`}
                                                >
                                                    Salah
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* ── MCQ COMPLEX ── */}
                    {type === 'mcq_complex' && (() => {
                        const seen = new Set<string>();
                        const uniqueOptions = options.filter((opt) => {
                            if (!opt.id) return true;
                            if (seen.has(opt.id)) return false;
                            seen.add(opt.id);
                            return (opt.option_text || opt.text || '').trim().length > 0;
                        });
                        return uniqueOptions.map((opt, idx) => {
                        const selectedIds = parseMCQComplexAnswer(answer);
                        const isSelected = selectedIds.includes(opt.id);
                        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
                        const isCorrect = opt.is_correct || opt.isCorrect;

                        let borderClass = 'border-slate-200 hover:border-slate-300 dark:border-slate-700/80 dark:hover:border-primary/60';
                        let bgClass = 'bg-white hover:bg-slate-50/60 dark:bg-[#1a233a] dark:hover:bg-[#222f4b]';
                        let labelClass = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-[#24324f] dark:text-slate-200 dark:border-slate-600';
                        let textClass = 'text-slate-700 dark:text-slate-200';
                        let checkBg = 'bg-white border-slate-300 dark:bg-[#24324f] dark:border-slate-600';

                        // Saat review, apa yang DICENTANG SISWA harus tetap terbaca
                        // terpisah dari KUNCI. Dulu cabang isCorrect dievaluasi
                        // lebih dulu, sehingga opsi benar yang tidak dicentang
                        // tampil identik dengan yang dicentang — centang yang
                        // hilang jadi mustahil terdeteksi dari layar monitoring.
                        if (showFeedback) {
                            if (isSelected && isCorrect) {
                                borderClass = 'border-[#3083FF] shadow-sm dark:border-primary'; bgClass = 'bg-blue-50/70 dark:bg-blue-950/40';
                                labelClass = 'bg-[#3083FF] text-white border-[#3083FF] dark:bg-primary dark:text-white dark:border-primary';
                                textClass = 'text-slate-900 dark:text-white font-medium'; checkBg = 'bg-[#3083FF] border-[#3083FF] text-white dark:bg-primary dark:border-primary dark:text-white';
                            } else if (isSelected) {
                                borderClass = 'border-rose-300 dark:border-rose-700'; bgClass = 'bg-rose-50/70 dark:bg-rose-950/40';
                                labelClass = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-700 font-bold';
                                textClass = 'text-rose-900 dark:text-rose-200 font-medium'; checkBg = 'bg-rose-100 border-rose-300 text-rose-600 dark:bg-rose-900/60 dark:border-rose-700 dark:text-rose-300';
                            } else if (isCorrect) {
                                borderClass = 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/40'; bgClass = 'bg-emerald-50/50 dark:bg-emerald-950/40';
                                labelClass = 'bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-600 dark:text-white dark:border-emerald-500 font-bold';
                                textClass = 'text-emerald-950 dark:text-emerald-200 font-medium'; checkBg = 'bg-emerald-500 border-emerald-500 text-white dark:bg-emerald-600 dark:border-emerald-500 dark:text-white';
                            } else {
                                textClass = 'text-slate-400 dark:text-slate-500'; bgClass = 'bg-white/60 dark:bg-[#1a233a]/60 opacity-60';
                            }
                        } else if (isSelected) {
                            borderClass = 'border-[#3083FF] shadow-sm dark:border-primary ring-1 ring-[#3083FF]/30 dark:ring-primary/40'; bgClass = 'bg-blue-50/50 dark:bg-primary/20';
                            labelClass = 'bg-[#3083FF] text-white border-[#3083FF] dark:bg-primary dark:text-white dark:border-primary';
                            textClass = 'text-slate-900 dark:text-white font-medium'; checkBg = 'bg-[#3083FF] border-[#3083FF] text-white dark:bg-primary dark:border-primary dark:text-white';
                        }

                        return (
                            <label
                                key={opt.id}
                                data-cbt-option
                                data-selected={isSelected}
                                data-correct={showFeedback && isCorrect}
                                data-wrong={showFeedback && isSelected && !isCorrect}
                                className={`cbt-option-item flex items-start gap-2.5 p-2.5 sm:p-3 rounded-lg border ${borderClass} ${bgClass} cursor-pointer transition-all duration-150 hover:shadow-sm`}
                            >
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={isSelected}
                                    disabled={showFeedback}
                                    onChange={() => {
                                        let next;
                                        if (isSelected) next = selectedIds.filter((id: string) => id !== opt.id);
                                        else next = [...selectedIds, opt.id];
                                        onAnswerChange(JSON.stringify(next));
                                    }}
                                />
                                <div
                                    data-cbt-badge
                                    data-selected={isSelected}
                                    data-correct={showFeedback && isCorrect}
                                    data-wrong={showFeedback && isSelected && !isCorrect}
                                    className={`cbt-option-badge w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded flex items-center justify-center font-bold text-xs leading-none border-2 transition-colors ${labelClass}`}
                                >
                                    {letters[idx] || '?'}
                                </div>
                                <div className={`flex-1 min-w-0 text-xs sm:text-sm font-normal transition-colors ${textClass}`}>
                                    <QuestionContent content={(opt.option_text || opt.text || '')} />
                                </div>
                                {showFeedback && showFeedbackLabels && (
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        {isSelected && isCorrect && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3083FF] text-white flex items-center gap-1">
                                                <Check size={10} strokeWidth={3} /> Jawaban Siswa & Kunci
                                            </span>
                                        )}
                                        {isSelected && !isCorrect && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
                                                <X size={10} strokeWidth={3} /> Jawaban Siswa (Salah)
                                            </span>
                                        )}
                                        {!isSelected && isCorrect && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                                <Check size={10} strokeWidth={3} /> Kunci Jawaban
                                            </span>
                                        )}
                                    </div>
                                )}
                                <div className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${checkBg}`}>
                                    {showFeedback ? (
                                        isSelected && isCorrect ? <Check size={12} strokeWidth={3} className="text-white" /> :
                                        isSelected && !isCorrect ? <X size={12} strokeWidth={3} className="text-rose-600" /> :
                                        !isSelected && isCorrect ? <Check size={12} strokeWidth={3} className="text-white" /> : null
                                    ) : (
                                        isSelected && <Check size={12} strokeWidth={3} className="text-white" />
                                    )}
                                </div>
                            </label>
                        );
                        });
                    })()}

                    {/* ── CATEGORIZATION ── */}
                    {type === 'categorization' && (() => {
                        const categoryList: string[] = metadata?.categories?.length
                            ? metadata.categories
                            : Array.from(new Set((options || []).flatMap((o) => o?.metadata?.category_names || (o?.metadata?.category_name ? [o.metadata.category_name] : []))));

                        // Header memakai label singkat (K1, K2, …) + keterangan di
                        // bawah tabel jika: (a) ada nama kategori panjang, atau
                        // (b) ruang per kolom kategori terlalu sempit untuk nama
                        // terbaca — mis. tampilan split 2 kolom atau layar mobile.
                        // Kolom pernyataan memakai ±50% lebar, sisanya dibagi rata.
                        const LONG_CATEGORY_CHARS = 16;
                        const perCategoryWidth = categoryList.length > 0 ? (catWidth * 0.5) / categoryList.length : Infinity;
                        const useLegend =
                            categoryList.some((c) => (c || '').length > LONG_CATEGORY_CHARS) ||
                            (catWidth > 0 && perCategoryWidth < 100);

                        return (
                        <div ref={catWrapRef}>
                            {/* Desktop/Tablet Layout (Grid Table) */}
                            <div className="hidden sm:block overflow-x-auto rounded-md border border-slate-100 dark:border-slate-700">
                                <table className="w-full table-fixed">
                                    <thead>
                                        <tr>
                                            <th className="w-[45%] min-w-[200px]"></th>
                                            {categoryList.map((cat: string, catIdx: number) => {
                                                const COLORS = ['violet', 'blue', 'teal', 'emerald', 'amber', 'rose', 'indigo', 'cyan'];
                                                const c = COLORS[catIdx % COLORS.length];
                                                return (
                                                    <th key={cat} className="px-2 pb-2 last:pr-4">
                                                        <div title={cat} className={`rounded-lg bg-${c}-500 text-white px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider`}>
                                                            {useLegend ? `K${catIdx + 1}` : cat}
                                                        </div>
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {options.filter((opt) => (opt.option_text || opt.text || '').trim().length > 0).map((opt, optIdx) => {
                                            const studentSelection = parseAnswer<Record<string, string[]>>(answer, {});
                                            const selectedCats = studentSelection[opt.id] || [] as string[];
                                            const correctCats = opt.category_names || opt.metadata?.category_names || (opt.metadata?.category_name ? [opt.metadata.category_name] : []);
                                            const availableCategories = categoryList;

                                            const COLORS = [
                                                { bg: 'bg-violet-100', border: 'border-violet-200', active: 'bg-violet-500', text: 'text-violet-600', activeText: 'text-white' },
                                                { bg: 'bg-blue-100', border: 'border-blue-200', active: 'bg-blue-500', text: 'text-blue-600', activeText: 'text-white' },
                                                { bg: 'bg-teal-100', border: 'border-teal-200', active: 'bg-teal-500', text: 'text-teal-600', activeText: 'text-white' },
                                                { bg: 'bg-emerald-100', border: 'border-emerald-200', active: 'bg-emerald-500', text: 'text-emerald-600', activeText: 'text-white' },
                                                { bg: 'bg-amber-100', border: 'border-amber-200', active: 'bg-amber-500', text: 'text-amber-600', activeText: 'text-white' },
                                                { bg: 'bg-rose-100', border: 'border-rose-200', active: 'bg-rose-500', text: 'text-rose-600', activeText: 'text-white' },
                                                { bg: 'bg-indigo-100', border: 'border-indigo-200', active: 'bg-indigo-500', text: 'text-indigo-600', activeText: 'text-white' },
                                                { bg: 'bg-cyan-100', border: 'border-cyan-200', active: 'bg-cyan-500', text: 'text-cyan-600', activeText: 'text-white' },
                                            ];

                                            return (
                                                <motion.tr key={opt.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: optIdx * 0.03 }}>
                                                    <td className="py-3 px-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 shrink-0 rounded bg-slate-800 dark:bg-[#24324f] flex items-center justify-center text-white font-black text-xs leading-none pt-[1px]">
                                                                {optIdx + 1}
                                                            </div>
                                                            <div className="text-sm font-medium text-slate-700 dark:text-slate-200 min-w-0 [&_p]:!m-0">
                                                                <QuestionContent content={(opt.option_text || opt.text || '')} />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    {availableCategories.map((cat: string, catIdx: number) => {
                                                        const isChecked = selectedCats.includes(cat);
                                                        const shouldBeChecked = correctCats.includes(cat);
                                                        const color = COLORS[catIdx % COLORS.length];

                                                        let cellStatus = 'idle';
                                                        if (showFeedback) {
                                                            if (isChecked && shouldBeChecked) cellStatus = 'correct';
                                                            else if (isChecked && !shouldBeChecked) cellStatus = 'wrong';
                                                            else if (!isChecked && shouldBeChecked) cellStatus = 'missing';
                                                        } else if (isChecked) {
                                                            cellStatus = 'selected';
                                                        }

                                                        return (
                                                            <td key={cat} className="py-2 px-1.5 last:pr-4">
                                                                <div className="flex items-center justify-center">
                                                                    <button
                                                                        disabled={showFeedback}
                                                                        onClick={() => {
                                                                            const nextCats = isChecked
                                                                                ? selectedCats.filter((c: string) => c !== cat)
                                                                                : [...selectedCats, cat];
                                                                            const next = { ...studentSelection, [opt.id]: nextCats };
                                                                            onAnswerChange(JSON.stringify(next));
                                                                        }}
                                                                        className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all text-white text-xs font-bold
                                                                            ${cellStatus === 'idle' ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a233a] hover:bg-slate-100 dark:hover:bg-[#24324f]' : ''}
                                                                            ${cellStatus === 'selected' ? `${color.active} border-transparent shadow-sm` : ''}
                                                                            ${cellStatus === 'correct' ? 'bg-[#3083FF] border-transparent shadow-sm' : ''}
                                                                            ${cellStatus === 'wrong' ? 'bg-rose-400 border-transparent shadow-sm' : ''}
                                                                            ${cellStatus === 'missing' ? 'bg-emerald-500 border-transparent shadow-sm text-white' : ''}
                                                                        `}
                                                                    >
                                                                        {cellStatus === 'correct' && <Check size={13} strokeWidth={3} />}
                                                                        {cellStatus === 'wrong' && <AlertTriangle size={13} strokeWidth={3} />}
                                                                        {cellStatus === 'missing' && <Check size={13} strokeWidth={3} />}
                                                                        {cellStatus === 'selected' && <Check size={13} strokeWidth={3} />}
                                                                        {cellStatus === 'idle' && <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />}
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        );
                                                    })}
                                                </motion.tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Layout (Card-Based) */}
                            <div className="block sm:hidden space-y-4">
                                {options.filter((opt) => (opt.option_text || opt.text || '').trim().length > 0).map((opt, optIdx) => {
                                    const studentSelection = parseAnswer<Record<string, string[]>>(answer, {});
                                    const selectedCats = studentSelection[opt.id] || [] as string[];
                                    const correctCats = opt.category_names || opt.metadata?.category_names || (opt.metadata?.category_name ? [opt.metadata.category_name] : []);

                                    return (
                                        <div key={opt.id} data-cbt-option className="cbt-option-item bg-slate-50/50 dark:bg-[#1a233a] border border-slate-100 dark:border-slate-700/80 rounded-2xl p-4 space-y-3 text-left">
                                            <div className="flex items-start gap-3">
                                                <div className="w-7 h-7 shrink-0 rounded bg-slate-800 dark:bg-[#24324f] flex items-center justify-center text-white font-black text-xs leading-none mt-0.5">
                                                    {optIdx + 1}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-805 dark:text-slate-100 min-w-0 [&_p]:!m-0 pt-0.5">
                                                    <QuestionContent content={(opt.option_text || opt.text || '')} />
                                                </div>
                                            </div>

                                            <div className="space-y-2 pt-1 pl-1">
                                                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider font-sans">Pilih Kategori:</p>
                                                <div className="grid grid-cols-1 gap-2">
                                                    {categoryList.map((cat: string, catIdx: number) => {
                                                        const isChecked = selectedCats.includes(cat);
                                                        const shouldBeChecked = correctCats.includes(cat);
                                                        const COLORS = [
                                                            { bg: 'bg-violet-50', border: 'border-violet-200/60', text: 'text-violet-700', active: 'bg-violet-600 border-transparent text-white' },
                                                            { bg: 'bg-blue-50', border: 'border-blue-200/60', text: 'text-blue-700', active: 'bg-blue-600 border-transparent text-white' },
                                                            { bg: 'bg-teal-50', border: 'border-teal-200/60', text: 'text-teal-700', active: 'bg-teal-600 border-transparent text-white' },
                                                            { bg: 'bg-emerald-50', border: 'border-emerald-200/60', text: 'text-emerald-700', active: 'bg-emerald-600 border-transparent text-white' },
                                                            { bg: 'bg-amber-50', border: 'border-amber-200/60', text: 'text-amber-700', active: 'bg-amber-600 border-transparent text-white' },
                                                            { bg: 'bg-rose-50', border: 'border-rose-200/60', text: 'text-rose-700', active: 'bg-rose-600 border-transparent text-white' },
                                                            { bg: 'bg-indigo-50', border: 'border-indigo-200/60', text: 'text-indigo-700', active: 'bg-indigo-600 border-transparent text-white' },
                                                            { bg: 'bg-cyan-50', border: 'border-cyan-200/60', text: 'text-cyan-700', active: 'bg-cyan-600 border-transparent text-white' },
                                                        ];
                                                        const color = COLORS[catIdx % COLORS.length];

                                                        let cellStatus = 'idle';
                                                        if (showFeedback) {
                                                            if (isChecked && shouldBeChecked) cellStatus = 'correct';
                                                            else if (isChecked && !shouldBeChecked) cellStatus = 'wrong';
                                                            else if (!isChecked && shouldBeChecked) cellStatus = 'missing';
                                                        } else if (isChecked) {
                                                            cellStatus = 'selected';
                                                        }

                                                        return (
                                                            <button
                                                                key={cat}
                                                                disabled={showFeedback}
                                                                onClick={() => {
                                                                    const nextCats = isChecked
                                                                        ? selectedCats.filter((c: string) => c !== cat)
                                                                        : [...selectedCats, cat];
                                                                    const next = { ...studentSelection, [opt.id]: nextCats };
                                                                    onAnswerChange(JSON.stringify(next));
                                                                }}
                                                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all text-left ${
                                                                    cellStatus === 'idle' ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24324f] hover:bg-slate-50 dark:hover:bg-[#2d3d60] text-slate-700 dark:text-slate-200' : ''
                                                                } ${
                                                                    cellStatus === 'selected' ? `${color.active} shadow-sm` : ''
                                                                } ${
                                                                    cellStatus === 'correct' ? 'bg-[#3083FF] border-transparent text-white' : ''
                                                                } ${
                                                                    cellStatus === 'wrong' ? 'bg-rose-400 border-transparent text-white' : ''
                                                                } ${
                                                                    cellStatus === 'missing' ? 'bg-emerald-500 border-transparent text-white' : ''
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${isChecked ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                                        K{catIdx + 1}
                                                                    </span>
                                                                    <span>{cat}</span>
                                                                </div>
                                                                <div className="shrink-0 ml-2">
                                                                    {cellStatus === 'correct' && <Check size={13} strokeWidth={3} />}
                                                                    {cellStatus === 'wrong' && <AlertTriangle size={13} strokeWidth={3} />}
                                                                    {cellStatus === 'missing' && <span className="text-[9px] font-extrabold">SEHARUSNYA</span>}
                                                                    {cellStatus === 'selected' && <Check size={13} strokeWidth={3} />}
                                                                    {cellStatus === 'idle' && <div className="w-2.5 h-2.5 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Keterangan label kategori (K1, K2, …) saat nama kategori panjang */}
                            {useLegend && (
                                <div className="hidden sm:block mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-1.5">
                                    {categoryList.map((cat: string, catIdx: number) => {
                                        const COLORS = ['violet', 'blue', 'teal', 'emerald', 'amber', 'rose', 'indigo', 'cyan'];
                                        const c = COLORS[catIdx % COLORS.length];
                                        return (
                                            <div key={cat} className="flex items-start gap-2">
                                                <span className={`shrink-0 mt-[1px] rounded bg-${c}-500 text-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider`}>
                                                    K{catIdx + 1}
                                                </span>
                                                <span className="text-xs text-slate-650 leading-snug">{cat}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        );
                    })()}

                    {/* ── MATCHING ── */}
                    {type === 'matching' && (
                        <InteractiveMatching
                            questionId={question.id}
                            userId={userId}
                            options={options}
                            rightItems={(() => {
                                const raw: string[] = metadata?.right_items?.length
                                    ? metadata.right_items
                                    : (options || []).flatMap((o) => o?.metadata?.match_texts || (o?.metadata?.match_text ? [o.metadata.match_text] : []));
                                return Array.from(new Set(raw.map((s) => (String(s) || '').trim()))).filter((s: string) => s.length > 0);
                            })()}
                            answers={parseAnswer<Record<string, string[]>>(answer, {})}
                            onAnswerChange={(leftId: string, rightText: string) => {
                                const studentPairs = parseAnswer<Record<string, string[]>>(answer, {});
                                const current = studentPairs[leftId] || [] as string[];
                                const next = current.includes(rightText)
                                    ? []
                                    : [rightText];
                                const nextPairs = { ...studentPairs, [leftId]: next };
                                onAnswerChange(JSON.stringify(nextPairs));
                            }}
                            selectedLeft={selectedLeft}
                            onSelectLeft={setSelectedLeft}
                            showFeedback={showFeedback}
                        />
                    )}

                    {/* ── SHORT ANSWER ── */}
                    {type === 'short_answer' && (
                        <div className="space-y-4">
                            {/* Parse question text for ..... blanks */}
                            <ShortAnswerInline
                                questionText={question.question_text || ''}
                                answer={answer}
                                showFeedback={showFeedback}
                                onAnswerChange={onAnswerChange}
                                allVariations={metadata.blanks?.map((b) => {
                                    const answer = typeof b.answer === 'string' && b.answer.trim() !== '' ? b.answer : null;
                                    const variations = Array.isArray(b.variations) ? b.variations : [];
                                    return answer ? [answer, ...variations] : variations;
                                }) || []}
                            />
                        </div>
                    )}

                    {/* ── ESSAY ── */}
                    {(type === 'essay' || type === 'uraian') && (
                        <EssayInput 
                            answer={answer} 
                            showFeedback={showFeedback} 
                            onAnswerChange={onAnswerChange} 
                            metadata={metadata}
                            options={options}
                            examId={examId}
                            userId={userId}
                        />
                    )}

                    {/* ── LIKERT ── */}
                    {type === 'likert' && (() => {
                        const scale = [1, 2, 3, 4, 5];
                        const labels = ['Sangat Tidak Setuju', '', '', '', 'Sangat Setuju'];
                        return (
                            <div className="mt-12 mb-10 px-4 sm:px-12 w-full max-w-4xl mx-auto">
                                <div className="relative">
                                    {/* Garis Horizontal */}
                                    <div className="absolute top-1/2 left-0 right-0 h-1.5 bg-slate-200 dark:bg-slate-700 -translate-y-1/2 rounded-full"></div>
                                    
                                    {/* Panah Kiri */}
                                    <div className="absolute top-1/2 -left-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-slate-300 dark:border-r-slate-600 -translate-y-1/2"></div>
                                    
                                    {/* Panah Kanan */}
                                    <div className="absolute top-1/2 -right-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[8px] border-l-slate-300 dark:border-l-slate-600 -translate-y-1/2"></div>
                                    
                                    <div className="relative flex justify-between items-center z-10">
                                        {scale.map((val, idx) => {
                                            const isSelected = answer === String(val);
                                            return (
                                                <div key={val} className="relative flex flex-col items-center">
                                                    <button
                                                        type="button"
                                                        disabled={showFeedback}
                                                        onClick={() => onAnswerChange(String(val))}
                                                        className={`w-[28px] h-[28px] sm:w-[34px] sm:h-[34px] rounded-full border-[3px] flex items-center justify-center transition-all ${
                                                            isSelected 
                                                                ? 'bg-primary border-primary text-white scale-110 shadow-lg shadow-primary/30' 
                                                                : 'bg-white dark:bg-[#24324f] border-slate-300 dark:border-slate-600 hover:border-primary/50 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#2e3e62]'
                                                        }`}
                                                    >
                                                        {isSelected && <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-white" />}
                                                    </button>
                                                    
                                                    {/* Label (Hanya ujung kiri dan ujung kanan) */}
                                                    {(idx === 0 || idx === 4) && (
                                                        <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-4 w-28 sm:w-32 text-[10px] sm:text-xs font-bold tracking-wider uppercase leading-tight text-center ${isSelected ? 'text-primary' : 'text-slate-500 dark:text-slate-400'}`}>
                                                            {labels[idx]}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* ── FORCED CHOICE & PAIRED COMPARISON ── */}
                    {(type === 'forced_choice' || type === 'paired_comparison') && (() => {
                        const colorMap = {
                            paired_comparison: { border: 'border-pink-500', bg: 'bg-pink-50', boxBg: 'bg-pink-500 border-pink-500 text-white', text: 'text-pink-800' },
                            forced_choice: { border: 'border-fuchsia-500', bg: 'bg-fuchsia-50', boxBg: 'bg-fuchsia-500 border-fuchsia-500 text-white', text: 'text-fuchsia-800' }
                        };
                        const colors = colorMap[type as keyof typeof colorMap];
                        const validOptions = options.filter(opt => (opt.option_text || opt.text || '').trim().length > 0);

                        return validOptions.map((opt) => {
                            const isSelected = answer === opt.id;

                            let borderClass = 'border-slate-200 hover:border-slate-300 dark:border-slate-700/80 dark:hover:border-primary/60';
                            let bgClass = 'bg-white hover:bg-slate-50/50 dark:bg-[#1a233a] dark:hover:bg-[#222f4b]';
                            let boxClass = 'bg-slate-100 border-slate-300 text-transparent dark:bg-[#24324f] dark:border-slate-600';
                            let textClass = 'text-slate-700 dark:text-slate-200';

                            if (isSelected) {
                                borderClass = colors.border;
                                bgClass = `${colors.bg} dark:bg-pink-950/30`;
                                boxClass = colors.boxBg;
                                textClass = `${colors.text} dark:text-pink-200`;
                            }

                            return (
                                <label
                                    key={opt.id}
                                    data-cbt-option
                                    data-selected={isSelected}
                                    className={`cbt-option-item flex items-start gap-4 p-3 sm:p-4 rounded-xl border-2 ${borderClass} ${bgClass} cursor-pointer transition-all duration-150 hover:shadow-sm`}
                                >
                                    <input type="radio" className="hidden" checked={isSelected} disabled={showFeedback} onChange={() => onAnswerChange(opt.id)} />
                                    <div className={`mt-0.5 w-6 h-6 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${boxClass}`}>
                                        {isSelected && (
                                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                                <Check size={14} strokeWidth={3} />
                                            </motion.div>
                                        )}
                                    </div>
                                    <div className={`flex-1 min-w-0 text-sm font-medium transition-colors pt-0.5 ${textClass}`}>
                                        <QuestionContent content={(opt.option_text || opt.text || '')} />
                                    </div>
                                </label>
                            );
                        });
                    })()}

                    {/* ── CHECKLIST ── */}
                    {type === 'checklist' && (() => {
                        const studentAnswers = parseAnswer<Record<string, string>>(answer, {});
                        const uniqueOptions = options.filter(opt => (opt.option_text || opt.text || '').trim().length > 0);
                        return (
                            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-[#1e293f] border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider font-bold">
                                            <th className="px-4 py-3 w-[70%]">Pernyataan</th>
                                            <th className="px-4 py-3 text-center w-[15%]">Ya</th>
                                            <th className="px-4 py-3 text-center w-[15%]">Tidak</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {uniqueOptions.map((opt) => {
                                            const currentVal = studentAnswers[opt.id];
                                            return (
                                                <tr key={opt.id} className="bg-white dark:bg-[#1a233a] hover:bg-slate-50/50 dark:hover:bg-[#222f4b] transition-colors">
                                                    <td className="px-4 py-3 align-middle">
                                                        <div className="text-sm text-slate-700 dark:text-slate-200">
                                                            <QuestionContent content={opt.option_text || opt.text || ''} />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 align-middle text-center">
                                                        <button
                                                            disabled={showFeedback}
                                                            onClick={() => {
                                                                const next = { ...studentAnswers, [opt.id]: 'ya' };
                                                                onAnswerChange(JSON.stringify(next));
                                                            }}
                                                            className={`w-6 h-6 sm:w-7 sm:h-7 mx-auto rounded-full border-2 flex items-center justify-center transition-all ${
                                                                currentVal === 'ya'
                                                                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                                                    : 'bg-white dark:bg-[#24324f] border-slate-300 dark:border-slate-600 hover:border-emerald-400 text-transparent'
                                                            }`}
                                                        >
                                                            <Check size={14} strokeWidth={3} />
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-3 align-middle text-center">
                                                        <button
                                                            disabled={showFeedback}
                                                            onClick={() => {
                                                                const next = { ...studentAnswers, [opt.id]: 'tidak' };
                                                                onAnswerChange(JSON.stringify(next));
                                                            }}
                                                            className={`w-6 h-6 sm:w-7 sm:h-7 mx-auto rounded-full border-2 flex items-center justify-center transition-all ${
                                                                currentVal === 'tidak'
                                                                    ? 'bg-rose-500 border-rose-500 text-white shadow-sm'
                                                                    : 'bg-white dark:bg-[#24324f] border-slate-300 dark:border-slate-600 hover:border-rose-400 text-transparent'
                                                            }`}
                                                        >
                                                            <Check size={14} strokeWidth={3} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })()}

                    {/* ── SJT ── */}
                    {type === 'sjt' && (() => {
                        const seen = new Set<string>();
                        const uniqueOptions = options.filter((opt) => {
                            if (!opt.id) return true;
                            if (seen.has(opt.id)) return false;
                            seen.add(opt.id);
                            return (opt.option_text || opt.text || '').trim().length > 0;
                        });
                        const maxWeight = Math.max(...uniqueOptions.map(o => o.weight ?? 0));
                        return uniqueOptions.map((opt, idx) => {
                            const isSelected = answer === opt.id;
                            
                            const label = optionLabel(idx);
                            const optWeight = opt.weight ?? 0;
                            const isHighest = optWeight === maxWeight;

                            let borderClass = 'border-slate-200 hover:border-slate-300 dark:border-slate-700/80 dark:hover:border-primary/60';
                            let bgClass = 'bg-white hover:bg-slate-50/50 dark:bg-[#1a233a] dark:hover:bg-[#222f4b]';
                            let labelClass = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-[#24324f] dark:text-slate-200 dark:border-slate-600';
                            let textClass = 'text-slate-700 dark:text-slate-200';
                            let checkClass = '';

                            if (showFeedback) {
                                if (isHighest) {
                                    borderClass = 'border-emerald-400 dark:border-emerald-600';
                                    bgClass = 'bg-emerald-50 dark:bg-emerald-950/40';
                                    labelClass = 'bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-600 dark:border-emerald-500';
                                    textClass = 'text-emerald-900 dark:text-emerald-200 font-medium';
                                    checkClass = 'bg-emerald-500 text-white';
                                } else if (isSelected) {
                                    borderClass = 'border-rose-400 dark:border-rose-700';
                                    bgClass = 'bg-rose-50 dark:bg-rose-950/40';
                                    labelClass = 'bg-rose-500 text-white border-rose-500 dark:bg-rose-600 dark:border-rose-500';
                                    textClass = 'text-rose-900 dark:text-rose-200 font-medium';
                                    checkClass = 'bg-rose-500 text-white';
                                } else {
                                    textClass = 'text-slate-400 dark:text-slate-500';
                                }
                            } else if (isSelected) {
                                borderClass = 'border-indigo-500 dark:border-indigo-400 ring-1 ring-indigo-500/30';
                                bgClass = 'bg-indigo-50 dark:bg-indigo-950/40';
                                labelClass = 'bg-indigo-500 text-white border-indigo-500';
                                textClass = 'text-indigo-800 dark:text-indigo-200 font-medium';
                                checkClass = 'bg-indigo-500 text-white';
                            }

                            return (
                                <label
                                    key={opt.id}
                                    data-cbt-option
                                    data-selected={isSelected}
                                    className={`cbt-option-item flex items-start gap-3 p-3 rounded-md border ${borderClass} ${bgClass} cursor-pointer transition-all duration-150 hover:shadow-sm`}
                                >
                                    <input type="radio" className="hidden" checked={isSelected} disabled={showFeedback} onChange={() => onAnswerChange(opt.id)} />
                                    <div
                                        data-cbt-badge
                                        data-selected={isSelected}
                                        className={`cbt-option-badge w-8 h-8 shrink-0 rounded flex items-center justify-center font-black text-xs leading-none pt-[1px] border-2 transition-colors ${labelClass}`}
                                    >
                                        {label}
                                    </div>
                                    <div className={`flex-1 min-w-0 text-sm font-normal transition-colors ${textClass}`}>
                                        <QuestionContent content={(opt.option_text || opt.text || '')} />
                                    </div>
                                    {/* Weight indicator */}
                                    {showFeedback && (
                                        <div className={`shrink-0 px-2 py-1 rounded text-[10px] font-bold border ${isHighest ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                                            {optWeight} pt
                                        </div>
                                    )}
                                    {isSelected && !showFeedback && (
                                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${checkClass}`}>
                                            <Check size={12} strokeWidth={3} />
                                        </motion.div>
                                    )}
                                    {showFeedback && isHighest && (
                                        <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${checkClass}`}>
                                            <Check size={12} strokeWidth={3} />
                                        </div>
                                    )}
                                    {showFeedback && isSelected && !isHighest && (
                                        <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-rose-500 text-white`}>
                                            <AlertTriangle size={12} strokeWidth={3} />
                                        </div>
                                    )}
                                </label>
                            );
                        });
                    })()}

                    {/* ── ORDERING & RANKING ── */}
                    {(type === 'ordering' || type === 'ranking') && (
                        <OrderingRenderer
                            questionId={question.id}
                            options={options}
                            answer={answer}
                            showFeedback={showFeedback}
                            onAnswerChange={onAnswerChange}
                        />
                    )}
                </div>
            )}
        </div>
        </>
    );
});

QuestionRenderer.displayName = 'QuestionRenderer';

/* ─── ShortAnswerInline: renders question with inline input blanks ─── */
interface ShortAnswerInlineProps {
    questionText: string;
    answer: AnswerValue;
    showFeedback: boolean;
    onAnswerChange: (answer: AnswerValue) => void;
    allVariations: string[][];
}

interface EssayInputProps {
    answer: AnswerValue;
    showFeedback: boolean;
    onAnswerChange: (answer: AnswerValue) => void;
    metadata: QuestionMetadata;
    options: QuestionOption[];
    examId?: string;
    userId?: string;
}

interface EssayAnswerPayload {
    text?: unknown;
    fileUrls?: unknown;
    videoUrl?: unknown;
    topicId?: unknown;
}

function readEssayAnswerPayload(value: unknown): { text: string; files: string[]; video: string; topic: string } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const payload = value as EssayAnswerPayload;
    const files = Array.isArray(payload.fileUrls)
        ? payload.fileUrls.filter((item): item is string => typeof item === 'string')
        : [];
    return {
        text: typeof payload.text === 'string' ? payload.text : '',
        files,
        video: typeof payload.videoUrl === 'string' ? payload.videoUrl : '',
        topic: typeof payload.topicId === 'string' ? payload.topicId : '',
    };
}

const EssayInput = React.memo(({ answer, showFeedback, onAnswerChange, metadata, options, examId, userId }: EssayInputProps) => {
    // Parse json answer if it exists
    const [localEssay, setLocalEssay] = useState('');
    const [fileUrls, setFileUrls] = useState<string[]>([]);
    const [videoUrl, setVideoUrl] = useState('');
    const [topicId, setTopicId] = useState('');
    const uniqueId = React.useId();

    // Topik multi-topik disimpan sebagai options soal. Kalau guru mengaktifkan
    // multi-topik tanpa mengisi topik, perlakukan sebagai esai biasa —
    // kalau tidak, soal tidak punya satu pun kolom jawaban.
    const topicOptions = React.useMemo(
        () => options.filter((option) => String(option.option_text || option.text || '').trim() !== ''),
        [options]
    );
    const isMultiTopic = !!metadata?.is_multi_topic && topicOptions.length > 0;

    // Publish each edit immediately so submit and local persistence see the last keystroke.
    // Teks terakhir yang kita kirim ke parent — dipakai untuk mengabaikan
    // echo prop `answer` agar ketikan yang lebih baru tidak tertimpa balik.
    const lastSentRef = useRef<string | null>(null);
    // Sumber kebenaran tunggal untuk seluruh bagian jawaban. Setiap handler
    // hanya menambal bagiannya sendiri (lihat commitAnswer) — dulu semua
    // handler mengirim empat nilai dari closure-nya, sehingga upload yang
    // selesai belakangan menimpa teks yang diketik selama upload berjalan.
    const latestRef = useRef<{ text: string; files: string[]; video: string; topic: string }>({ text: '', files: [], video: '', topic: '' });

    const parseCurrentAnswer = (ans: AnswerValue) => {
        let text = '';
        let files: string[] = [];
        let video = '';
        let topic = '';
        if (typeof ans === 'string') {
            try {
                const parsed: unknown = JSON.parse(ans);
                const payload = readEssayAnswerPayload(parsed);
                if (payload) {
                    ({ text, files, video, topic } = payload);
                } else {
                    text = ans;
                }
            } catch {
                text = ans;
            }
        } else if (ans && typeof ans === 'object') {
            const payload = readEssayAnswerPayload(ans);
            if (payload) ({ text, files, video, topic } = payload);
        }
        return { text, files, video, topic };
    };

    useEffect(() => {
        const { text, files, video, topic } = parseCurrentAnswer(answer);
        // Echo dari perubahan kita sendiri — jangan sinkronkan balik,
        // pengguna mungkin sudah mengetik lebih jauh sejak flush itu dikirim.
        if (lastSentRef.current !== null && text === lastSentRef.current) return;
        setLocalEssay(text);
        setFileUrls(files);
        setVideoUrl(video);
        setTopicId(topic);
        latestRef.current = { text, files, video, topic };
    }, [answer]);

    /**
     * Simpan jawaban. `patch` hanya berisi bagian yang berubah; sisanya diambil
     * dari latestRef sehingga handler yang berjalan async (upload file) tidak
     * pernah mengembalikan teks/video ke nilai lama.
     */
    const commitAnswer = (patch: Partial<{ text: string; files: string[]; video: string; topic: string }>) => {
        const merged = { ...latestRef.current, ...patch };
        latestRef.current = merged;
        lastSentRef.current = merged.text;
        // If metadata doesn't allow files/video, we don't save them
        const data = {
            text: merged.text,
            fileUrls: metadata?.allow_file_upload ? merged.files : [],
            videoUrl: metadata?.allow_video_link ? merged.video : '',
            topicId: metadata?.is_multi_topic ? merged.topic : ''
        };
        // Always store as JSON so grading knows it's an object if these features are used
        if (metadata?.allow_file_upload || metadata?.allow_video_link || metadata?.is_multi_topic) {
            onAnswerChange(JSON.stringify(data));
        } else {
            onAnswerChange(merged.text);
        }
    };
    const commitRef = useRef(commitAnswer);
    commitRef.current = commitAnswer;

    const publishEdit = (patch: Partial<{ text: string; video: string }>) => {
        commitRef.current(patch);
    };

    if (showFeedback) {
        return (
            <div className="space-y-4">
                {topicId && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs font-bold text-blue-800">Topik yang dipilih:</p>
                        <div className="mt-1 text-sm text-blue-900 font-medium">
                            <QuestionContent content={topicOptions.find((option) => option.id === topicId)?.option_text || ''} />
                        </div>
                    </div>
                )}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="text-sm text-slate-700 whitespace-pre-wrap">
                        {localEssay || <span className="text-slate-400 italic">Tidak ada jawaban teks.</span>}
                    </div>
                </div>
                {fileUrls.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-600">Lampiran File:</p>
                        <div className="flex flex-col gap-2">
                            {fileUrls.map((url, i) => (
                                <a key={i} href={safeExternalUrl(url) || undefined} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                                    📄 {attachmentLabel(url, i)}
                                </a>
                            ))}
                        </div>
                    </div>
                )}
                {videoUrl && (
                    <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-600">Link Video:</p>
                        {safeExternalUrl(videoUrl) ? (
                            <a href={safeExternalUrl(videoUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                                🎥 {videoUrl}
                            </a>
                        ) : (
                            <p className="text-xs text-slate-500 break-all">🎥 {videoUrl} <span className="text-rose-500">(tautan tidak valid)</span></p>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Soal multi-topik yang topiknya belum terisi tidak boleh menjadi
                jalan buntu: siswa diminta memilih topik padahal tidak ada yang
                bisa dipilih, sehingga textarea & unggahan ikut tersembunyi. */}
            {metadata?.is_multi_topic && topicOptions.length === 0 && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                        Daftar topik belum disiapkan untuk soal ini. Silakan langsung tulis jawaban Anda di bawah
                        dan laporkan ke pengawas.
                    </p>
                </div>
            )}

            {isMultiTopic && (
                <div className="space-y-3 mb-6 bg-slate-50 dark:bg-[#121826] p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Pilih Topik Tugas <span className="text-rose-500">*</span></p>
                    <div className="grid grid-cols-1 gap-3">
                        {topicOptions.map((opt, idx) => {
                            const isSelected = topicId === opt.id;
                            const label = String.fromCharCode(65 + idx);
                            
                            return (
                                <label
                                    key={opt.id}
                                    data-cbt-option
                                    data-selected={isSelected}
                                    className={`cbt-option-item flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all duration-150 ${isSelected ? 'border-primary bg-primary/5 dark:bg-primary/20 shadow-sm' : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#1a233a] hover:border-slate-300 dark:hover:border-slate-600'}`}
                                >
                                    <input 
                                        type="radio" 
                                        name={`topic-${uniqueId}`}
                                        className="hidden"
                                        checked={isSelected}
                                        onChange={() => {
                                            setTopicId(opt.id);
                                            commitAnswer({ topic: opt.id });
                                        }}
                                    />
                                    <div
                                        data-cbt-badge
                                        data-selected={isSelected}
                                        className={`cbt-option-badge w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold text-sm leading-none border-2 transition-colors ${isSelected ? 'bg-primary text-white border-primary' : 'bg-slate-100 dark:bg-[#24324f] text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600'}`}
                                    >
                                        {label}
                                    </div>
                                    <div className={`flex-1 min-w-0 text-sm font-medium pt-1 ${isSelected ? 'text-primary' : 'text-slate-700 dark:text-slate-200'}`}>
                                        <QuestionContent content={(opt.option_text || opt.text || '')} />
                                    </div>
                                    {isSelected && (
                                        <div className="shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center mt-1">
                                            <Check size={14} className="text-white" strokeWidth={3} />
                                        </div>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Jika multi topik aktif tapi belum pilih topik, jangan tampilkan editor */}
            {(!isMultiTopic || topicId) && (
                <>
                    <textarea
                        value={localEssay}
                        disabled={showFeedback}
                        onChange={(e) => {
                            const v = e.target.value;
                            setLocalEssay(v);
                            publishEdit({ text: v });
                        }}
                        onBlur={() => commitAnswer({ text: localEssay })}
                        placeholder="Ketik jawaban uraian di sini..."
                        className="w-full min-h-[180px] rounded-md border-2 border-slate-200 p-5 text-sm font-medium text-slate-700 outline-none transition-all placeholder:text-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 resize-none essay-answer-input"
                    />
                    
                    {metadata?.allow_file_upload && (
                        <div className="p-4 border border-slate-200 rounded-lg bg-white">
                            <p className="text-xs font-bold text-slate-600 mb-3">Lampiran File Pendukung</p>
                            {examId && userId ? (
                                <AssignmentUploader
                                    examId={examId}
                                    userId={userId}
                                    allowedFileTypes={['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']}
                                    maxFileSizeMb={10}
                                    maxFiles={3}
                                    initialUrls={fileUrls}
                                    onFilesChange={(urls) => {
                                        setFileUrls(urls);
                                        commitRef.current({ files: urls });
                                    }}
                                    disabled={showFeedback}
                                />
                            ) : (
                                // Dulu blok ini hilang tanpa jejak saat identitas peserta
                                // belum siap, sehingga siswa mengira guru tidak
                                // mengaktifkan unggah file.
                                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                    <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-700">
                                        Kolom unggah file belum siap (identitas peserta belum termuat). Muat ulang halaman lalu coba lagi.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {metadata?.allow_video_link && (
                        <div className="p-4 border border-slate-200 rounded-lg bg-white">
                            <p className="text-xs font-bold text-slate-600 mb-3">Link Video (Opsional)</p>
                            <input
                                type="url"
                                value={videoUrl}
                                // Langsung teruskan seperti textarea: jika hanya onBlur,
                                // link yang baru diketik hilang saat waktu ujian habis
                                // atau siswa ter-logout paksa (blur tidak pernah terjadi).
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setVideoUrl(v);
                                    publishEdit({ video: v });
                                }}
                                onBlur={() => commitAnswer({ video: videoUrl })}
                                placeholder="Contoh: https://youtube.com/watch?v=..."
                                className="w-full px-4 py-2.5 text-sm rounded-lg border-2 border-slate-200 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
                                disabled={showFeedback}
                            />
                            {videoUrl.trim() !== '' && !safeExternalUrl(videoUrl) && (
                                <p className="text-[11px] text-rose-500 mt-2">
                                    Tautan harus diawali http:// atau https:// agar bisa dibuka guru.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}

            <div className="bg-amber-50 border border-amber-100 p-3 rounded-md flex items-center gap-3 mt-4">
                <div className="w-7 h-7 shrink-0 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
                    <AlertTriangle size={14} />
                </div>
                <div>
                    <p className="text-xs font-semibold text-amber-700">Jawaban Uraian</p>
                    <p className="text-[11px] text-amber-500">Nilai diperiksa oleh guru.</p>
                </div>
            </div>
        </div>
    );
});
EssayInput.displayName = 'EssayInput';

const ShortAnswerInline = React.memo(({
    questionText,
    answer,
    showFeedback,
    onAnswerChange,
    allVariations,
}: ShortAnswerInlineProps) => {
    const blanksCount = (questionText.match(/\.{4,}/g) || []).length;
    const studentInputs = parseAnswer<string[]>(answer, new Array(Math.max(0, blanksCount)).fill(''));

    const [localInputs, setLocalInputs] = useState(studentInputs);
    // Publish text immediately, including the final keystroke before expiry.
    const lastSentRef = useRef<string | null>(null);
    const latestRef = useRef<{ inputs: string[] }>({ inputs: studentInputs });

    useEffect(() => {
        const parsed = parseAnswer<string[]>(answer, new Array(Math.max(0, blanksCount)).fill(''));
        if (lastSentRef.current !== null && JSON.stringify(parsed) === lastSentRef.current) return;
        setLocalInputs(parsed);
        latestRef.current = { inputs: parsed };
    }, [answer, blanksCount]);

    const pushAnswer = (inputs: string[]) => {
        const payload = JSON.stringify(inputs);
        lastSentRef.current = payload;
        latestRef.current = { inputs };
        onAnswerChange(payload);
    };
    const pushAnswerRef = useRef(pushAnswer);
    pushAnswerRef.current = pushAnswer;

    const handleChange = (idx: number, value: string) => {
        const next = [...latestRef.current.inputs];
        next[idx] = value;
        setLocalInputs(next);
        pushAnswerRef.current(next);
    };

    const handleBlur = () => {
        pushAnswer(latestRef.current.inputs);
    };

    let counter = 0;
    const protectedBlocks: string[] = [];
    let safeText = questionText.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{(?:equation|aligned|array|pmatrix|bmatrix|cases)\}[\s\S]*?\\end\{(?:equation|aligned|array|pmatrix|bmatrix|cases)\}|\\\(.*?\\\)|\[%.*?%\]|\$(?:[^$\n\\]|\\.)+\$|<[^>]+>)/g, (match) => {
        protectedBlocks.push(match);
        return `__PROTECTED_BLOCK_${protectedBlocks.length - 1}__`;
    });

    safeText = safeText.replace(/\.{4,}/g, () => {
        counter++;
        if (blanksCount <= 1) {
            return `<span class="tracking-[0.2em] text-slate-400 font-bold mx-1">.....</span>`;
        }
        return `<span class="inline-flex items-center mx-1"><span class="tracking-[0.2em] text-slate-400 font-bold">.....</span><span class="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-[#3083FF]/10 text-[#3083FF] text-[9px] font-black ml-1 shadow-sm">${counter}</span></span>`;
    });

    const replacedText = safeText.replace(/__PROTECTED_BLOCK_(\d+)__/g, (_, i) => protectedBlocks[parseInt(i)]);

    return (
        <div className="space-y-6">
            {/* Question Text with numeric placeholders */}
            <div className="text-base leading-relaxed text-slate-800">
                <QuestionContent content={replacedText} />
            </div>

            {/* Input Boxes Below */}
            {blanksCount > 0 && (
                <div className="space-y-3">
                    {Array.from({ length: blanksCount }).map((_, idx) => {
                        const variations = allVariations[idx] || [];
                        const inputValue = localInputs[idx] || '';
                        const normalizedInput = normalizeShortAnswer(inputValue);
                        const isCorrect = normalizedInput.length > 0 &&
                            variations.map((v: string) => normalizeShortAnswer(v)).includes(normalizedInput);

                        return (
                            <div key={idx} className="flex items-center gap-3">
                                <div className="w-8 h-8 shrink-0 rounded flex items-center justify-center font-black text-xs bg-white text-slate-600 border border-slate-200 shadow-sm leading-none pt-[1px]">
                                    {idx + 1}
                                </div>
                                <div className="flex-1 max-w-md relative">
                                    <input
                                        type="text"
                                        value={inputValue}
                                        disabled={showFeedback}
                                        onChange={(e) => handleChange(idx, e.target.value)}
                                        onBlur={handleBlur}
                                        placeholder="Ketik jawaban..."
                                        className={`w-full px-4 py-2.5 text-sm font-medium rounded-lg border-2 outline-none transition-all short-answer-input
                                            ${showFeedback
                                                ? (isCorrect ? 'border-[#3083FF] bg-blue-50/70 text-blue-900 pr-10' : 'border-rose-200 bg-rose-50/70 text-rose-800 pr-10')
                                                : 'border-slate-200 bg-white text-slate-700 focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
                                            }`}
                                    />
                                    {showFeedback && isCorrect && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3083FF]">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        </div>
                                    )}
                                    {showFeedback && !isCorrect && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                            </svg>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Show keys in feedback mode */}
            {showFeedback && (
                <div className="space-y-1 mt-2">
                    {allVariations.map((variations: string[], idx: number) => (
                        <p key={idx} className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded inline-block font-medium">
                            Kunci {idx + 1}: {variations.join(', ')}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
});
ShortAnswerInline.displayName = 'ShortAnswerInline';

/* ─── OrderingRenderer: student view for ordering questions ─── */
interface OrderingRendererProps {
  questionId: string;
  options: QuestionOption[];
  answer: AnswerValue;
  showFeedback: boolean;
  onAnswerChange: (answer: AnswerValue) => void;
}

const OrderingRenderer = React.memo(({
  options,
  answer,
  showFeedback,
  onAnswerChange,
}: OrderingRendererProps) => {
  const maxN = options.length;

  let studentAnswers: Record<string, string> = {};
  try {
      const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
      if (Array.isArray(parsed)) {
          parsed.forEach((optId, idx) => {
              studentAnswers[optId] = String(idx + 1);
          });
      } else if (typeof parsed === 'object' && parsed !== null) {
          studentAnswers = parsed;
      }
  } catch {
      // ignore parse error
  }

  // Build a map of value → list of option ids that use that value, to detect duplicates
  const valueCounts: Record<string, string[]> = {};
  Object.entries(studentAnswers).forEach(([optId, val]) => {
    if (val && val.trim() !== '') {
      const key = val.trim();
      if (!valueCounts[key]) valueCounts[key] = [];
      valueCounts[key].push(optId);
    }
  });

  // correctOrder is derived from the options' sorted order (teacher defines this)
  const correctOrder = options
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(o => o.id)
    .filter(Boolean);

  // Count how many options have been filled
  const filledCount = Object.values(studentAnswers).filter(v => v && v.trim() !== '').length;
  const hasDuplicates = Object.values(valueCounts).some(ids => ids.length > 1);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-[#1e293f] border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider font-bold">
              <th className="px-4 py-3 w-[80%]">Pernyataan</th>
              <th className="px-4 py-3 text-center w-[20%]">Urutan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {options.map((opt) => {
              const currentVal = studentAnswers[opt.id] || '';
              const correctIdx = correctOrder.indexOf(opt.id);
              const trimmedVal = currentVal.trim();

              // Check if this value is a duplicate
              const isDuplicate = trimmedVal !== '' && (valueCounts[trimmedVal]?.length ?? 0) > 1;

              // Check if value is out of range
              const numVal = Number(trimmedVal);
              const isOutOfRange = trimmedVal !== '' && (numVal < 1 || numVal > maxN || !Number.isInteger(numVal));

              let bgClass = 'bg-white hover:bg-slate-50/50 dark:bg-[#1a233a] dark:hover:bg-[#222f4b]';
              let inputBorder = 'border-slate-200 dark:border-slate-600 dark:bg-[#24324f] dark:text-white focus:border-primary focus:ring-2 focus:ring-primary/20';

              if (showFeedback) {
                const isCorrect = String(currentVal) === String(correctIdx + 1);
                bgClass = isCorrect ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-rose-50 dark:bg-rose-950/40';
                inputBorder = isCorrect ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/50' : 'border-rose-500 text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/50';
              } else if (isDuplicate) {
                bgClass = 'bg-amber-50/60 dark:bg-amber-950/30';
                inputBorder = 'border-amber-400 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/50 ring-2 ring-amber-200 dark:ring-amber-800';
              } else if (isOutOfRange) {
                bgClass = 'bg-rose-50/60 dark:bg-rose-950/30';
                inputBorder = 'border-rose-400 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/50 ring-2 ring-rose-200 dark:ring-rose-800';
              }

              return (
                <tr key={opt.id} className={`${bgClass} transition-colors`}>
                  <td className="px-4 py-3 align-middle">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200 [&_p]:!m-0">
                      <QuestionContent content={opt.option_text || opt.text || ''} />
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle text-center">
                    <div className="flex flex-col items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={maxN}
                        step={1}
                        value={currentVal}
                        disabled={showFeedback}
                        onKeyDown={(e) => {
                          // Block decimal point, minus, plus, 'e' (scientific notation)
                          if (['.', ',', '-', '+', 'e', 'E'].includes(e.key)) {
                            e.preventDefault();
                          }
                        }}
                        onChange={(e) => {
                          const raw = e.target.value;

                          // Allow empty (clearing the field)
                          if (raw === '') {
                            const next = { ...studentAnswers, [opt.id]: '' };
                            onAnswerChange(JSON.stringify(next));
                            return;
                          }

                          // Parse and validate: must be integer between 1 and maxN
                          const num = parseInt(raw, 10);
                          if (isNaN(num)) return; // reject non-numeric
                          if (num < 1 || num > maxN) return; // reject out of range

                          const next = { ...studentAnswers, [opt.id]: String(num) };
                          onAnswerChange(JSON.stringify(next));
                        }}
                        className={`w-16 mx-auto text-center font-bold text-slate-700 rounded-lg border-2 p-2 outline-none transition-all ${inputBorder}
                          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                        placeholder="-"
                      />
                      {!showFeedback && isDuplicate && (
                        <span className="text-[10px] text-amber-600 font-semibold flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                          Duplikat
                        </span>
                      )}
                      {showFeedback && (
                          <div className="mt-0.5 text-[10px] text-slate-500 font-medium">Seharusnya: <span className="font-bold text-slate-700">{correctIdx + 1}</span></div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Summary bar below the table */}
      {!showFeedback && (
        <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${
          hasDuplicates
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : filledCount === maxN
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-slate-50 border-slate-100 text-slate-500'
        }`}>
          <span className="font-medium">
            {hasDuplicates
              ? '⚠️ Ada nomor urutan yang duplikat, pastikan setiap urutan berbeda.'
              : filledCount === maxN
                ? '✅ Semua urutan sudah terisi.'
                : `Terisi ${filledCount} dari ${maxN} urutan. Isi angka 1 – ${maxN}.`
            }
          </span>
          <span className="font-bold tabular-nums">{filledCount}/{maxN}</span>
        </div>
      )}
    </div>
  );
});


OrderingRenderer.displayName = 'OrderingRenderer';
