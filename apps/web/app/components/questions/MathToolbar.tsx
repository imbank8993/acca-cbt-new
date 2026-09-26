"use client";

import React, { useState, useMemo } from 'react';
import { LATEX_TEMPLATES, renderLatex, type LatexTemplateKey } from './math-utils';

interface MathToolbarProps {
    onInsert: (template: string) => void;
    visible?: boolean;
    className?: string;
}

// ── Lightweight KaTeX Renderer for Badge Icons ──
const LatexIcon = React.memo(({ math, className = '' }: { math: string; className?: string }) => {
    const res = useMemo(() => renderLatex(math, false), [math]);
    return (
        <span
            className={`pointer-events-none select-none inline-flex items-center justify-center leading-normal text-[13px] ${className}`}
            dangerouslySetInnerHTML={{ __html: res.html }}
        />
    );
});
LatexIcon.displayName = 'LatexIcon';

// ── Structure Definition (Microsoft Word Equation Structures) ──
interface StructureModel {
    key: LatexTemplateKey;
    latex: string;
    label: string;
}

interface StructureGroup {
    id: string;
    latex: string; // The LaTeX formula rendered on the main badge
    label: string;
    defaultKey: LatexTemplateKey;
    models: StructureModel[];
}

const WORD_STRUCTURES: StructureGroup[] = [
    {
        id: 'fraction',
        latex: '\\frac{a}{b}',
        label: 'Pecahan',
        defaultKey: 'fraction',
        models: [
            { key: 'fraction', latex: '\\frac{a}{b}', label: 'Pecahan Vertikal' },
            { key: 'fraction_skewed', latex: 'a/b', label: 'Pecahan Miring' },
            { key: 'diff', latex: '\\frac{dy}{dx}', label: 'Turunan dy/dx' },
            { key: 'diff2', latex: '\\frac{d^2y}{dx^2}', label: 'Turunan Kedua' },
            { key: 'pdiff', latex: '\\frac{\\partial y}{\\partial x}', label: 'Turunan Parsial' },
            { key: 'delta_frac', latex: '\\frac{\\Delta y}{\\Delta x}', label: 'Delta y/x' },
        ],
    },
    {
        id: 'script',
        latex: 'x^2',
        label: 'Pangkat & Indeks',
        defaultKey: 'superscript',
        models: [
            { key: 'superscript', latex: 'x^n', label: 'Pangkat (Superscript)' },
            { key: 'subscript', latex: 'x_n', label: 'Indeks (Subscript)' },
            { key: 'sub_super', latex: 'x_n^m', label: 'Pangkat & Indeks' },
            { key: 'left_sub_super', latex: '{}_n^m x', label: 'Kiri Sub-Super' },
            { key: 'left_subscript', latex: '{}_n x', label: 'Kiri Indeks' },
            { key: 'exp', latex: 'e^x', label: 'Eksponensial eˣ' },
        ],
    },
    {
        id: 'radical',
        latex: '\\sqrt{x}',
        label: 'Akar',
        defaultKey: 'sqrt',
        models: [
            { key: 'sqrt', latex: '\\sqrt{x}', label: 'Akar Kuadrat' },
            { key: 'sqrtn', latex: '\\sqrt[n]{x}', label: 'Akar Berderajat n' },
            { key: 'sqrt3', latex: '\\sqrt[3]{x}', label: 'Akar Kubik' },
            { key: 'sqrt_quad', latex: '\\sqrt{x^2+y^2}', label: 'Akar Kuadratik' },
        ],
    },
    {
        id: 'integral',
        latex: '\\int',
        label: 'Integral',
        defaultKey: 'integral',
        models: [
            { key: 'integral', latex: '\\int', label: 'Integral Tak Tentu' },
            { key: 'integral_def', latex: '\\int_a^b', label: 'Integral Tentu (Batas)' },
            { key: 'iint', latex: '\\iint', label: 'Integral Ganda Dua' },
            { key: 'iiint', latex: '\\iiint', label: 'Integral Ganda Tiga' },
            { key: 'oint', latex: '\\oint', label: 'Integral Kontur' },
            { key: 'oiint', latex: '\\oiint', label: 'Integral Permukaan' },
        ],
    },
    {
        id: 'large_op',
        latex: '\\sum',
        label: 'Operator Besar',
        defaultKey: 'sum',
        models: [
            { key: 'sum', latex: '\\sum_{i=1}^n', label: 'Sigma dengan Batas' },
            { key: 'sum_simple', latex: '\\sum', label: 'Sigma Sederhana' },
            { key: 'product', latex: '\\prod_{i=1}^n', label: 'Produk dengan Batas' },
            { key: 'prod_simple', latex: '\\prod', label: 'Produk Sederhana' },
            { key: 'coprod', latex: '\\coprod_{i=1}^n', label: 'Koproduk Batas' },
            { key: 'coprod_simple', latex: '\\coprod', label: 'Koproduk' },
            { key: 'bigcup', latex: '\\bigcup', label: 'Gabungan Besar' },
            { key: 'bigcap', latex: '\\bigcap', label: 'Irisan Besar' },
        ],
    },
    {
        id: 'bracket',
        latex: '(x)',
        label: 'Tanda Kurung',
        defaultKey: 'paren',
        models: [
            { key: 'paren', latex: '(x)', label: 'Kurung Biasa' },
            { key: 'bracket', latex: '[x]', label: 'Kurung Siku' },
            { key: 'brace', latex: '\\{x\\}', label: 'Kurung Kurawal' },
            { key: 'abs', latex: '|x|', label: 'Nilai Mutlak' },
            { key: 'norm', latex: '\\|x\\|', label: 'Norma Vektor' },
            { key: 'angle_bracket', latex: '\\langle x \\rangle', label: 'Kurung Sudut' },
            { key: 'floor', latex: '\\lfloor x \\rfloor', label: 'Floor' },
            { key: 'ceil', latex: '\\lceil x \\rceil', label: 'Ceiling' },
            { key: 'binomial', latex: '\\binom{n}{k}', label: 'Binomial' },
            { key: 'bracket_interval', latex: '[a, b)', label: 'Interval [a,b)' },
            { key: 'cases2', latex: '{\\scriptstyle\\begin{cases} a \\\\ b \\end{cases}}', label: 'Kasus 2 Baris' },
            { key: 'cases3', latex: '{\\scriptstyle\\begin{cases} a \\\\ b \\\\ c \\end{cases}}', label: 'Kasus 3 Baris' },
        ],
    },
    {
        id: 'function',
        latex: '\\sin',
        label: 'Fungsi Trigonometri',
        defaultKey: 'sin',
        models: [
            { key: 'sin', latex: '\\sin x', label: 'Sinus' },
            { key: 'cos', latex: '\\cos x', label: 'Cosinus' },
            { key: 'tan', latex: '\\tan x', label: 'Tangen' },
            { key: 'csc', latex: '\\csc x', label: 'Cosecan' },
            { key: 'sec', latex: '\\sec x', label: 'Secan' },
            { key: 'cot', latex: '\\cot x', label: 'Cotangen' },
            { key: 'arcsin', latex: '\\arcsin x', label: 'Arcsin' },
            { key: 'arccos', latex: '\\arccos x', label: 'Arccos' },
            { key: 'arctan', latex: '\\arctan x', label: 'Arctan' },
            { key: 'sinh', latex: '\\sinh x', label: 'Sinus Hiperbolik' },
            { key: 'cosh', latex: '\\cosh x', label: 'Cosinus Hiperbolik' },
            { key: 'tanh', latex: '\\tanh x', label: 'Tangen Hiperbolik' },
        ],
    },
    {
        id: 'accent',
        latex: '\\dot{x}',
        label: 'Aksen & Vektor',
        defaultKey: 'dot',
        models: [
            { key: 'dot', latex: '\\dot{x}', label: 'Dot' },
            { key: 'ddot', latex: '\\ddot{x}', label: 'Double Dot' },
            { key: 'dddot', latex: '\\dddot{x}', label: 'Triple Dot' },
            { key: 'hat', latex: '\\hat{x}', label: 'Topi (Hat)' },
            { key: 'bar', latex: '\\bar{x}', label: 'Bar' },
            { key: 'vec', latex: '\\vec{x}', label: 'Vektor Panah' },
            { key: 'tilde', latex: '\\tilde{x}', label: 'Tilde' },
            { key: 'prime', latex: "x'", label: 'Prime' },
            { key: 'prime2', latex: "x''", label: 'Double Prime' },
            { key: 'arc', latex: '\\wideparen{x}', label: 'Busur' },
            { key: 'underline', latex: '\\underline{x}', label: 'Garis Bawah' },
            { key: 'overline', latex: '\\overline{x}', label: 'Overline' },
        ],
    },
    {
        id: 'limit_log',
        latex: '\\lim',
        label: 'Limit & Log',
        defaultKey: 'limit',
        models: [
            { key: 'limit', latex: '\\lim_{x \\to a}', label: 'Limit x→a' },
            { key: 'limit_inf', latex: '\\lim_{x \\to \\infty}', label: 'Limit x→∞' },
            { key: 'limit_zero', latex: '\\lim_{x \\to 0}', label: 'Limit x→0' },
            { key: 'log', latex: '\\log_n x', label: 'Logaritma Basis' },
            { key: 'log_simple', latex: '\\log x', label: 'Log Biasa' },
            { key: 'ln', latex: '\\ln x', label: 'Log Natural (Ln)' },
            { key: 'max', latex: '\\max', label: 'Maksimum' },
            { key: 'min', latex: '\\min', label: 'Minimum' },
        ],
    },
    {
        id: 'matrix',
        latex: '\\left[\\begin{smallmatrix} \\cdot & \\cdot \\\\ \\cdot & \\cdot \\end{smallmatrix}\\right]',
        label: 'Matriks',
        defaultKey: 'bmatrix2',
        models: [
            { key: 'bmatrix2', latex: '\\left[\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right]', label: 'Matriks [] 2×2' },
            { key: 'pmatrix2', latex: '\\left(\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right)', label: 'Matriks () 2×2' },
            { key: 'Bmatrix2', latex: '\\left\\{\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right\\}', label: 'Matriks {} 2×2' },
            { key: 'vmatrix2', latex: '\\left|\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right|', label: 'Determinan 2×2' },
            { key: 'bmatrix3', latex: '\\left[\\begin{smallmatrix} \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\end{smallmatrix}\\right]', label: 'Matriks [] 3×3' },
            { key: 'pmatrix3', latex: '\\left(\\begin{smallmatrix} \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\end{smallmatrix}\\right)', label: 'Matriks () 3×3' },
            { key: 'Bmatrix3', latex: '\\left\\{\\begin{smallmatrix} \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\end{smallmatrix}\\right\\}', label: 'Matriks {} 3×3' },
            { key: 'vmatrix3', latex: '\\left|\\begin{smallmatrix} \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\\\ \\cdot & \\cdot & \\cdot \\end{smallmatrix}\\right|', label: 'Determinan 3×3' },
            { key: 'vec_row', latex: '\\left(\\begin{smallmatrix} a & b \\end{smallmatrix}\\right)', label: 'Vektor Baris' },
            { key: 'vec_col', latex: '\\left(\\begin{smallmatrix} a \\\\ b \\end{smallmatrix}\\right)', label: 'Vektor Kolom' },
        ],
    },
];

