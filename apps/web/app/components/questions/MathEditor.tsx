"use client";
import './question-editor-dark.css';
import { useCallback,useEffect,useMemo,useState } from 'react';
import { renderLatex,sanitizeLatex } from './math-utils';

const TEMPLATES = {
  structure: [
    { label: 'Frac', latex: '\\frac{}{}', desc: 'Pecahan' },
    { label: 'Sqrt', latex: '\\sqrt{}', desc: 'Akar kuadrat' },
    { label: 'Sqrt[n]', latex: '\\sqrt[n]{}', desc: 'Akar pangkat n' },
    { label: 'Power', latex: '^{}', desc: 'Pangkat' },
    { label: 'Sub', latex: '_{}', desc: 'Indeks' },
    { label: 'Abs', latex: '\\left| {} \\right|', desc: 'Nilai mutlak' },
  ],
  operators: [
    { label: '+', latex: '+', desc: 'Tambah' },
    { label: '−', latex: '-', desc: 'Kurang' },
    { label: '×', latex: '\\times', desc: 'Kali' },
    { label: '÷', latex: '\\div', desc: 'Bagi' },
    { label: '±', latex: '\\pm', desc: 'Plus minus' },
    { label: '·', latex: '\\cdot', desc: 'Titik' },
  ],
  relations: [
    { label: '=', latex: '=', desc: 'Sama dengan' },
    { label: '≠', latex: '\\neq', desc: 'Tidak sama' },
    { label: '<', latex: '<', desc: 'Kurang dari' },
    { label: '>', latex: '>', desc: 'Lebih dari' },
    { label: '≤', latex: '\\leq', desc: 'Kurang sama' },
    { label: '≥', latex: '\\geq', desc: 'Lebih sama' },
    { label: '≈', latex: '\\approx', desc: 'Hampiran' },
    { label: '≡', latex: '\\equiv', desc: 'Ekuivalen' },
  ],
  arrows: [
    { label: '→', latex: '\\rightarrow', desc: 'Panah kanan' },
    { label: '←', latex: '\\leftarrow', desc: 'Panah kiri' },
    { label: '↔', latex: '\\leftrightarrow', desc: 'Panah dua arah' },
    { label: '⇒', latex: '\\Rightarrow', desc: 'Implikasi' },
    { label: '⇔', latex: '\\Leftrightarrow', desc: 'Ekuivalen' },
  ],
  sets: [
    { label: '∞', latex: '\\infty', desc: 'Tak hingga' },
    { label: '∈', latex: '\\in', desc: 'Elemen' },
    { label: '∉', latex: '\\notin', desc: 'Bukan elemen' },
    { label: '⊂', latex: '\\subset', desc: 'Subset' },
    { label: '⊃', latex: '\\supset', desc: 'Superset' },
    { label: '∪', latex: '\\cup', desc: 'Gabungan' },
    { label: '∩', latex: '\\cap', desc: 'Irisan' },
    { label: '∅', latex: '\\emptyset', desc: 'Himpunan kosong' },
  ],
  calculus: [
    { label: 'Σ', latex: '\\sum_{i=1}^{n}', desc: 'Sigma' },
    { label: '∏', latex: '\\prod_{i=1}^{n}', desc: 'Produk' },
    { label: '∫', latex: '\\int_{a}^{b}', desc: 'Integral' },
    { label: 'lim', latex: '\\lim_{x \\to \\infty}', desc: 'Limit' },
  ],
  trig: [
    { label: 'sin', latex: '\\sin {}', desc: 'Sinus' },
    { label: 'cos', latex: '\\cos {}', desc: 'Cosinus' },
    { label: 'tan', latex: '\\tan {}', desc: 'Tangen' },
    { label: 'log', latex: '\\log {}', desc: 'Logaritma' },
    { label: 'ln', latex: '\\ln {}', desc: 'Log natural' },
    { label: 'e^x', latex: 'e^{}', desc: 'Eksponensial' },
  ],
  greek: [
    { label: 'α', latex: '\\alpha', desc: 'Alpha' },
    { label: 'β', latex: '\\beta', desc: 'Beta' },
    { label: 'γ', latex: '\\gamma', desc: 'Gamma' },
    { label: 'θ', latex: '\\theta', desc: 'Theta' },
    { label: 'λ', latex: '\\lambda', desc: 'Lambda' },
    { label: 'μ', latex: '\\mu', desc: 'Mu' },
    { label: 'π', latex: '\\pi', desc: 'Pi' },
    { label: 'σ', latex: '\\sigma', desc: 'Sigma' },
  ],
  geometry: [
    { label: '∠', latex: '\\angle', desc: 'Sudut' },
    { label: '△', latex: '\\triangle', desc: 'Segitiga' },
    { label: '⊥', latex: '\\perp', desc: 'Tegak lurus' },
    { label: '∥', latex: '\\parallel', desc: 'Sejajar' },
    { label: '°', latex: '^{\\circ}', desc: 'Derajat' },
    { label: '⌒', latex: '\\widehat{}', desc: 'Busur' },
  ],
  matrix: [
    { label: '()', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', desc: 'Matriks 2×2' },
    { label: '[]', latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', desc: 'Matriks bracket' },
    { label: '{', latex: '\\begin{cases} x & \\text{jika } x > 0 \\\\ -x & \\text{lainnya} \\end{cases}', desc: 'Cases' },
  ],
  text: [
    { label: 'Aa', latex: '\\text{}', desc: 'Teks biasa' },
    { label: 'x̄', latex: '\\bar{}', desc: 'Garis atas' },
    { label: 'x̂', latex: '\\hat{}', desc: 'Topi' },
    { label: 'ẋ', latex: '\\dot{}', desc: 'Dot' },
    { label: '→', latex: '\\vec{}', desc: 'Vektor' },
  ],
};

interface MathEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (mathText: string) => void;
  initialLatex?: string;
}

export function MathEditor({ isOpen, onClose, onInsert, initialLatex = '' }: MathEditorProps) {
  const [input, setInput] = useState(initialLatex);
  const [activeCategory, setActiveCategory] = useState<keyof typeof TEMPLATES>('structure');
  const [mathMode, setMathMode] = useState<'inline' | 'block'>('inline');

  const { previewHtml, previewError } = useMemo(() => {
    if (!input.trim()) {
      return { previewHtml: '', previewError: false };
    }
    const clean = sanitizeLatex(input);
    const result = renderLatex(clean, false);
    return { previewHtml: result.error ? '' : result.html, previewError: result.error };
  }, [input]);

  useEffect(() => {
    const synchronizeInput = window.setTimeout(() => setInput(initialLatex), 0);
    return () => window.clearTimeout(synchronizeInput);
  }, [initialLatex]);

  const handleInsert = useCallback(() => {
    if (!input.trim() || previewError) return;
    const clean = sanitizeLatex(input);
    const mathText = mathMode === 'inline' ? `$${clean}$` : `$$${clean}$$`;
    onInsert(mathText);
    setInput('');
    onClose();
  }, [input, previewError, mathMode, onInsert, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleInsert(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, handleInsert]);

  if (!isOpen) return null;

  const categories = Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[];
  const CATEGORY_LABELS: Record<keyof typeof TEMPLATES, string> = {
    structure: 'Struktur',
    operators: 'Operator',
    relations: 'Relasi',
    arrows: 'Panah',
    sets: 'Himpunan',
    calculus: 'Kalkulus',
    trig: 'Trig',
    greek: 'Yunani',
    geometry: 'Geometri',
    matrix: 'Matriks',
    text: 'Teks',
  };

  const categoryColors: Record<string, string> = {
    structure: 'bg-amber-500 text-white',
    operators: 'bg-blue-500 text-white',
    relations: 'bg-violet-500 text-white',
    arrows: 'bg-teal-500 text-white',
    sets: 'bg-emerald-500 text-white',
    calculus: 'bg-pink-500 text-white',
    trig: 'bg-pink-500 text-white',
    greek: 'bg-cyan-500 text-white',
    geometry: 'bg-indigo-500 text-white',
    matrix: 'bg-purple-500 text-white',
    text: 'bg-slate-500 text-white',
  };

  return (
    <div
      className="insertion-modal fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="insertion-title-icon w-9 h-9 bg-amber-500/20 rounded-lg flex items-center justify-center border border-amber-500/30">
              <span className="text-amber-400 font-bold text-sm">fx</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Sisipkan Rumus Matematika</h2>
              <p className="text-[10px] text-slate-400">Ketik LaTeX atau gunakan template</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="w-full md:w-48 shrink-0 border-r border-slate-100 flex flex-col overflow-y-auto bg-slate-50/50">
            <div className="flex flex-wrap gap-1 px-3 pt-3 pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all
                    ${activeCategory === cat
                      ? `${categoryColors[cat]} shadow-sm`
                      : 'bg-white text-slate-400 hover:text-slate-600 border border-slate-200'
                    }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            <div className="px-3 pb-3 pt-2 grid grid-cols-3 gap-1.5">
              {(TEMPLATES[activeCategory] || []).map((tpl, i) => (
                <button
                  key={i}
                  onClick={() => setInput((p) => p + tpl.latex)}
                  title={`${tpl.desc}: ${tpl.latex}`}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-center hover:bg-slate-100 hover:border-slate-300 active:scale-95 transition-all"
                >
                  <div className="text-[12px] font-bold text-slate-700 leading-tight">{tpl.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-y-auto">
            <div className="px-5 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Ketik LaTeX</span>
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setMathMode('inline')}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mathMode === 'inline' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Rumus Inline
                  </button>
                  <button
                    type="button"
                    onClick={() => setMathMode('block')}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mathMode === 'block' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Rumus Baris Baru
                  </button>
                </div>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Contoh: \frac{a}{b} + x^2"
                rows={3}
                autoFocus
                className="w-full p-4 bg-white border-2 border-slate-200 rounded-lg text-sm font-mono text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none placeholder:font-sans placeholder:text-slate-300"
              />
            </div>

            <div className="px-5 pt-3 flex-1 flex flex-col">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Pratinjau Langsung</span>
              <div className={`
                flex-1 rounded-lg min-h-[100px] p-4 flex items-center justify-center border-2 overflow-auto
                ${previewError
                  ? 'bg-rose-50 border-rose-200'
                  : previewHtml
                    ? 'bg-slate-50 border-slate-200'
                    : 'bg-slate-50 border-slate-100'
                }
              `}>
                {previewHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : previewError ? (
                  <div className="text-xs text-rose-500 font-mono px-4 py-3">{input}</div>
                ) : (
                  <span className="text-xs text-slate-400 italic">Pratinjau rumus akan muncul di sini...</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleInsert}
            disabled={!input.trim() || previewError}
            className="px-5 py-2 text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#256fe0] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow flex items-center gap-2"
          >
            Sisipkan Rumus
          </button>
        </div>
      </div>
    </div>
  );
}

export default MathEditor;
