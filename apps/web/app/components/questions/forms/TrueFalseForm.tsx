"use client";
/**
 * TrueFalseForm — Benar / Salah statements
 */
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
}

export const TrueFalseForm = React.memo(({
  options,
  onAddOption,
  onBulkAdd,
  onInsertOption,
  onRemoveOption,
  onUpdateOption,
  maxStatements,
}: TrueFalseFormProps) => {
  return (
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
          />
        </React.Fragment>
      ))}
    </OptionList>
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
}

const TrueFalseRow = React.memo(({ index, value, isCorrect, onChange, onSetCorrect, onDelete }: TrueFalseRowProps) => {
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
        <button type="button" onClick={() => onSetCorrect(true)}
          className={`shrink-0 mr-1 flex items-center justify-center w-7 h-7 rounded text-[10px] font-black uppercase transition-all duration-200 ${isBenar ? 'bg-[#3083FF] text-white' : 'border border-slate-200 text-transparent group-hover:border-blue-400 group-hover:text-blue-500 bg-white'}`}>
          B
        </button>

        {/* SALAH */}
        <button type="button" onClick={() => onSetCorrect(false)}
          className={`shrink-0 mr-1 flex items-center justify-center w-7 h-7 rounded text-[10px] font-black uppercase transition-all duration-200 ${isSalah ? 'bg-rose-500 text-white' : 'border border-slate-200 text-transparent group-hover:border-rose-400 group-hover:text-rose-500 bg-white'}`}>
          S
        </button>

        {/* Delete */}
        {onDelete && (
          <button type="button" onClick={onDelete}
            className="shrink-0 mr-2 flex items-center justify-center w-6 h-6 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all duration-200 opacity-0 group-hover:opacity-100">
            <Trash2 size={12} />
          </button>
        )}
      </div>


    </div>
  );
});

TrueFalseRow.displayName = 'TrueFalseRow';
