import { useClientMounted } from '@/hooks/useClientMounted';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { QuestionOption } from '@/app/types';
import { motion } from "framer-motion";
import { CheckCircle2,Sparkles,Trash2 } from "lucide-react";
import { useMemo,useState } from "react";
import Xarrow,{ Xwrapper } from "react-xarrows";
import { LatexRenderer } from "./LatexRenderer";

// Deterministic seeded shuffle so the order is randomized ONCE per participant
// (stable across re-renders / re-mounts / question navigation) instead of on every render.
const hashSeed = (str: string): number => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^= h >>> 16) >>> 0;
};

const mulberry32 = (seed: number) => {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const seededShuffle = <T,>(arr: T[], seed: number): T[] => {
  const rng = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

interface InteractiveMatchingProps {
  questionId: string;
  userId?: string | null;
  options: QuestionOption[];
  rightItems: string[];
  answers: Record<string, string[]>;
  onAnswerChange: (leftId: string, rightText: string) => void;
  selectedLeft: string | null;
  onSelectLeft: (leftId: string | null) => void;
  showFeedback?: boolean;
}

export const InteractiveMatching = ({
  questionId,
  userId,
  options,
  rightItems,
  answers,
  onAnswerChange,
  selectedLeft,
  onSelectLeft,
  showFeedback = false,
}: InteractiveMatchingProps) => {
  const cleanHtml = (html: string) => {
    if (!html) return "";
    return html
      .replace(/^(?:<p>\s*(?:<br\s*\/?>|&nbsp;)\s*<\/p>\s*)+/, '')
      .replace(/(?:<p>\s*(?:<br\s*\/?>|&nbsp;)\s*<\/p>\s*)+$/, '');
  };
  const stripHtml = (html: string) => (html ? html.replace(/<[^>]*>/g, "").trim() : "");

  const mounted = useClientMounted();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const [mobileSelectOptId, setMobileSelectOptId] = useState<string | null>(null);

  // Seed diacak SEKALI per peserta per soal — stabil di seluruh re-render, re-mount,
  // dan perpindahan soal. Berbeda antar peserta karena userId ikut di-hash.
  const seed = useMemo(
    () => hashSeed(`${questionId ?? ''}::${userId ?? ''}`),
    [questionId, userId]
  );
  const shuffledOptions = useMemo(
    () => seededShuffle(options || [], seed),
    [options, seed]
  );
  const shuffledRightItems = useMemo(
    () => seededShuffle(rightItems || [], seed ^ 0x9e3779b9),
    [rightItems, seed]
  );

  const leftDomId = (i: number) => `mtch-l-${questionId}-${i}`;
  const rightDomId = (i: number) => `mtch-r-${questionId}-${i}`;

  const connections: [number, number][] = [];
  Object.entries(answers || {}).forEach(([optId, rights]) => {
    const li = shuffledOptions.findIndex((option) => option.id === optId);
    if (li < 0 || !Array.isArray(rights)) return;
    rights.forEach((rt: string) => {
      const ri = shuffledRightItems.indexOf(rt);
      if (ri >= 0) connections.push([li, ri]);
    });
  });

  return (
    <Xwrapper>
      <div className="relative">
        {/* ── Mobile Layout: Stacked with Custom Inline Dropdown ── */}
        <div className="block sm:hidden space-y-4">
          {shuffledOptions.map((opt, optIdx) => {
            const matchedItem = answers?.[opt.id]?.[0];
            const isSelecting = mobileSelectOptId === opt.id;

            return (
              <div key={opt.id} className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 space-y-3 text-left">
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 shrink-0 rounded bg-slate-800 flex items-center justify-center text-white font-black text-[10px] leading-none mt-0.5 font-sans">
                    {optIdx + 1}
                  </span>
                  <div className="font-semibold text-slate-800 text-xs sm:text-sm [&_p]:!m-0 flex-1 min-w-0">
                    <LatexRenderer text={cleanHtml(opt.option_text)} />
                  </div>
                </div>

                {matchedItem ? (
                  <div className="space-y-2 pl-7">
                    <div className="flex items-center gap-1.5 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">
                      <CheckCircle2 size={12} /> Terhubung Dengan:
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-white border border-emerald-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-emerald-800">
                        <LatexRenderer text={cleanHtml(matchedItem)} />
                      </div>
                      {!showFeedback && (
                        <button
                          onClick={() => onAnswerChange(opt.id, matchedItem)}
                          className="w-9 h-9 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-xl flex items-center justify-center text-rose-600 shrink-0 transition-all active:scale-95"
                          title="Hapus Hubungan"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="pl-7 space-y-2">
                    {isSelecting ? (
                      <div className="space-y-2 bg-white border border-indigo-100/80 rounded-xl p-3 shadow-inner">
                        <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider font-sans">Pilih Pasangan:</p>
                        <div className="grid grid-cols-1 gap-2">
                          {shuffledRightItems.map((item: string, rIdx: number) => {
                            const isLinkedToOther = Object.entries(answers || {}).some(
                              ([leftId, rights]) => leftId !== opt.id && Array.isArray(rights) && rights.includes(item)
                            );

                            return (
                              <button
                                key={rIdx}
                                disabled={isLinkedToOther}
                                onClick={() => {
                                  onAnswerChange(opt.id, item);
                                  setMobileSelectOptId(null);
                                }}
                                className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                                  isLinkedToOther
                                    ? 'border-slate-100 bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed'
                                    : 'border-slate-200 bg-white hover:border-[#3083FF] hover:bg-blue-50/30 text-slate-700'
                                }`}
                              >
                                <LatexRenderer text={cleanHtml(item)} />
                              </button>
                            );
                          })}
                          <button
                            onClick={() => setMobileSelectOptId(null)}
                            className="w-full text-center py-2 text-xs font-bold text-slate-400 hover:text-slate-650"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      !showFeedback && (
                        <button
                          onClick={() => setMobileSelectOptId(opt.id)}
                          className="w-full flex items-center justify-center gap-1.5 border border-dashed border-indigo-200 bg-indigo-50/20 text-[#3083FF] hover:bg-indigo-50/40 px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                        >
                          <Sparkles size={13} /> Hubungkan Jawaban
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Desktop Layout: Side-by-Side with SVG Arrows ── */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-[1fr_32px_1fr] sm:grid-cols-[1fr_56px_1fr] gap-0">
            {/* LEFT */}
            <div className="space-y-3">
              {shuffledOptions.map((opt, i) => {
                const isSelected = selectedLeft === opt.id;
                const isConnected = answers?.[opt.id]?.length > 0;

                return (
                  <div key={opt.id} className="flex items-center gap-2">
                    <button
                      disabled={showFeedback}
                      onClick={() => onSelectLeft(isSelected ? null : opt.id)}
                      className={`
                        flex-1 min-h-[40px] sm:min-h-[48px] flex items-center px-3 py-2.5 sm:px-4 sm:py-3 rounded-lg border-2 text-left text-[11px] sm:text-sm
                        font-medium transition-all duration-200 leading-snug
                        ${isSelected
                          ? "border-amber-400 bg-amber-50 shadow-md shadow-amber-100"
                          : showFeedback && isConnected
                            ? (() => {
                                const correctMatchTexts = opt?.metadata?.match_texts || (opt?.metadata?.match_text ? [opt.metadata.match_text] : []);
                                const allCorrect = answers[opt.id].every((ans: string) => correctMatchTexts.includes(ans));
                                return allCorrect ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-rose-400 bg-rose-50 text-rose-800";
                              })()
                            : isConnected
                              ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200"
                              : "border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#1a233a] hover:border-indigo-300 dark:hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/30 text-slate-700 dark:text-slate-200"
                        }
                      `}
                      style={{ wordBreak: 'normal' }}
                    >
                      <div className="w-full [&_p]:!m-0" style={{ wordBreak: 'normal' }}>
                        <LatexRenderer text={cleanHtml(opt.option_text)} />
                      </div>
                    </button>

                    {/* Connector dot */}
                    <div
                      id={leftDomId(i)}
                      className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 transition-all duration-200 shrink-0 ${
                        isConnected
                          ? "bg-amber-400 border-amber-400 shadow-sm shadow-amber-200"
                          : isSelected
                            ? "bg-amber-300 border-amber-400 animate-pulse"
                            : "bg-white dark:bg-[#24324f] border-slate-300 dark:border-slate-600"
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            {/* CENTER SPACER */}
            <div />

            {/* RIGHT */}
            <div className="space-y-3">
              {shuffledRightItems.map((item: string, i: number) => {
                const isLinked = Object.values(answers || {}).some(
                  (rights) => Array.isArray(rights) && rights.includes(item)
                );
                const plain = stripHtml(item);
                const displayText = plain || item;

                return (
                  <div key={`right-${i}-${item}`} className="flex items-center gap-2">
                    {/* Connector dot */}
                    <div
                      id={rightDomId(i)}
                      onClick={() => !showFeedback && selectedLeft && onAnswerChange(selectedLeft, item)}
                      className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 transition-all duration-200 shrink-0 cursor-pointer ${
                        isLinked
                          ? "bg-amber-400 border-amber-400 shadow-sm shadow-amber-200"
                          : selectedLeft
                            ? "bg-indigo-200 border-indigo-400 animate-pulse"
                            : "bg-white dark:bg-[#24324f] border-slate-300 dark:border-slate-600"
                      }`}
                    />

                    <button
                      disabled={showFeedback}
                      onClick={() => selectedLeft && onAnswerChange(selectedLeft, item)}
                      className={`
                        flex-1 min-h-[40px] sm:min-h-[48px] flex items-center px-3 py-2.5 sm:px-4 sm:py-3 rounded-lg border-2 text-left text-[11px] sm:text-sm
                        font-medium transition-all duration-200 leading-snug
                        ${isLinked
                          ? "border-emerald-300 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-200"
                          : selectedLeft
                            ? "border-indigo-200 dark:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-indigo-400 hover:bg-indigo-50 text-slate-700 dark:text-slate-200"
                            : "border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#1a233a] text-slate-700 dark:text-slate-200"
                        }
                      `}
                      style={{ wordBreak: 'normal' }}
                    >
                      <div className="w-full [&_p]:!m-0" style={{ wordBreak: 'normal' }}>
                        <LatexRenderer text={cleanHtml(item) || displayText} />
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Connector arrows */}
          {mounted && !isMobile && (() => {
            return connections.map(([li, ri], k) => {
              const opt = shuffledOptions[li];
              const rightText = shuffledRightItems[ri];
              
              let lineColor = "#94a3b8";
              let strokeWidth = 2.5;
              let zIndex = 5;

              if (showFeedback) {
                const correctMatchTexts = opt?.metadata?.match_texts || (opt?.metadata?.match_text ? [opt.metadata.match_text] : []);
                const isCorrectMatch = correctMatchTexts.includes(rightText);
                lineColor = isCorrectMatch ? "#3083FF" : "#f87171"; // Biru for correct match, soft red for wrong
                strokeWidth = 3;
                zIndex = isCorrectMatch ? 10 : 5;
              }

              return (
                <Xarrow
                  key={`mtch-arrow-${li}-${ri}-${k}`}
                  start={leftDomId(li)}
                  end={rightDomId(ri)}
                  startAnchor="right"
                  endAnchor={{ position: "left", offset: { x: -4 } }}
                  path="smooth"
                  curveness={0.3}
                  color={lineColor}
                  strokeWidth={strokeWidth}
                  showHead
                  headSize={4}
                  zIndex={zIndex}
                  animateDrawing={0.25}
                />
              );
            });
          })()}

          {/* Helper text */}
          {selectedLeft && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 text-center text-xs text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-lg py-2 px-4"
            >
              Klik item di kolom kanan untuk menghubungkan
            </motion.div>
          )}
        </div>
      </div>
    </Xwrapper>
  );
};
