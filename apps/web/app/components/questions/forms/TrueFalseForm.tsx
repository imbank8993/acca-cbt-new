"use client";
/**
 * TrueFalseForm — Benar / Salah statements
 */
import { Plus,Trash2 } from 'lucide-react';
import React,{ useRef,useState } from 'react';
import { BaseOption } from '../schema';
import { EquationDialog,OptionList,TableDialog } from './AnswerOptionCard';
import { RichInput } from './RichInput';
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
  const [showEquation, setShowEquation] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isBenar = isCorrect === true;
  const isSalah = isCorrect === false;

  const insertAtCursor = (text: string) => {
    const ta = inputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newValue = value.slice(0, start) + text + value.slice(end);
    onChange(newValue);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    }, 0);
  };

  const handleInsertEquation = (latex: string) => {
    insertAtCursor(`$${latex}$`);
  };

  const handleInsertTable = (rows: number, cols: number) => {
    let table = '\n';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        table += (c > 0 ? '\t' : '') + `Cell ${r + 1},${c + 1}`;
      }
      table += '\n';
    }
    insertAtCursor(table);
  };

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
          <RichInput
            inputRef={inputRef}
            value={value}
            onChange={onChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={`Pernyataan ${index}...`}
          />
        </div>

        {/* Toolbar */}
        <div className="shrink-0 px-2 py-2 flex items-center gap-1">
          {/* Equation */}
          <button type="button"
              onClick={(e) => { e.stopPropagation(); setShowEquation(true); }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Sisipkan Rumus">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
              </svg>
          </button>

          {/* Table */}
          <button type="button"
              onClick={(e) => { e.stopPropagation(); setShowTable(true); }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Sisipkan Tabel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
          </button>
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

      {/* Dialogs */}
      <EquationDialog
        isOpen={showEquation}
        onClose={() => setShowEquation(false)}
        onInsert={handleInsertEquation}
      />
      <TableDialog
        isOpen={showTable}
        onClose={() => setShowTable(false)}
        onInsert={handleInsertTable}
      />
    </div>
  );
});

TrueFalseRow.displayName = 'TrueFalseRow';
