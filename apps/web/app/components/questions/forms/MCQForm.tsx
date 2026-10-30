"use client";
/**
 * MCQForm — Pilihan Ganda (single correct) & PG Kompleks (multiple correct)
 * Uses AnswerOptionCard with floating inline toolbar per card.
 */
import { Plus } from 'lucide-react';
import React,{ useCallback } from 'react';
import { BaseOption } from '../schema';
import { AnswerOptionCard,OptionList } from './AnswerOptionCard';

interface MCQFormProps {
  options: BaseOption[];
  isComplex: boolean;
  onAddOption: () => void;
  onBulkAdd?: (texts: string[]) => void;
  onInsertOption: (index: number) => void;
  onRemoveOption: (index: number) => void;
  onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
  onSetAllCorrect: (index: number) => void;
  onToggleCorrect: (index: number) => void;
  maxOptions?: number;
}

// ── Per-option card with stable callbacks ──────────────────────────────────────
interface OptionCardProps {
  opt: BaseOption;
  idx: number;
  isComplex: boolean;
  canDelete: boolean;
  letters: string[];
  onInsertOption: (index: number) => void;
  onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
  onSetCorrect: (idx: number) => void;
  onRemoveOption: (idx: number) => void;
}

const OptionCard = React.memo(({
  opt, idx, isComplex, canDelete, letters,
  onInsertOption, onUpdateOption, onSetCorrect, onRemoveOption,
}: OptionCardProps) => {
  // Stable per-option callbacks — re-created only when dependencies change
  const stableOnChange = useCallback(
    (text: string) => onUpdateOption(idx, { text }),
    [idx, onUpdateOption]
  );
  const stableOnCorrectToggle = useCallback(
    () => onSetCorrect(idx),
    [idx, onSetCorrect]
  );
  const stableOnDelete = useCallback(
    () => onRemoveOption(idx),
    [idx, onRemoveOption]
  );

  return (
    <React.Fragment key={opt.id || idx}>
      {/* Insert between button (visible on hover) */}
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
      <AnswerOptionCard
        label={letters[idx] || `${idx + 1}`}
        value={opt.text}
        isCorrect={opt.isCorrect}
        isMultiSelect={isComplex}
        onChange={stableOnChange}
        onCorrectToggle={stableOnCorrectToggle}
        onDelete={stableOnDelete}
        canDelete={canDelete}
        placeholder={`Opsi ${letters[idx] || idx + 1}...`}
      />
    </React.Fragment>
  );
});

OptionCard.displayName = 'OptionCard';

// ── Main MCQForm ────────────────────────────────────────────────────────────────
export const MCQForm = React.memo(({
  options,
  isComplex,
  onAddOption,
  onBulkAdd,
  onInsertOption,
  onRemoveOption,
  onUpdateOption,
  onSetAllCorrect,
  onToggleCorrect,
  maxOptions = 26,
}: MCQFormProps) => {
  const handleCorrectClick = useCallback(
    (index: number) => {
      if (isComplex) {
        onToggleCorrect(index);
      } else {
        onSetAllCorrect(index);
      }
    },
    [isComplex, onSetAllCorrect, onToggleCorrect]
  );

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const canDelete = options.length > 2;

  return (
    <OptionList
      onAdd={options.length < maxOptions ? onAddOption : undefined}
      onBulkAdd={options.length < maxOptions ? onBulkAdd : undefined}
      addLabel="Tambah"
      maxItems={maxOptions}
    >
      {options.map((opt, idx) => (
        <OptionCard
          key={opt.id || idx}
          opt={opt}
          idx={idx}
          isComplex={isComplex}
          canDelete={canDelete}
          letters={letters}
          onInsertOption={onInsertOption}
          onUpdateOption={onUpdateOption}
          onSetCorrect={handleCorrectClick}
          onRemoveOption={onRemoveOption}
        />
      ))}
    </OptionList>
  );
});

MCQForm.displayName = 'MCQForm';
