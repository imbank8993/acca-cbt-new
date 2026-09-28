"use client";
import { FileText,Target } from 'lucide-react';
import React,{ useCallback } from 'react';
import { BaseOption } from '../schema';
import { AnswerOptionCard } from './AnswerOptionCard';

interface PairedComparisonFormProps {
    options: BaseOption[];
    dimensions: any[];
    onUpdateOption: (idx: number, fields: Partial<BaseOption>) => void;
}

const PairedComparisonOptionCard = React.memo(({
    opt, idx, dimensions, onUpdateOption
}: {
    opt: BaseOption;
    idx: number;
    dimensions: any[];
    onUpdateOption: (index: number, fields: Partial<BaseOption>) => void;
}) => {
    const stableOnChange = useCallback((text: string) => onUpdateOption(idx, { text }), [idx, onUpdateOption]);

    return (
        <div className="group flex gap-0 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm mb-2">
            {/* Kolom Pernyataan — 65% */}
            <div className="basis-[65%] min-w-0 p-2.5">
                <AnswerOptionCard
                    label={idx === 0 ? "A" : "B"}
                    value={opt.text}
                    isCorrect={false}
                    isMultiSelect={false}
                    onChange={stableOnChange}
                    canDelete={false}
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
                    className="w-full bg-slate-50 border border-slate-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none transition-all"
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

PairedComparisonOptionCard.displayName = 'PairedComparisonOptionCard';

export const PairedComparisonForm = React.memo(({
    options,
    dimensions,
    onUpdateOption
}: PairedComparisonFormProps) => {
    // Memastikan selalu ada tepat 2 opsi yang dirender
    const renderOptions = options.slice(0, 2);

    return (
        <div className="space-y-4">

            
            {/* Header Kolom Bersama */}
            <div className="flex gap-0 items-center px-4 py-2 border border-slate-200 rounded-xl bg-slate-50/80 shadow-sm mb-3">
                <div className="basis-[65%] text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <FileText size={14} className="text-slate-400" />
                    Pernyataan
                </div>
                <div className="basis-[35%] text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 pl-4 border-l border-slate-300/40">
                    <Target size={14} className="text-pink-500" />
                    Dimensi
                </div>
            </div>

            <div className="space-y-2 mt-4 relative">
                {renderOptions.map((opt, idx) => (
                    <PairedComparisonOptionCard
                        key={opt.id || idx}
                        opt={opt}
                        idx={idx}
                        dimensions={dimensions}
                        onUpdateOption={onUpdateOption}
                    />
                ))}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-slate-100 border-2 border-white text-slate-400 font-black text-[10px] w-8 h-8 rounded-full flex items-center justify-center z-10 shadow-sm">
                    VS
                </div>
            </div>
        </div>
    );
});

PairedComparisonForm.displayName = 'PairedComparisonForm';
