"use client";
/**
 * ShortAnswerForm — Isian Singkat
 * Auto-detects blanks from question text (..... separators)
 * and renders one answer variation field per blank.
 */
import { Plus,Trash2 } from 'lucide-react';
import React,{ useEffect,useState } from 'react';

interface Blank {
  answer: string;
  variations: string[];
}

interface ShortAnswerFormProps {
  blanks: Blank[];
  questionText?: string; // to count number of blanks
  onAddBlank: () => void;
  onRemoveBlank: (index: number) => void;
  onUpdateBlank: (index: number, fields: Partial<Blank>) => void;
}

export const ShortAnswerForm = React.memo(({
  blanks,
  questionText = '',
  onAddBlank,
  onRemoveBlank,
  onUpdateBlank,
}: ShortAnswerFormProps) => {
  // Count how many ..... exist in question text
  const dotMatch = questionText.match(/\.{4,}/g);
  const blankCountInText = dotMatch ? dotMatch.length : 0;

  // Use ref to avoid stale closures in effect
  const blanksRef = React.useRef(blanks);
  const onAddBlankRef = React.useRef(onAddBlank);
  blanksRef.current = blanks;
  onAddBlankRef.current = onAddBlank;

  // Ensure we have enough blanks for the question text
  useEffect(() => {
    const needed = blankCountInText - blanksRef.current.length;
    if (needed > 0) {
      for (let i = 0; i < needed; i++) {
        onAddBlankRef.current();
      }
    }
  }, [blankCountInText]);

  const displayBlanks = blanks.slice(0, Math.max(blankCountInText, 1));

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 flex items-start gap-3">
        <div className="w-7 h-7 shrink-0 rounded-lg bg-blue-100 text-blue-500 flex items-center justify-center mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="text-xs text-blue-700">
          <p className="font-semibold">Gunakan <code className="px-1 py-0.5 bg-blue-100 rounded text-blue-800">....</code> di teks soal untuk menambah isian.</p>
          <p className="mt-1 text-blue-500">{blankCountInText === 0 ? 'Belum ada isian. Tambahkan .... di teks soal.' : `Ditemukan ${blankCountInText} isian di teks soal.`}</p>
        </div>
      </div>

      {displayBlanks.length === 0 ? (
        <div className="text-center py-6 text-sm text-slate-400">
          Tambahkan <code className="bg-slate-100 px-1 rounded">....</code> di teks soal untuk membuat isian.
        </div>
      ) : (
        displayBlanks.map((blank, idx) => (
          <ShortAnswerRow
            key={idx}
            index={idx + 1}
            answer={blank.answer}
            variations={blank.variations}
            onAnswerChange={(v) => onUpdateBlank(idx, { answer: v })}
            onVariationsChange={(v) => onUpdateBlank(idx, { variations: v })}
            onDelete={displayBlanks.length > 1 ? () => onRemoveBlank(idx) : undefined}
          />
        ))
      )}
    </div>
  );
});

ShortAnswerForm.displayName = 'ShortAnswerForm';

/* ─── ShortAnswerRow ─── */
interface ShortAnswerRowProps {
  index: number;
  answer: string;
  variations: string[];
  onAnswerChange: (v: string) => void;
  onVariationsChange: (v: string[]) => void;
  onDelete?: () => void;
}

const ShortAnswerRow = React.memo(({
  index,
  answer,
  variations,
  onAnswerChange,
  onVariationsChange,
  onDelete,
}: ShortAnswerRowProps) => {
  const [inputVal, setInputVal] = useState('');

  // Stable ref to track variations without causing re-renders on every keystroke
  const variationsRef = React.useRef(variations);
  variationsRef.current = variations;

  // Auto-add main answer to variations only on blur (not on every keystroke)
  const handleAnswerBlur = () => {
    const trimmed = answer.trim();
    const current = variationsRef.current;
    if (trimmed && !current.includes(trimmed)) {
      onVariationsChange([trimmed, ...current.filter(x => x !== trimmed)]);
    }
  };

  const handleAdd = () => {
    const trimmed = inputVal.trim();
    if (trimmed && !variations.includes(trimmed)) {
      onVariationsChange([...variations, trimmed]);
    }
    setInputVal('');
  };

  return (
    <div className="group relative flex items-stretch rounded-lg border-2 border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all overflow-hidden">
      {/* Left accent */}
      <div className="w-1 shrink-0 bg-transparent transition-colors group-hover:bg-cyan-400" />
      <div className="shrink-0 flex items-center justify-center w-10 h-10 m-2 rounded-lg text-sm font-black bg-slate-100 text-slate-500 group-hover:bg-cyan-100 group-hover:text-cyan-600 transition-all">
        {index}
      </div>

      <div className="flex-1 min-w-0 space-y-3 pr-4 py-3">
        {/* Main answer */}
        <div className="relative">
          <input
            type="text"
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            onBlur={handleAnswerBlur}
            placeholder={`Jawaban ${index}...`}
            className="w-full text-sm text-slate-700 bg-transparent outline-none placeholder:text-slate-300 py-2 px-3 rounded-lg border border-slate-100 focus:border-slate-400 focus:bg-white focus:shadow-sm transition-all"
          />
        </div>

        {/* Variation chips */}
        {variations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {variations.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded-full border border-blue-200 font-medium"
              >
                {v}
                <button
                  type="button"
                  onClick={() => onVariationsChange(variations.filter((x) => x !== v))}
                  className="hover:text-blue-800 ml-0.5 font-bold"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Add variation */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="Tambah variasi jawaban lain (opsional)..."
            className="flex-1 text-xs text-slate-500 bg-transparent outline-none placeholder:text-slate-300 py-1.5 px-2 rounded-lg border border-transparent focus:border-slate-300 focus:bg-white transition-all"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!inputVal.trim()}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 mr-3 flex items-center justify-center w-8 h-8 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
});

ShortAnswerRow.displayName = 'ShortAnswerRow';
