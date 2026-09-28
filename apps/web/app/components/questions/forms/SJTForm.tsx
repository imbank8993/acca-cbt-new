"use client";
/**
 * SJTForm — Situational Judgment Test
 * Pilihan ganda di mana setiap opsi memiliki bobot poin.
 * Mirip MCQForm tapi tiap opsi punya weight input.
 */
import { Plus } from 'lucide-react';
import React,{ useCallback } from 'react';
import { BaseOption } from '../schema';
import { AnswerOptionCard,OptionList } from './AnswerOptionCard';

interface SJTFormProps {
  options: BaseOption[];
  onAddOption: () => void;
  onBulkAdd?: (texts: string[]) => void;
  onInsertOption: (index: number) => void;
  onRemoveOption: (index: number) => void;
  onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
  onSetOptionWeight: (index: number, weight: number) => void;
  maxOptions?: number;
}


// ── Per-option card with weight input ──────────────────────────────────────

interface OptionCardSJTProps {
  opt: BaseOption;
  idx: number;
  canDelete: boolean;
  letters: string[];
  onInsertOption: (index: number) => void;
  onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
  onRemoveOption: (idx: number) => void;
  onSetWeight: (idx: number, weight: number) => void;
}

const OptionCardSJT = React.memo(({
  opt, idx, canDelete, letters,
  onInsertOption, onUpdateOption, onRemoveOption, onSetWeight,
}: OptionCardSJTProps) => {
  const stableOnChange = useCallback(
    (text: string) => onUpdateOption(idx, { text }),
    [idx, onUpdateOption]
  );
  const stableOnDelete = useCallback(
    () => onRemoveOption(idx),
    [idx, onRemoveOption]
  );

  const weight = opt.weight ?? 0;
  return (
    <React.Fragment key={opt.id || idx}>
      {idx > 0 && (
        <div className="relative h-2 group/insert">
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-opacity z-10">
            <button
              type="button"
              onClick={() => onInsertOption(idx)}
              className="bg-white border-2 border-slate-200 text-slate-400 hover:text-primary hover:border-primary w-6 h-6 rounded-full flex items-center justify-center shadow-sm transition-all"
              title="Sisipkan Opsi di sini"
            >
              <Plus size={12} strokeWidth={3} />
            </button>
          </div>
          <div className="absolute inset-x-4 top-1/2 border-t border-dashed border-slate-100 opacity-0 group-hover/insert:opacity-100 transition-opacity" />
        </div>
      )}

      <div className="group relative mb-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Option text input - takes most space */}
          <div className="flex-1 min-w-0">
            <AnswerOptionCard
              label={letters[idx] || `${idx + 1}`}
              value={opt.text}
              isCorrect={false}
              hideCorrectToggle={true}
              isMultiSelect={false}
              onChange={stableOnChange}
              onDelete={stableOnDelete}
              canDelete={canDelete}
              placeholder={`Opsi ${letters[idx] || idx + 1}...`}
              hideRichTools={true}
              className="!mb-0" // override default AnswerOptionCard margin if any
            />
          </div>

          {/* Score input - on the right */}
          <div className="shrink-0 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 ml-10 sm:ml-0">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Skor:
            </label>
            <input
              type="number"
              value={weight === 0 && opt.weight === undefined ? '' : weight}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : Number(e.target.value);
                onSetWeight(idx, val);
              }}
              className="w-16 px-2 py-1 text-sm bg-white border border-slate-200 rounded outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all font-semibold text-indigo-700 text-center"
              placeholder="0"
            />
          </div>
        </div>
      </div>
    </React.Fragment>
  );
});

OptionCardSJT.displayName = 'OptionCardSJT';

// ── Main SJTForm ────────────────────────────────────────────────────────────────

export const SJTForm = React.memo(({
  options,
  onAddOption,
  onBulkAdd,
  onInsertOption,
  onRemoveOption,
  onUpdateOption,
  onSetOptionWeight,
  maxOptions = 26,
}: SJTFormProps) => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const canDelete = options.length > 2;

  return (
    <div className="space-y-1">
      <OptionList
        onAdd={options.length < maxOptions ? onAddOption : undefined}
        onBulkAdd={options.length < maxOptions ? onBulkAdd : undefined}
        addLabel="Tambah Opsi (Bawah)"
        maxItems={maxOptions}
      >
        {options.map((opt, idx) => (
          <OptionCardSJT
            key={opt.id || idx}
            opt={opt}
            idx={idx}
            canDelete={canDelete}
            letters={letters}
            onInsertOption={onInsertOption}
            onUpdateOption={onUpdateOption}
            onRemoveOption={onRemoveOption}
            onSetWeight={onSetOptionWeight}
          />
        ))}
      </OptionList>
    </div>
  );
});

SJTForm.displayName = 'SJTForm';