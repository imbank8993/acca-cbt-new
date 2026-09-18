"use client";

import React, { useCallback, useState } from 'react';
import { LATEX_TEMPLATES, type LatexTemplateKey } from './math-utils';

interface MathToolbarProps {
    onInsert: (template: string) => void;
    visible?: boolean;
    className?: string;
}

interface TemplateBtn {
    key: LatexTemplateKey;
}

const GROUPS: Array<{ label: string; color: string; items: LatexTemplateKey[] }> = [
    { label: 'Dasar', color: 'bg-blue-500', items: ['fraction', 'binomial', 'superscript', 'subscript', 'exp', 'sqrt', 'sqrtn', 'paren', 'bracket', 'brace', 'abs', 'norm'] },
    { label: 'Kalkulus & Fungsi', color: 'bg-teal-500', items: ['sum', 'product', 'coprod', 'integral', 'iint', 'limit', 'log', 'ln', 'sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'arcsin', 'arccos', 'arctan'] },
    { label: 'Matriks', color: 'bg-amber-500', items: ['pmatrix2', 'pmatrix3', 'bmatrix2', 'bmatrix3', 'Bmatrix2', 'Bmatrix3', 'vmatrix2', 'vmatrix3', 'cases2', 'cases3'] },
    { label: 'Simbol & Aksen', color: 'bg-rose-500', items: ['hat', 'bar', 'vec', 'dot', 'ddot', 'arc', 'overline', 'underline', 'pm', 'mp', 'times', 'div', 'cdot', 'neq', 'leq', 'geq', 'approx', 'equiv', 'propto', 'infinity', 'degree', 'angle', 'perp', 'parallel', 'triangle', 'circle', 'square', 'forall', 'exists', 'nexists', 'in', 'notin', 'subset', 'supset', 'cup', 'cap', 'emptyset'] },
    { label: 'Greek', color: 'bg-slate-500', items: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'] }
];

export const MathToolbar = React.memo(({
    onInsert,
    visible = true,
    className = '',
}: MathToolbarProps) => {
    const [activeGroup, setActiveGroup] = useState(0);
    const [search, setSearch] = useState('');
    const active = GROUPS[activeGroup];

    const filtered = search.trim()
        ? GROUPS.flatMap(g => g.items).filter(key => {
            const t = LATEX_TEMPLATES[key];
            return t.label.toLowerCase().includes(search.toLowerCase()) ||
                t.template.toLowerCase().includes(search.toLowerCase());
        })
        : active.items;

    return (
        <div className={`flex flex-col gap-2 ${className}`}>
            {/* Search */}
            <div className="relative">
                <input
                    type="text"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setActiveGroup(0); }}
                    placeholder="Cari template..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white outline-none focus:border-blue-400"
                />
                {search && (
                    <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>
                )}
            </div>

            {/* Category tabs */}
            {!search && (
                <div className="flex gap-1.5 flex-wrap">
                    {GROUPS.map((g, i) => (
                        <button
                            key={g.label}
                            onClick={() => setActiveGroup(i)}
                            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all ${
                                activeGroup === i
                                    ? `${g.color} text-white shadow-sm`
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Grid */}
            <div className="grid grid-cols-5 gap-1.5">
                {filtered.map(key => {
                    const t = LATEX_TEMPLATES[key];
                    return (
                        <button
                            key={key}
                            onClick={() => onInsert(t.template)}
                            title={`${t.label}\n${t.template}`}
                            className="flex flex-col items-center justify-center p-1.5 rounded-lg bg-white border border-slate-100 hover:border-blue-300 hover:bg-blue-50 transition-all text-center gap-0.5"
                        >
                            <span className="text-base leading-none">{t.icon}</span>
                            <span className="text-[9px] text-slate-500 leading-tight">{t.label}</span>
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <div className="col-span-5 text-center text-xs text-slate-400 py-4">Tidak ditemukan</div>
                )}
            </div>
        </div>
    );
});

MathToolbar.displayName = 'MathToolbar';

export default MathToolbar;
