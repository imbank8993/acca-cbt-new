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
    .replace(/\\placeholder(?:\[[^\]]*\])?\{([^}]*)\}/g, (_, inner) => {
      const trimmed = inner.trim();
      return trimmed ? trimmed : '\\dots';
    })
    .replace(/\\placeholder(?:\[[^\]]*\])?/g, '\\dots')
    .replace(/#\?/g, '\\dots')
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
  } catch {
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
  // ── 1. FRACTION (Pecahan) ──
  fraction:        { template: '\\frac{?}{?}',               label: 'Pecahan Vertikal',   icon: 'a/b' },
  fraction_skewed: { template: '{?}/{?}',                    label: 'Pecahan Miring',     icon: 'a∕b' },
  diff:            { template: '\\frac{dy}{dx}',             label: 'Turunan dy/dx',      icon: 'dy/dx' },
  pdiff:           { template: '\\frac{\\partial y}{\\partial x}', label: 'Turunan Parsial', icon: '∂y/∂x' },
  delta_frac:      { template: '\\frac{\\Delta y}{\\Delta x}', label: 'Delta y/x',        icon: 'Δy/Δx' },

  diff2:           { template: '\\frac{d^2y}{dx^2}',         label: 'Turunan Kedua',      icon: 'd²y/dx²' },

  // ── 2. SCRIPT (Pangkat & Indeks) ──
  superscript:     { template: '?^{?}',                      label: 'Pangkat',            icon: 'x²' },
  subscript:       { template: '?_{?}',                      label: 'Indeks Bawah',       icon: 'x₂' },
  sub_super:       { template: '?_{?}^{?}',                  label: 'Pangkat & Indeks',   icon: 'x₂¹' },
  left_sub_super:  { template: '{}_{?}^{?}?',                label: 'Kiri Sub-Super',     icon: '₂¹x' },
  left_subscript:  { template: '{}_{?}?',                    label: 'Kiri Indeks',        icon: 'ₙx' },
  exp:             { template: 'e^{?}',                      label: 'Eksponensial',       icon: 'eˣ' },

  // ── 3. RADICAL (Akar) ──
  sqrt:            { template: '\\sqrt{?}',                  label: 'Akar Kuadrat',       icon: '√' },
  sqrtn:           { template: '\\sqrt[?]{?}',               label: 'Akar Berderajat n',  icon: 'ⁿ√' },
  sqrt3:           { template: '\\sqrt[3]{?}',               label: 'Akar Kubik',         icon: '∛' },
  sqrt_quad:       { template: '\\sqrt{?^2 + ?^2}',          label: 'Akar Kuadratik',     icon: '√(x²+y²)' },

  // ── 4. INTEGRAL ──
  integral:        { template: '\\int ? \\, d?',             label: 'Integral Tak Tentu', icon: '∫' },
  integral_def:    { template: '\\int_{?}^{?} ? \\, d?',     label: 'Integral Tentu',     icon: '∫ₐᵇ' },
  iint:            { template: '\\iint_{?}^{?} ? \\, d?',    label: 'Integral Ganda Dua', icon: '∬' },
  iiint:           { template: '\\iiint_{?}^{?} ? \\, d?',   label: 'Integral Ganda Tiga',icon: '∭' },
  oint:            { template: '\\oint_{?}^{?} ? \\, d?',    label: 'Integral Kontur',    icon: '∮' },
  oiint:           { template: '\\oiint ? \\, d?',           label: 'Integral Permukaan', icon: '∯' },

  // ── 5. LARGE OPERATOR (Operator Besar) ──
  sum:             { template: '\\sum_{?}^{?}',              label: 'Sigma dengan Batas', icon: 'Σ' },
  sum_simple:      { template: '\\sum',                      label: 'Sigma Sederhana',    icon: '∑' },
  product:         { template: '\\prod_{?}^{?}',             label: 'Produk dengan Batas',icon: 'Π' },
  prod_simple:     { template: '\\prod',                     label: 'Produk Sederhana',   icon: '∏' },
  coprod:          { template: '\\coprod_{?}^{?}',           label: 'Koproduk Batas',     icon: '∐' },
  coprod_simple:   { template: '\\coprod',                   label: 'Koproduk',           icon: '∐' },
  bigcup:          { template: '\\bigcup_{?}^{?}',           label: 'Gabungan Besar',     icon: '⋃' },
  bigcap:          { template: '\\bigcap_{?}^{?}',           label: 'Irisan Besar',       icon: '⋂' },

  // ── 6. BRACKET (Tanda Kurung) ──
  paren:           { template: '\\left( ? \\right)',         label: 'Kurung Biasa',       icon: '( )' },
  bracket:         { template: '\\left[ ? \\right]',         label: 'Kurung Siku',        icon: '[ ]' },
  brace:           { template: '\\left\\{ ? \\right\\}',     label: 'Kurung Kurawal',     icon: '{ }' },
  abs:             { template: '\\left| ? \\right|',         label: 'Nilai Mutlak',       icon: '|x|' },
  norm:            { template: '\\left\\| ? \\right\\|',     label: 'Norma Vektor',       icon: '‖x‖' },
  angle_bracket:   { template: '\\left\\langle ? \\right\\rangle', label: 'Kurung Sudut', icon: '⟨ ⟩' },
  floor:           { template: '\\left\\lfloor ? \\right\\rfloor', label: 'Floor',        icon: '⌊ ⌋' },
  ceil:            { template: '\\left\\lceil ? \\right\\rceil',   label: 'Ceiling',      icon: '⌈ ⌉' },
  binomial:        { template: '\\binom{?}{?}',              label: 'Binomial',           icon: '(ⁿₖ)' },
  bracket_interval:{ template: '\\left[ ?, ? \\right)',      label: 'Interval [a,b)',     icon: '[a,b)' },
  cases2:          { template: '\\begin{cases} ? \\\\ ? \\end{cases}',       label: 'Kasus 2 Baris',      icon: '{ =' },
  cases3:          { template: '\\begin{cases} ? \\\\ ? \\\\ ? \\end{cases}', label: 'Kasus 3 Baris',      icon: '{ ≡' },

  // ── 7. FUNCTION (Fungsi) ──
  sin:             { template: '\\sin ?',                    label: 'Sinus',              icon: 'sin' },
  cos:             { template: '\\cos ?',                    label: 'Cosinus',            icon: 'cos' },
  tan:             { template: '\\tan ?',                    label: 'Tangen',             icon: 'tan' },
  csc:             { template: '\\csc ?',                    label: 'Cosecan',            icon: 'csc' },
  sec:             { template: '\\sec ?',                    label: 'Secan',              icon: 'sec' },
  cot:             { template: '\\cot ?',                    label: 'Cotangen',           icon: 'cot' },
  arcsin:          { template: '\\arcsin ?',                 label: 'Arcsin',             icon: 'asin' },
  arccos:          { template: '\\arccos ?',                 label: 'Arccos',             icon: 'acos' },
  arctan:          { template: '\\arctan ?',                 label: 'Arctan',             icon: 'atan' },
  sinh:            { template: '\\sinh ?',                   label: 'Sinus Hiperbolik',   icon: 'sinh' },
  cosh:            { template: '\\cosh ?',                   label: 'Cosinus Hiperbolik', icon: 'cosh' },
  tanh:            { template: '\\tanh ?',                   label: 'Tangen Hiperbolik',  icon: 'tanh' },

  // ── 8. ACCENT (Aksen & Vektor) ──
  dot:             { template: '\\dot{?}',                   label: 'Dot (Titik)',        icon: 'ẋ' },
  ddot:            { template: '\\ddot{?}',                  label: 'Double Dot',         icon: 'ẍ' },
  dddot:           { template: '\\dddot{?}',                 label: 'Triple Dot',         icon: 'x⃛' },
  hat:             { template: '\\widehat{?}',               label: 'Topi (Hat)',         icon: 'x̂' },
  bar:             { template: '\\overline{?}',              label: 'Garis Atas (Bar)',   icon: 'x̄' },
  vec:             { template: '\\overrightarrow{?}',        label: 'Vektor Panah',       icon: 'x⃗' },
  tilde:           { template: '\\widetilde{?}',             label: 'Tilde',              icon: 'x̃' },
  prime:           { template: '?\'',                        label: 'Prime',              icon: 'x\'' },
  prime2:          { template: '?\'\'',                      label: 'Double Prime',       icon: 'x\'\'' },
  arc:             { template: '\\wideparen{?}',             label: 'Busur',              icon: 'x⌢' },
  underline:       { template: '\\underline{?}',             label: 'Garis Bawah',        icon: 'x̲' },
  overline:        { template: '\\overline{?}',              label: 'Overline',           icon: 'x̅' },

  // ── 9. LIMIT & LOG ──
  limit:           { template: '\\lim_{? \\to ?}',           label: 'Limit',              icon: 'lim' },
  limit_inf:       { template: '\\lim_{? \\to \\infty}',     label: 'Limit Tak Hingga',   icon: 'lim∞' },
  limit_zero:      { template: '\\lim_{? \\to 0}',           label: 'Limit x→0',          icon: 'lim₀' },
  log:             { template: '\\log_{?} ?',                label: 'Logaritma Basis',    icon: 'logₙ' },
  log_simple:      { template: '\\log ?',                    label: 'Log Biasa',          icon: 'log' },
  ln:              { template: '\\ln ?',                     label: 'Ln (Log Natural)',   icon: 'ln' },
  max:             { template: '\\max_{?} ?',                label: 'Maksimum',           icon: 'max' },
  min:             { template: '\\min_{?} ?',                label: 'Minimum',            icon: 'min' },

  // ── 10. MATRIX (Matriks) ──
  bmatrix2:        { template: '\\begin{bmatrix} ? & ? \\\\ ? & ? \\end{bmatrix}', label: 'Matriks [] 2x2', icon: '[■]' },
  pmatrix2:        { template: '\\begin{pmatrix} ? & ? \\\\ ? & ? \\end{pmatrix}', label: 'Matriks () 2x2', icon: '(■)' },
  Bmatrix2:        { template: '\\begin{Bmatrix} ? & ? \\\\ ? & ? \\end{Bmatrix}', label: 'Matriks {} 2x2', icon: '{■}' },
  vmatrix2:        { template: '\\begin{vmatrix} ? & ? \\\\ ? & ? \\end{vmatrix}', label: 'Determinan 2x2', icon: '|■|' },
  bmatrix3:        { template: '\\begin{bmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{bmatrix}', label: 'Matriks [] 3x3', icon: '[■³]' },
  pmatrix3:        { template: '\\begin{pmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{pmatrix}', label: 'Matriks () 3x3', icon: '(■³)' },
  Bmatrix3:        { template: '\\begin{Bmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{Bmatrix}', label: 'Matriks {} 3x3', icon: '{■³}' },
  vmatrix3:        { template: '\\begin{vmatrix} ? & ? & ? \\\\ ? & ? & ? \\\\ ? & ? & ? \\end{vmatrix}', label: 'Determinan 3x3', icon: '|■³|' },
  vec_row:         { template: '\\begin{pmatrix} ? & ? \\end{pmatrix}',             label: 'Vektor Baris',   icon: '(■ ■)' },
  vec_col:         { template: '\\begin{pmatrix} ? \\\\ ? \\end{pmatrix}',           label: 'Vektor Kolom',   icon: '(■/■)' },

  // ── 11. OPERATOR & RELASI ──
  pm:              { template: '\\pm',                       label: 'Plus Minus',         icon: '±' },
  mp:              { template: '\\mp',                       label: 'Minus Plus',         icon: '∓' },
  times:           { template: '\\times',                   label: 'Kali',               icon: '×' },
  div:             { template: '\\div',                     label: 'Bagi',               icon: '÷' },
  cdot:            { template: '\\cdot',                    label: 'Titik Perkalian',    icon: '·' },
  neq:             { template: '\\neq',                     label: 'Tidak Sama Dengan',  icon: '≠' },
  leq:             { template: '\\leq',                     label: 'Kurang Dari Sama',   icon: '≤' },
  geq:             { template: '\\geq',                     label: 'Lebih Dari Sama',    icon: '≥' },
  approx:          { template: '\\approx',                 label: 'Kira-kira / Hampir', icon: '≈' },
  equiv:           { template: '\\equiv',                  label: 'Ekuivalen',          icon: '≡' },
  sim:             { template: '\\sim',                    label: 'Serupa',             icon: '∼' },
  propto:          { template: '\\propto',                 label: 'Proporsional',       icon: '∝' },
  arrow_right:     { template: '\\to',                     label: 'Panah Kanan',        icon: '→' },
  arrow_left:      { template: '\\leftarrow',              label: 'Panah Kiri',         icon: '←' },
  arrow_lr:        { template: '\\leftrightarrow',         label: 'Panah Bolak-balik',  icon: '↔' },
  arrow_dright:    { template: '\\Rightarrow',             label: 'Maka / Implikasi',   icon: '⇒' },
  arrow_dlr:       { template: '\\Leftrightarrow',         label: 'Jika dan Hanya Jika',icon: '⇔' },

  // ── 12. SIMBOL MATEMATIKA, LOGIKA & GEOMETRI ──
  infinity:        { template: '\\infty',                   label: 'Tak Hingga',         icon: '∞' },
  partial:         { template: '\\partial',                label: 'Parsial',            icon: '∂' },
  nabla:           { template: '\\nabla',                  label: 'Nabla / Del',        icon: '∇' },
  forall:          { template: '\\forall',                  label: 'Untuk Semua',        icon: '∀' },
  exists:          { template: '\\exists',                  label: 'Ada / Terdapat',     icon: '∃' },
  nexists:         { template: '\\nexists',                 label: 'Tidak Ada',          icon: '∄' },
  in:              { template: '\\in',                      label: 'Elemen Dari',        icon: '∈' },
  notin:           { template: '\\notin',                   label: 'Bukan Elemen',       icon: '∉' },
  subset:          { template: '\\subset',                  label: 'Subset',             icon: '⊂' },
  supset:          { template: '\\supset',                  label: 'Superset',           icon: '⊃' },
  subseteq:        { template: '\\subseteq',                label: 'Subset atau Sama',   icon: '⊆' },
  supseteq:        { template: '\\supseteq',                label: 'Superset atau Sama', icon: '⊇' },
  cup:             { template: '\\cup',                     label: 'Gabungan (Union)',   icon: '∪' },
  cap:             { template: '\\cap',                     label: 'Irisan (Intersek)',  icon: '∩' },
  emptyset:        { template: '\\emptyset',                label: 'Himpunan Kosong',    icon: '∅' },
  degree:          { template: '?^{\\circ}',                label: 'Derajat',            icon: '°' },
  angle:           { template: '\\angle',                   label: 'Sudut',              icon: '∠' },
  perp:            { template: '\\perp',                    label: 'Tegak Lurus',        icon: '⊥' },
  parallel:        { template: '\\parallel',                label: 'Sejajar',            icon: '∥' },
  triangle:        { template: '\\triangle',                label: 'Segitiga',           icon: '△' },
  circle:          { template: '\\odot',                    label: 'Titik Tengah Lingk.',icon: '⊙' },
  square:          { template: '\\square',                  label: 'Persegi',            icon: '□' },

  // ── 13. HURUF YUNANI (GREEK) ──
  alpha:           { template: '\\alpha',                   label: 'Alpha',              icon: 'α' },
  beta:            { template: '\\beta',                    label: 'Beta',               icon: 'β' },
  gamma:           { template: '\\gamma',                   label: 'Gamma',              icon: 'γ' },
  delta:           { template: '\\delta',                   label: 'Delta',              icon: 'δ' },
  epsilon:         { template: '\\epsilon',                 label: 'Epsilon',            icon: 'ε' },
  zeta:            { template: '\\zeta',                    label: 'Zeta',               icon: 'ζ' },
  eta:             { template: '\\eta',                     label: 'Eta',                icon: 'η' },
  theta:           { template: '\\theta',                   label: 'Theta',              icon: 'θ' },
  iota:            { template: '\\iota',                    label: 'Iota',               icon: 'ι' },
  kappa:           { template: '\\kappa',                   label: 'Kappa',              icon: 'κ' },
  lambda:          { template: '\\lambda',                  label: 'Lambda',             icon: 'λ' },
  mu:              { template: '\\mu',                      label: 'Mu',                 icon: 'μ' },
  nu:              { template: '\\nu',                      label: 'Nu',                 icon: 'ν' },
  xi:              { template: '\\xi',                      label: 'Xi',                 icon: 'ξ' },
  pi:              { template: '\\pi',                      label: 'Pi',                 icon: 'π' },
  rho:             { template: '\\rho',                     label: 'Rho',                icon: 'ρ' },
  sigma:           { template: '\\sigma',                   label: 'Sigma',              icon: 'σ' },
  tau:             { template: '\\tau',                     label: 'Tau',                icon: 'τ' },
  upsilon:         { template: '\\upsilon',                 label: 'Upsilon',            icon: 'υ' },
  phi:             { template: '\\phi',                     label: 'Phi',                icon: 'φ' },
  chi:             { template: '\\chi',                     label: 'Chi',                icon: 'χ' },
  psi:             { template: '\\psi',                     label: 'Psi',                icon: 'ψ' },
  omega:           { template: '\\omega',                   label: 'Omega',              icon: 'ω' },
  Gamma:           { template: '\\Gamma',                   label: 'Gamma Kapital',      icon: 'Γ' },
  Delta:           { template: '\\Delta',                   label: 'Delta Kapital',      icon: 'Δ' },
  Theta:           { template: '\\Theta',                   label: 'Theta Kapital',      icon: 'Θ' },
  Lambda:          { template: '\\Lambda',                  label: 'Lambda Kapital',     icon: 'Λ' },
  Xi:              { template: '\\Xi',                      label: 'Xi Kapital',         icon: 'Ξ' },
  Pi:              { template: '\\Pi',                      label: 'Pi Kapital',         icon: 'Π' },
  Sigma:           { template: '\\Sigma',                   label: 'Sigma Kapital',      icon: 'Σ' },
  Phi:             { template: '\\Phi',                     label: 'Phi Kapital',        icon: 'Φ' },
  Psi:             { template: '\\Psi',                     label: 'Psi Kapital',        icon: 'Ψ' },
  Omega:           { template: '\\Omega',                   label: 'Omega Kapital',      icon: 'Ω' },

  // General Text
  text:            { template: '\\text{?}',                 label: 'Teks Biasa',         icon: 'Aa' },
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
