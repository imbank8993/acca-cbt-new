"use client";
import { FileText,Target } from 'lucide-react';
import React,{ useCallback } from 'react';
import type { DimensionItem } from '@/lib/api/questions';
import { BaseOption } from '../schema';
import { AnswerOptionCard,OptionList } from './AnswerOptionCard';

interface ChecklistFormProps {
    options: BaseOption[];
    dimensions: DimensionItem[];
    onAddOption: () => void;
    onRemoveOption: (idx: number) => void;
    onUpdateOption: (idx: number, fields: Partial<BaseOption>) => void;
}

const ChecklistOptionCard = React.memo(({
    opt, idx, canDelete, dimensions,
    onUpdateOption, onRemoveOption
}: {
    opt: BaseOption;
    idx: number;
    canDelete: boolean;
    dimensions: DimensionItem[];
    onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
    onRemoveOption: (idx: number) => void;
}) => {
    const stableOnChange = useCallback((text: string) => onUpdateOption(idx, { text }), [idx, onUpdateOption]);
    const stableOnDelete = useCallback(() => onRemoveOption(idx), [idx, onRemoveOption]);

    return (
        <div className="group flex gap-0 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm mb-2">
            {/* Kolom Pernyataan — 65% */}
            <div className="basis-[65%] min-w-0 p-2.5">
                <AnswerOptionCard
                    label={`P${idx + 1}`}
                    value={opt.text}
                    isCorrect={false}
                    isMultiSelect={false}
                    onChange={stableOnChange}
                    onDelete={stableOnDelete}
                    canDelete={canDelete}
                    placeholder="Tulis pernyataan..."
                    hideCorrectToggle={true}
                    hideRichTools={true}
                    className="!mb-0"
                />
            </div>
            {/* Divider */}
            <div className="w-px bg-slate-100 self-stretch" />
            {/* Kolom Dimensi — 35% */}
            <div className="basis-[35%] min-w-0 p-2.5 flex items-center">
                <select
                    value={opt.dimension_id || ''}
                    onChange={(e) => onUpdateOption(idx, { dimension_id: e.target.value || null })}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none transition-all"
                >
                    <option value="">-- Pilih Dimensi --</option>
                    {dimensions.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                </select>
            </div>
        </div>
    );
});

ChecklistOptionCard.displayName = 'ChecklistOptionCard';

export const ChecklistForm = React.memo(({
    options,
    dimensions,
    onAddOption,
    onRemoveOption,
    onUpdateOption
}: ChecklistFormProps) => {
    const canDelete = options.length > 2;

    return (
        <div className="space-y-4">


            {/* Header Kolom Bersama */}
            <div className="flex gap-0 items-center px-4 py-2 border border-slate-200 rounded-xl bg-slate-50/80 shadow-sm mb-3">
                <div className="basis-[65%] text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <FileText size={14} className="text-slate-400" />
                    Pernyataan
                </div>
                <div className="basis-[35%] text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 pl-4 border-l border-slate-300/40">
                    <Target size={14} className="text-sky-500" />
                    Dimensi
                </div>
            </div>
            
            <OptionList
                onAdd={onAddOption}
                addLabel="Tambah Pernyataan (Bawah)"
                maxItems={20}
            >
                {options.map((opt, idx) => (
                    <ChecklistOptionCard
                        key={opt.id || idx}
                        opt={opt}
                        idx={idx}
                        canDelete={canDelete}
                        dimensions={dimensions}
                        onUpdateOption={onUpdateOption}
                        onRemoveOption={onRemoveOption}
                    />
                ))}
            </OptionList>
        </div>
    );
});

ChecklistForm.displayName = 'ChecklistForm';
