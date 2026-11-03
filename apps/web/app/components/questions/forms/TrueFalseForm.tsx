"use client";
/**
 * TrueFalseForm — pernyataan Benar / Salah dengan label jawaban yang bisa dipilih guru
 */
import {
DEFAULT_TRUE_FALSE_LABELS,
isRtlLabel,
TRUE_FALSE_LABEL_MAX_LENGTH,
TRUE_FALSE_LABEL_PRESETS,
trueFalseLabelPreset,
type TrueFalseLabels,
} from '@acca-cbt/shared';
import { Plus,Trash2 } from 'lucide-react';
import React,{ useState } from 'react';
import { BaseOption } from '../schema';
import { OptionList } from './AnswerOptionCard';
import { OptionRichInput } from './OptionRichInput';
interface TrueFalseFormProps {
  options: BaseOption[];
  onAddOption: () => void;
  onBulkAdd?: (texts: string[]) => void;
  onInsertOption: (index: number) => void;
  onRemoveOption: (index: number) => void;
  onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
  maxStatements?: number;
  /** Label tersimpan (mentah, bisa belum lengkap saat diketik). null = Benar/Salah. */
  labels?: Partial<TrueFalseLabels> | null;
  onLabelsChange?: (labels: TrueFalseLabels | null) => void;
}

/** Singkatan tombol kunci: huruf pertama tiap label, atau label penuh bila hurufnya sama. */
function keyButtonText(labels: TrueFalseLabels): TrueFalseLabels {
  const first = (text: string) => Array.from(text.trim())[0]?.toLocaleUpperCase() || '';
  const t = first(labels.true);
  const f = first(labels.false);
  return t && f && t !== f ? { true: t, false: f } : labels;
}

