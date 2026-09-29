"use client";
import DOMPurify from 'dompurify';
import React,{ useEffect,useState } from 'react';
import { extractMathExpressions,renderLatex } from './math-utils';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Author-supplied question/option HTML is rich text and is rendered via
// dangerouslySetInnerHTML, so it must be sanitised to prevent stored XSS
// (<script>, onerror=, javascript: URLs, etc.). We keep the tags/attributes the
// app legitimately relies on: video-embed placeholders (data-*), iframes for
// legacy embeds, and inline styles/classes for alignment. Sanitising happens
// BEFORE math rendering so KaTeX's own generated markup is never stripped.
const SANITIZE_CONFIG = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'target'],
};

function processContentClientSide(rawText: string): string {
  if (!rawText) return '';

  const clean = DOMPurify.sanitize(rawText, SANITIZE_CONFIG);

  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, 'text/html');

  // Process raw text nodes for $...$, $...$, etc.
  const walk = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Node[] = [];
  let n: Node | null;
  while ((n = walk.nextNode())) {
    const pn = n.parentNode as Node | null;
    if (!pn) continue;
    const pnName = pn.nodeName;
    if (pnName === 'SCRIPT' || pnName === 'STYLE') continue;
    textNodes.push(n);
  }

  textNodes.forEach((node) => {
    const text = node.nodeValue || '';
    if (!text.trim()) return;

    const expressions = extractMathExpressions(text);
    if (expressions.length === 0) return;

    const fragment = document.createDocumentFragment();
    let lastEnd = 0;

    expressions.forEach((expr) => {
      if (expr.start > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, expr.start)));
      }
      const result = renderLatex(expr.latex, expr.displayMode);
      const span = document.createElement('span');
      span.className = expr.displayMode ? 'katex-block' : 'katex-inline';
      span.innerHTML = result.error
        ? `<span style="color:#cc0000;font-family:monospace">${escapeHtml(expr.original)}</span>`
        : result.html;
      fragment.appendChild(span);
      lastEnd = expr.end;
    });

    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    if (node.parentNode) {
      node.parentNode.replaceChild(fragment, node);
    }
  });

  return doc.body.innerHTML;
}

interface LatexRendererProps {
  text: string;
  className?: string;
  editable?: boolean;
  onChange?: (text: string) => void;
}

export const LatexRenderer = React.memo(({ text, className = '' }: LatexRendererProps) => {
  const [isClient, setIsClient] = useState(false);
  const [processedHtml, setProcessedHtml] = useState('');

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !text) {
      setProcessedHtml('');
      return;
    }
    try {
      const processed = processContentClientSide(text);
      setProcessedHtml(processed);
    } catch (err) {
      console.error('[LatexRenderer] process error:', err);
      setProcessedHtml(text);
    }
  }, [text, isClient]);

  if (!isClient) {
    return (
      <div className={`latex-renderer ${className}`} style={WRAPPER_STYLE}>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-slate-100 rounded w-3/4" />
          <div className="h-4 bg-slate-100 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!text) return null;

  return (
    <div
      className={`latex-renderer ${className}`}
      style={WRAPPER_STYLE}
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
});

const WRAPPER_STYLE: React.CSSProperties = {
  color: 'inherit',
  overflowWrap: 'break-word',
  fontFamily: "'Merriweather', 'Source Serif 4', Georgia, serif",
  fontSize: '13.5px',
  lineHeight: '1.6',
  textRendering: 'optimizeLegibility',
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
};

LatexRenderer.displayName = 'LatexRenderer';
export default LatexRenderer;
