"use client";
import React,{ useCallback,useEffect,useRef,useState } from 'react';
import { renderLatex,sanitizeLatex } from './math-utils';

export const MathRenderer = React.memo(
  ({
    latex,
    displayMode = false,
    editable = false,
    onChange,
    copyable = false,
  }: any) => {
    const [html, setHtml] = useState('');
    const [error, setError] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(latex);

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      const clean = sanitizeLatex(latex);
      const result = renderLatex(clean, displayMode);
      setError(result.error);
      setHtml(result.html);
    }, [latex, displayMode]);

    useEffect(() => {
      if (!isEditing) setValue(latex);
    }, [latex, isEditing]);

    useEffect(() => {
      if (isEditing && textareaRef.current) {
        textareaRef.current.focus();
      }
    }, [isEditing]);

    const handleSave = useCallback(() => {
      const clean = sanitizeLatex(value);
      onChange?.(clean);
      setIsEditing(false);
    }, [value, onChange]);

    // ── Inline math styles ──────────────────────────────────────────────────

    const wrapperStyle: React.CSSProperties = displayMode
      ? { display: 'block', textAlign: 'center', margin: '0.75em 0', overflowX: 'auto' }
      : {
          display: 'inline',
          verticalAlign: 'baseline',
          lineHeight: '1',
          color: 'inherit',
          fontFamily: "'Merriweather', 'Source Serif 4', Georgia, serif",
        };

    const katexContainerStyle: React.CSSProperties = displayMode
      ? { fontFamily: "'Source Serif 4', Georgia, serif" }
      : {
          display: 'inline',
          verticalAlign: 'baseline',
          lineHeight: '1',
          position: 'relative',
          fontFamily: "'Merriweather', 'Source Serif 4', Georgia, serif",
        };

    // ── EDIT MODE ────────────────────────────────────────────────────────────

    if (isEditing) {
      return (
        <span style={{ display: displayMode ? 'block' : 'inline-block' }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleSave}
            style={{
              width: '100%',
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 6,
              fontFamily: 'monospace',
            }}
          />
          <div style={{ marginTop: 6, padding: 6, background: '#f9fafb', borderRadius: 6, minHeight: 32 }}>
            {(() => {
              const r = renderLatex(sanitizeLatex(value), displayMode);
              return r.error ? (
                <span style={{ color: '#f59e0b', fontFamily: 'monospace', fontSize: '0.85em' }}>{value}</span>
              ) : (
                <span dangerouslySetInnerHTML={{ __html: r.html }} />
              );
            })()}
          </div>
        </span>
      );
    }

    // ── VIEW MODE ────────────────────────────────────────────────────────────

    return (
      <span
        onClick={() => editable && setIsEditing(true)}
        style={{
          cursor: editable ? 'pointer' : 'default',
          ...wrapperStyle,
        }}
        className="math-renderer"
      >
        {error ? (
          <span style={{
            color: '#f59e0b',
            fontFamily: 'monospace',
            fontSize: '0.9em',
            background: '#fef3c7',
            padding: '2px 6px',
            borderRadius: '4px',
            display: 'inline',
          }}>
            {latex}
          </span>
        ) : (
          <span
            dangerouslySetInnerHTML={{ __html: html }}
            style={katexContainerStyle}
          />
        )}

        {copyable && (
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(latex); }}
            style={{ marginLeft: 6, fontSize: 10 }}
          >
            Copy
          </button>
        )}
      </span>
    );
  }
);

MathRenderer.displayName = 'MathRenderer';
export default MathRenderer;