// ── Operator & Relasi ──
const OPERATORS: LatexTemplateKey[] = [
    'pm', 'mp', 'times', 'div', 'cdot',
    'neq', 'leq', 'geq', 'approx', 'equiv',
    'sim', 'propto', 'arrow_right', 'arrow_left', 'arrow_lr',
    'arrow_dright', 'arrow_dlr',
];

// ── Simbol Matematika, Logika & Geometri ──
const SYMBOLS: LatexTemplateKey[] = [
    'infinity', 'partial', 'nabla', 'degree', 'angle',
    'perp', 'parallel', 'triangle', 'circle', 'square',
    'forall', 'exists', 'nexists', 'in', 'notin',
    'subset', 'supset', 'subseteq', 'supseteq', 'cup', 'cap', 'emptyset',
];

// ── Huruf Yunani (Greek) ──
const GREEK: LatexTemplateKey[] = [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
    'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
    'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
    'upsilon', 'phi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi',
    'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
];

type CategoryTab = 'structure' | 'operator' | 'symbol' | 'greek';

export const MathToolbar = React.memo(({
    onInsert,
    className = '',
}: MathToolbarProps) => {
    const [activeTab, setActiveTab] = useState<CategoryTab>('structure');
    const [activeStructureId, setActiveStructureId] = useState<string>('radical');
    const [search, setSearch] = useState('');

    // Active structure object
    const activeStructure = useMemo(
        () => WORD_STRUCTURES.find(s => s.id === activeStructureId) || WORD_STRUCTURES[2], // default to radical (Akar)
        [activeStructureId]
    );

    // Filter search across all templates
    const searchResults = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return null;
        return (Object.keys(LATEX_TEMPLATES) as LatexTemplateKey[]).filter(key => {
            const t = LATEX_TEMPLATES[key];
            return (
                t.label.toLowerCase().includes(q) ||
                t.icon.toLowerCase().includes(q) ||
                t.template.toLowerCase().includes(q)
            );
        });
    }, [search]);

    return (
        <div className={`flex flex-col gap-2.5 pb-8 ${className}`}>
            {/* Search Input */}
            <div className="relative">
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Cari simbol / rumus..."
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 transition-all placeholder:text-slate-400"
                />
                {search && (
                    <button
                        onClick={() => setSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Category Tabs (Word Style) */}
            {!search && (
                <div className="flex bg-slate-200/70 p-0.5 rounded-lg gap-0.5">
                    {[
                        { id: 'structure', label: 'Struktur' },
                        { id: 'operator', label: 'Operator' },
                        { id: 'symbol', label: 'Simbol' },
                        { id: 'greek', label: 'Greek' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as CategoryTab)}
                            className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer text-center ${
                                activeTab === tab.id
                                    ? 'bg-white text-slate-800 shadow-xs'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Content View ── */}
            {searchResults ? (
                /* Search Results View */
                <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Hasil Pencarian ({searchResults.length})
                    </span>
                    <div className="grid grid-cols-5 gap-1.5 max-h-[340px] overflow-y-auto p-0.5">
                        {searchResults.map(key => {
                            const t = LATEX_TEMPLATES[key];
                            const previewMath = t.template.replace(/\?/g, 'x');
                            return (
                                <button
                                    key={key}
                                    onClick={() => onInsert(t.template)}
                                    title={`${t.label}\n${t.template}`}
                                    className="aspect-square min-h-[40px] flex items-center justify-center rounded-lg border border-slate-300 bg-white shadow-xs hover:border-amber-500 hover:bg-amber-50/50 hover:text-amber-700 active:scale-95 transition-all cursor-pointer p-1"
                                >
                                    <LatexIcon math={previewMath} />
                                </button>
                            );
                        })}
                        {searchResults.length === 0 && (
                            <div className="col-span-5 text-center text-xs text-slate-400 py-6">
                                Simbol tidak ditemukan
                            </div>
                        )}
                    </div>
                </div>
            ) : activeTab === 'structure' ? (
                /* ── TAB STRUKTUR (Word Style: Main badges + Model Variants rendered with LaTeX) ── */
                <div className="flex flex-col gap-2.5">
                    {/* 10 Structure Badges (1 Icon each, rendered via LaTeX) */}
                    <div className="grid grid-cols-5 gap-1.5">
                        {WORD_STRUCTURES.map(group => {
                            const isActive = activeStructureId === group.id;
                            return (
                                <button
                                    key={group.id}
                                    onClick={() => {
                                        if (activeStructureId === group.id) {
                                            onInsert(LATEX_TEMPLATES[group.defaultKey].template);
                                        } else {
                                            setActiveStructureId(group.id);
                                        }
                                    }}
                                    title={`${group.label} (Klik untuk pilih model)`}
                                    className={`aspect-square min-h-[44px] flex items-center justify-center rounded-lg border shadow-xs transition-all cursor-pointer relative p-1 ${
                                        isActive
                                            ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400/40'
                                            : 'border-slate-300 bg-white text-slate-700 hover:border-amber-400 hover:bg-slate-50'
                                    }`}
                                >
                                    <LatexIcon math={group.latex} />
                                    {/* Indicator dot showing variants exist */}
                                    <span className={`w-1.5 h-1.5 rounded-full absolute bottom-1 right-1 transition-colors ${isActive ? 'bg-amber-500' : 'bg-slate-300'}`} />
                                </button>
                            );
                        })}
                    </div>

                    {/* Model Variants Box (Rendered via KaTeX LaTeX) */}
                    <div className="border border-slate-200 bg-white rounded-xl p-2.5 shadow-xs flex flex-col gap-1.5">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                Model: {activeStructure.label}
                            </span>
                            <span className="text-[9px] text-slate-400">
                                {activeStructure.models.length} varian
                            </span>
                        </div>

                        {/* Model Badges Grid - Perfectly Balanced 2 Columns */}
                        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                            {activeStructure.models.map(model => {
                                const t = LATEX_TEMPLATES[model.key];
                                return (
                                    <button
                                        key={model.key}
                                        onClick={() => onInsert(t.template)}
                                        title={`${model.label}: ${t.template}`}
                                        className="min-h-[46px] py-1.5 px-2 flex items-center justify-center rounded-lg border border-slate-300 bg-white shadow-2xs hover:border-amber-500 hover:bg-amber-50/50 hover:text-amber-900 active:scale-95 transition-all cursor-pointer text-center"
                                    >
                                        <LatexIcon math={model.latex} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : activeTab === 'operator' ? (
                /* ── TAB OPERATOR & RELASI (LaTeX Rendered) ── */
                <div className="grid grid-cols-5 gap-1.5">
                    {OPERATORS.map(key => {
                        const t = LATEX_TEMPLATES[key];
                        return (
                            <button
                                key={key}
                                onClick={() => onInsert(t.template)}
                                title={`${t.label}: ${t.template}`}
                                className="aspect-square min-h-[38px] flex items-center justify-center rounded-lg border border-slate-300 bg-white shadow-xs hover:border-amber-500 hover:bg-amber-50/50 hover:text-amber-800 active:scale-95 transition-all cursor-pointer p-1"
                            >
                                <LatexIcon math={t.template} />
                            </button>
                        );
                    })}
                </div>
            ) : activeTab === 'symbol' ? (
                /* ── TAB SIMBOL & GEOMETRI (LaTeX Rendered) ── */
                <div className="grid grid-cols-5 gap-1.5">
                    {SYMBOLS.map(key => {
                        const t = LATEX_TEMPLATES[key];
                        const previewMath = t.template.replace(/\?/g, '');
                        return (
                            <button
                                key={key}
                                onClick={() => onInsert(t.template)}
                                title={`${t.label}: ${t.template}`}
                                className="aspect-square min-h-[38px] flex items-center justify-center rounded-lg border border-slate-300 bg-white shadow-xs hover:border-amber-500 hover:bg-amber-50/50 hover:text-amber-800 active:scale-95 transition-all cursor-pointer p-1"
                            >
                                <LatexIcon math={previewMath} />
                            </button>
                        );
                    })}
                </div>
            ) : (
                /* ── TAB GREEK (Huruf Yunani LaTeX Rendered) ── */
                <div className="grid grid-cols-5 gap-1.5">
                    {GREEK.map(key => {
                        const t = LATEX_TEMPLATES[key];
                        return (
                            <button
                                key={key}
                                onClick={() => onInsert(t.template)}
                                title={`${t.label}: ${t.template}`}
                                className="aspect-square min-h-[38px] flex items-center justify-center rounded-lg border border-slate-300 bg-white shadow-xs hover:border-amber-500 hover:bg-amber-50/50 hover:text-amber-800 active:scale-95 transition-all cursor-pointer p-1"
                            >
                                <LatexIcon math={t.template} />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

MathToolbar.displayName = 'MathToolbar';

export default MathToolbar;
