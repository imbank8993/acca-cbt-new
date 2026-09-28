"use client";
/**
 * InlineMath — renders `$...$` LaTeX inline for small labels/badges (matching
 * pair chips, question-list cards, etc.) where the heavy LatexRenderer wrapper
 * (serif font, fixed 15px, loading skeleton) is inappropriate.
 *
 * Safe to inject: KaTeX markup comes from our own renderLatex; text segments
 * are HTML-stripped and escaped. Uses the shared extractMathExpressions, so
 * every `$...$` pair is treated as a math delimiter here too.
 */
import React,{ useEffect,useState } from 'react';
import { extractMathExpressions,renderLatex } from './math-utils';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
function build(raw: string): string {
  const text = raw || '';
  const exprs = extractMathExpressions(text);
  if (exprs.length === 0) return escapeText(stripTags(text));
  let html = '';
  let last = 0;
  for (const e of exprs) {
    if (e.start > last) html += escapeText(stripTags(text.slice(last, e.start)));
    const r = renderLatex(e.latex, false);
    html += r.error ? escapeText(e.original) : r.html;
    last = e.end;
  }
  if (last < text.length) html += escapeText(stripTags(text.slice(last)));
  return html;
}

interface InlineMathProps {
  text: string;
  fallback?: string;
  className?: string;
}

export const InlineMath = React.memo(({ text, fallback = '', className }: InlineMathProps) => {
  const [ready, setReady] = useState(false);
  const [html, setHtml] = useState('');
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    try { setHtml(build(text)); } catch { setHtml(''); }
  }, [text, ready]);

  const plain = stripTags(text || '').trim() || fallback;
  // Neutralise inherited text-transform/letter-spacing so math variables (e.g.
  // the "x" in $x^2$) are not uppercased or spaced by badge styling.
  if (!ready || !html) {
    return <span style={{ textTransform: 'none', letterSpacing: 'normal' }}>{plain}</span>;
  }
  return (
    <span
      className={className}
      style={{ textTransform: 'none', letterSpacing: 'normal' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
InlineMath.displayName = 'InlineMath';
export default InlineMath;
