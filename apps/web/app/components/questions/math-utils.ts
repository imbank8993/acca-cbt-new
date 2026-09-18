/**
 * CBT Professional Math Utilities — Reconstruction Version
 *
 * Supports synchronous rendering, LRU caching, and thorough delimiter parsing.
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathExpression {
  latex: string;
  start: number;
  end: number;
  displayMode: boolean;
  original: string;
}

export interface RenderResult {
  html: string;
  error: boolean;
}

const CACHE_MAX = 500;
const cache = new Map<string, string>();

function cacheKey(math: string, display: boolean): string {
  return `${display ? 'D' : 'I'}#${math}`;
}

export function getCachedMath(math: string, display: boolean): string | null {
  return cache.get(cacheKey(math, display)) ?? null;
}

export function setCachedMath(math: string, display: boolean, html: string): void {
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(cacheKey(math, display), html);
}

export function normalizeLatex(input: string): string {
  if (!input) return '';
  return input
    .replace(/&sol;/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/&bsol;/g, '\\')
    .replace(/&#92;/g, '\\')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

export function renderLatex(math: string, displayMode = false): RenderResult {
  if (!math || !math.trim()) return { html: '', error: false };

  const norm = normalizeLatex(math);
  const cached = getCachedMath(norm, displayMode);
  if (cached !== null) return { html: cached, error: false };

  try {
    const html = katex.renderToString(norm, {
      displayMode,
      throwOnError: false,
      errorColor: '#cc0000',
      // Restrict trusted commands: only allow \href / \url with safe protocols.
      // Blocks javascript:/data: URLs and disables \htmlStyle/\htmlClass/
      // \includegraphics injection that `trust: true` would otherwise permit.
      trust: (context) => {
        if (context.command === '\\href' || context.command === '\\url') {
          return /^(https?:|mailto:|\/|#)/i.test(context.url || '');
        }
        return false;
      },
      strict: 'ignore',
      output: 'html',
    });

    setCachedMath(norm, displayMode, html);
    return { html, error: false };
  } catch (err) {
    return { html: `<span style="color:#cc0000;font-family:monospace">${norm}</span>`, error: true };
  }
}

export function extractMathExpressions(text: string): MathExpression[] {
  if (!text) return [];
  const results: MathExpression[] = [];
  const regex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{(?:equation|aligned|array|pmatrix|bmatrix|cases)\}[\s\S]*?\\end\{(?:equation|aligned|array|pmatrix|bmatrix|cases)\}|\\\(.*?\\\)|\[%.*?%\]|\$(?:[^$\n\\]|\\.)+\$)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const original = match[0];
    const start = match.index;
    const end = regex.lastIndex;

    const isBlock = original.startsWith('$$') ||
                    original.startsWith('\\[') ||
                    original.startsWith('\\begin{');

    let latex = original;
    if (original.startsWith('$$') && original.endsWith('$$')) {
      latex = original.slice(2, -2);
    } else if (original.startsWith('\\[') && original.endsWith('\\]')) {
      latex = original.slice(2, -2);
    } else if (original.startsWith('\\begin{') && original.endsWith('}')) {
      latex = original;
    } else if (original.startsWith('\\(') && original.endsWith('\\)')) {
      latex = original.slice(2, -2);
    } else if (original.startsWith('[%') && original.endsWith('%]')) {
      latex = original.slice(2, -2);
    } else if (original.startsWith('$') && original.endsWith('$')) {
      latex = original.slice(1, -1);
    }

    results.push({
      latex: latex.trim(),
      start,
      end,
      displayMode: isBlock,
      original,
    });
  }

  return results;
}

export function sanitizeLatex(input: string): string {
  if (!input || typeof input !== 'string') return '';
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = input;
    return el.value.trim();
  }
  return input.trim();
}

export const LATEX_TEMPLATES = {
  // Basic
  fraction:    { template: '\\frac{?}{?}',      label: 'Pecahan',    icon: 'a/b' },
  sqrt:        { template: '\\sqrt{?}',         label: 'Akar',       icon: '√'  },
  sqrtn:       { template: '\\sqrt[?]{?}',      label: 'Akar pangkat', icon: 'ⁿ√' },
  superscript: { template: '?^{?}',              label: 'Pangkat',    icon: 'x²' },
  subscript:   { template: '?_{?}',              label: 'Indeks',     icon: 'x₂' },
  binomial:    { template: '\\binom{?}{?}',    label: 'Binomial',   icon: '(ⁿₖ)' },
  
  // Operator
  sum:         { template: '\\sum_{?}^{?}', label: 'Sigma',      icon: 'Σ'  },
  integral:    { template: '\\int_{?}^{?}',   label: 'Integral',   icon: '∫'  },
  iint:        { template: '\\iint_{?}^{?}',  label: 'Dbl Integral', icon: '∬' },
  limit:       { template: '\\lim_{? \\to ?}', label: 'Limit', icon: 'lim' },
  product:     { template: '\\prod_{?}^{?}', label: 'Produk',   icon: 'Π'  },
  coprod:      { template: '\\coprod_{?}^{?}', label: 'Koproduk', icon: '∐' },
  
  // Trigonometry & Logarithm
  sin:         { template: '\\sin ?',         label: 'Sinus',     icon: 'sin' },
  cos:         { template: '\\cos ?',         label: 'Cosinus',   icon: 'cos' },
  tan:         { template: '\\tan ?',         label: 'Tangen',    icon: 'tan' },
  csc:         { template: '\\csc ?',         label: 'Cosecan',   icon: 'csc' },
  sec:         { template: '\\sec ?',         label: 'Secan',     icon: 'sec' },
  cot:         { template: '\\cot ?',         label: 'Cotangen',  icon: 'cot' },
  arcsin:      { template: '\\arcsin ?',      label: 'Arcsin',    icon: 'asin' },
  arccos:      { template: '\\arccos ?',      label: 'Arccos',    icon: 'acos' },
  arctan:      { template: '\\arctan ?',      label: 'Arctan',    icon: 'atan' },
  log:         { template: '\\log_{?} ?',    label: 'Logaritma', icon: 'log' },
  ln:          { template: '\\ln ?',          label: 'Ln',        icon: 'ln'  },
  exp:         { template: 'e^{?}',             label: 'Eksponensial', icon: 'eˣ' },
  
  // Symbols
  pm:          { template: '\\pm',              label: 'Plus Minus', icon: '±' },
  mp:          { template: '\\mp',              label: 'Minus Plus', icon: '∓' },
  times:       { template: '\\times',          label: 'Kali',     icon: '×'  },
  div:         { template: '\\div',            label: 'Bagi',     icon: '÷'  },
  cdot:        { template: '\\cdot',           label: 'Titik',    icon: '·'  },
  neq:         { template: '\\neq',            label: 'Tidak sama', icon: '≠' },
  leq:         { template: '\\leq',            label: 'Kurang dari sama', icon: '≤' },
  geq:         { template: '\\geq',            label: 'Lebih dari sama', icon: '≥' },
  approx:      { template: '\\approx',        label: 'Kira-kira',   icon: '≈'  },
  equiv:       { template: '\\equiv',         label: 'Ekuivalen',   icon: '≡' },
  propto:      { template: '\\propto',        label: 'Proporsional', icon: '∝' },
  infinity:    { template: '\\infty',          label: 'Tak hingga', icon: '∞' },
  forall:      { template: '\\forall',         label: 'Untuk semua', icon: '∀' },
  exists:      { template: '\\exists',         label: 'Terdapat',   icon: '∃' },
  nexists:     { template: '\\nexists',        label: 'Tdk Terdapat', icon: '∄' },
  in:          { template: '\\in',             label: 'Elemen',     icon: '∈' },
  notin:       { template: '\\notin',          label: 'Bukan Elemen', icon: '∉' },
  subset:      { template: '\\subset',         label: 'Himpunan Bagian', icon: '⊂' },
  supset:      { template: '\\supset',         label: 'Superset',   icon: '⊃' },
  cup:         { template: '\\cup',            label: 'Gabungan',   icon: '∪' },
  cap:         { template: '\\cap',            label: 'Irisan',     icon: '∩' },
  emptyset:    { template: '\\emptyset',       label: 'Himp. Kosong', icon: '∅' },
  
  // Geometry
  degree:      { template: '?^{\\circ}',         label: 'Derajat',  icon: '°'  },
  angle:       { template: '\\angle',          label: 'Sudut',    icon: '∠'  },
  perp:        { template: '\\perp',           label: 'Tegak lurus', icon: '⊥' },
  parallel:    { template: '\\parallel',         label: 'Sejajar',   icon: '∥' },
  triangle:    { template: '\\triangle',         label: 'Segitiga',  icon: '△' },
  circle:      { template: '\\odot',             label: 'Lingkaran',  icon: '⊙' },
  square:      { template: '\\square',           label: 'Persegi',   icon: '□' },
  
  // Notation & Brackets
  paren:       { template: '\\left( ? \\right)',  label: 'Kurung Biasa', icon: '( )' },
  bracket:     { template: '\\left[ ? \\right]',  label: 'Kurung Siku',  icon: '[ ]' },
  brace:       { template: '\\left\\{ ? \\right\\}', label: 'Kurawal',  icon: '{ }' },
  abs:         { template: '\\left| ? \\right|', label: 'Nilai Mutlak', icon: '|x|' },
  norm:        { template: '\\left\\| ? \\right\\|', label: 'Norma', icon: '‖x‖' },
  hat:         { template: '\\widehat{?}',     label: 'Topi',      icon: 'x̂' },
  vec:         { template: '\\overrightarrow{?}',label: 'Vektor',    icon: '→'  },
  bar:         { template: '\\overline{?}',    label: 'Garis',     icon: 'x̄' },
  dot:         { template: '\\dot{?}',         label: 'Dot',       icon: 'ẋ'  },
  ddot:        { template: '\\ddot{?}',        label: 'Double Dot', icon: 'ẍ' },
  arc:         { template: '\\wideparen{?}',   label: 'Busur',     icon: '⌒' },
  overline:    { template: '\\overline{?}',    label: 'Garis Atas', icon: 'A̅' },
  underline:   { template: '\\underline{?}',   label: 'Garis Bawah', icon: 'A̲' },
  
  // Greek
  alpha:       { template: '\\alpha',          label: 'Alpha',    icon: 'α'  },
  beta:        { template: '\\beta',           label: 'Beta',     icon: 'β'  },
  gamma:       { template: '\\gamma',          label: 'Gamma',    icon: 'γ'  },
  delta:       { template: '\\delta',          label: 'Delta',    icon: 'δ'  },
  epsilon:     { template: '\\epsilon',        label: 'Epsilon',  icon: 'ε' },
  zeta:        { template: '\\zeta',           label: 'Zeta',     icon: 'ζ' },
  eta:         { template: '\\eta',            label: 'Eta',      icon: 'η' },
  theta:       { template: '\\theta',          label: 'Theta',    icon: 'θ'  },
  iota:        { template: '\\iota',           label: 'Iota',     icon: 'ι' },
  kappa:       { template: '\\kappa',          label: 'Kappa',    icon: 'κ' },
  lambda:      { template: '\\lambda',         label: 'Lambda',   icon: 'λ'  },
  mu:          { template: '\\mu',             label: 'Mu',      icon: 'μ'  },
  nu:          { template: '\\nu',             label: 'Nu',       icon: 'ν' },
  xi:          { template: '\\xi',             label: 'Xi',       icon: 'ξ' },
  pi:          { template: '\\pi',             label: 'Pi',       icon: 'π' },
  rho:         { template: '\\rho',            label: 'Rho',      icon: 'ρ' },
  sigma:       { template: '\\sigma',          label: 'Sigma',    icon: 'σ'  },
  tau:         { template: '\\tau',            label: 'Tau',      icon: 'τ' },
  upsilon:     { template: '\\upsilon',        label: 'Upsilon',  icon: 'υ' },
  phi:         { template: '\\phi',            label: 'Phi',     icon: 'φ'  },
  chi:         { template: '\\chi',            label: 'Chi',      icon: 'χ' },
  psi:         { template: '\\psi',            label: 'Psi',      icon: 'ψ' },
  omega:       { template: '\\omega',          label: 'Omega',   icon: 'ω'  },
  
  // Advanced & Matrix
  pmatrix2:    { template: '\\begin{pmatrix} ? & ? \\\\ ? & ? \\end{pmatrix}', label: 'Matriks () 2x2', icon: '(■)' },
  pmatrix3:    { template: '\\begin{pmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{pmatrix}', label: 'Matriks () 3x3', icon: '(■³)' },
  bmatrix2:    { template: '\\begin{bmatrix} ? & ? \\\\ ? & ? \\end{bmatrix}', label: 'Matriks [] 2x2', icon: '[■]' },
  bmatrix3:    { template: '\\begin{bmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{bmatrix}', label: 'Matriks [] 3x3', icon: '[■³]' },
  Bmatrix2:    { template: '\\begin{Bmatrix} ? & ? \\\\ ? & ? \\end{Bmatrix}', label: 'Matriks {} 2x2', icon: '{■}' },
  Bmatrix3:    { template: '\\begin{Bmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{Bmatrix}', label: 'Matriks {} 3x3', icon: '{■³}' },
  vmatrix2:    { template: '\\begin{vmatrix} ? & ? \\\\ ? & ? \\end{vmatrix}', label: 'Determinan 2x2', icon: '|■|' },
  vmatrix3:    { template: '\\begin{vmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{vmatrix}', label: 'Determinan 3x3', icon: '|■³|' },
  cases2:      { template: '\\begin{cases} ? & ? \\\\ ? & ? \\end{cases}', label: 'Cases 2 Baris', icon: '{ =' },
  cases3:      { template: '\\begin{cases} ? & ? \\\\ ? & ? \\\\ ? & ? \\end{cases}', label: 'Cases 3 Baris', icon: '{ ≡' },
  text:        { template: '\\text{?}',         label: 'Teks',      icon: 'Aa' },
  equation:    { template: '\\begin{equation}\\end{equation}', label: 'Persamaan', icon: '📐' },
  align:       { template: '\\begin{aligned}\\end{aligned}',   label: 'Align',    icon: '≈' },
} as const;

export type LatexTemplateKey = keyof typeof LATEX_TEMPLATES;

export function stripDelimiters(text: string): string {
  if (!text) return '';
  if (/^\$\$/.test(text)) return text.replace(/^\$\$([\s\S]*?)\$\$$/, '$1');
  if (/^\$/.test(text)) return text.replace(/^\$([^$]*)\$$/, '$1');
  if (/^\\\[/.test(text)) return text.replace(/^\\\[([\s\S]*?)\\\]$/, '$1');
  if (/^\\\(\s/.test(text)) return text.replace(/^\\\(([\s\S]*?)\\\)$/, '$1');
  if (/^\[%/.test(text)) return text.replace(/^\[%([\s\S]*?)%\]$/, '$1');
  return text;
}