const TrueFalseLabelPicker = ({ labels, onChange }: {
  labels: Partial<TrueFalseLabels> | null | undefined;
  onChange: (labels: TrueFalseLabels | null) => void;
}) => {
  const current = { true: labels?.true ?? DEFAULT_TRUE_FALSE_LABELS.true, false: labels?.false ?? DEFAULT_TRUE_FALSE_LABELS.false };
  const preset = labels ? trueFalseLabelPreset(current) : 'id';
  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-800 focus:outline-none';
  return (
    <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3" data-true-false-labels>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Label jawaban</div>
      <div className="flex flex-wrap gap-1.5">
        {TRUE_FALSE_LABEL_PRESETS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id === 'id' ? null : { ...item.labels })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${preset === item.id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}
            title={item.name}
          >
            <span dir={isRtlLabel(item.labels.true) ? 'rtl' : undefined}>{item.labels.true} / {item.labels.false}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => { if (preset !== 'custom') onChange({ true: '', false: '' }); }}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${preset === 'custom' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}
        >
          Input
        </button>
      </div>
      {preset === 'custom' && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-500">
            Label untuk pernyataan benar
            <input
              className={inputClass}
              value={labels?.true ?? ''}
              maxLength={TRUE_FALSE_LABEL_MAX_LENGTH}
              dir="auto"
              placeholder="mis. Betul"
              onChange={event => onChange({ true: event.target.value, false: labels?.false ?? '' })}
            />
          </label>
          <label className="text-[11px] text-slate-500">
            Label untuk pernyataan salah
            <input
              className={inputClass}
              value={labels?.false ?? ''}
              maxLength={TRUE_FALSE_LABEL_MAX_LENGTH}
              dir="auto"
              placeholder="mis. Keliru"
              onChange={event => onChange({ true: labels?.true ?? '', false: event.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
};

export const TrueFalseForm = React.memo(({
  options,
  onAddOption,
  onBulkAdd,
  onInsertOption,
  onRemoveOption,
  onUpdateOption,
  maxStatements,
  labels,
  onLabelsChange,
}: TrueFalseFormProps) => {
  const shownLabels = {
    true: labels?.true?.trim() || DEFAULT_TRUE_FALSE_LABELS.true,
    false: labels?.false?.trim() || DEFAULT_TRUE_FALSE_LABELS.false,
  };
  const keyText = keyButtonText(shownLabels);
  return (
    <>
    {onLabelsChange && <TrueFalseLabelPicker labels={labels} onChange={onLabelsChange} />}
    <OptionList
      onAdd={options.length < (maxStatements ?? Infinity) ? onAddOption : undefined}
      onBulkAdd={onBulkAdd}
      addLabel="Tambah Pernyataan"
      maxItems={maxStatements}
    >
      {options.map((opt, idx) => (
        <React.Fragment key={opt.id || idx}>
          {/* Insert between button */}
          {idx > 0 && (
            <div className="relative h-2 group/insert">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-opacity z-10">
                <button
                  type="button"
                  onClick={() => onInsertOption(idx)}
                  className="bg-white border-2 border-slate-200 text-slate-400 hover:text-primary hover:border-primary w-6 h-6 rounded-full flex items-center justify-center shadow-sm transition-all"
                  title="Sisipkan Pernyataan di sini"
                >
                  <Plus size={12} strokeWidth={3} />
                </button>
              </div>
              <div className="absolute inset-x-4 top-1/2 border-t border-dashed border-slate-100 opacity-0 group-hover/insert:opacity-100 transition-opacity" />
            </div>
          )}
          <TrueFalseRow
            index={idx + 1}
            value={opt.text}
            isCorrect={opt.isCorrect}
            onChange={(text) => onUpdateOption(idx, { text })}
            onSetCorrect={(v) => onUpdateOption(idx, { isCorrect: v })}
            onDelete={options.length > 2 ? () => onRemoveOption(idx) : undefined}
            labels={shownLabels}
            keyText={keyText}
          />
        </React.Fragment>
      ))}
    </OptionList>
    </>
  );
});

TrueFalseForm.displayName = 'TrueFalseForm';

/* ─── TrueFalseRow ─── */
interface TrueFalseRowProps {
  index: number;
  value: string;
  isCorrect?: boolean;
  onChange: (text: string) => void;
  onSetCorrect: (value: boolean) => void;
  onDelete?: () => void;
  labels: TrueFalseLabels;
  keyText: TrueFalseLabels;
}

const TrueFalseRow = React.memo(({ index, value, isCorrect, onChange, onSetCorrect, onDelete, labels, keyText }: TrueFalseRowProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const isBenar = isCorrect === true;
  const isSalah = isCorrect === false;

  return (
    <div className="group relative flex items-center gap-2">
      {/* Number Badge */}
      <div className={`
        shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-[11px] font-black select-none transition-all duration-200
        ${isBenar ? 'bg-[#3083FF] text-white' : isSalah ? 'bg-rose-500 text-white' : isFocused ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}
      `}>
        {index}.
      </div>

      {/* Input Card */}
      <div className={`
        flex-1 flex items-center rounded-lg border-2 transition-all duration-200
        ${isFocused
            ? 'border-slate-800 bg-white shadow-sm'
            : isBenar ? 'border-blue-300 bg-blue-50/50'
            : isSalah ? 'border-rose-300 bg-rose-50/50'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }
      `}>
        {/* Left accent */}
        <div className={`
            w-1 h-full shrink-0 rounded-l transition-all duration-200
            ${isBenar ? 'bg-[#3083FF]' : isSalah ? 'bg-rose-500' : isFocused ? 'bg-slate-800' : 'bg-transparent'}
        `} />

        {/* Text Input */}
        <div className="flex-1 min-w-0">
          <OptionRichInput
            value={value}
            onChange={onChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={`Pernyataan ${index}...`}
          />
        </div>

        {/* BENAR */}
        <button type="button" onClick={() => onSetCorrect(true)} title={`Kunci: ${labels.true}`}
          className={`shrink-0 mr-1 flex items-center justify-center min-w-7 px-1 h-7 rounded text-[10px] font-black uppercase transition-all duration-200 ${isBenar ? 'bg-[#3083FF] text-white' : 'border border-slate-200 text-slate-300 bg-white hover:border-blue-400 hover:text-blue-500 group-hover:text-blue-400'}`}>
          <span dir={isRtlLabel(keyText.true) ? 'rtl' : undefined}>{keyText.true}</span>
        </button>

        {/* SALAH */}
        <button type="button" onClick={() => onSetCorrect(false)} title={`Kunci: ${labels.false}`}
          className={`shrink-0 mr-1 flex items-center justify-center min-w-7 px-1 h-7 rounded text-[10px] font-black uppercase transition-all duration-200 ${isSalah ? 'bg-rose-500 text-white' : 'border border-slate-200 text-slate-300 bg-white hover:border-rose-400 hover:text-rose-500 group-hover:text-rose-400'}`}>
          <span dir={isRtlLabel(keyText.false) ? 'rtl' : undefined}>{keyText.false}</span>
        </button>

        {/* Delete */}
        {onDelete && (
          <button type="button" onClick={onDelete}
            title="Hapus pernyataan" aria-label="Hapus pernyataan"
            className="shrink-0 mr-1.5 flex items-center justify-center w-6 h-6 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors duration-200">
            <Trash2 size={12} />
          </button>
        )}
      </div>


    </div>
  );
});

TrueFalseRow.displayName = 'TrueFalseRow';
