"use client";
import React, { useState, useEffect } from 'react';
import { FunctionSquare, X } from 'lucide-react';
import { MathToolbar } from './MathToolbar';
import { MathRenderer } from './MathRenderer';

export interface MathEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (latex: string, isBlock: boolean) => void;
  initialLatex?: string;
  initialIsBlock?: boolean;
}

interface MathfieldTarget extends HTMLElement {
  value: string;
  executeCommand: (cmd: unknown[]) => void;
  placeholderSymbol?: string;
}

export default function MathEditorModal(props: MathEditorModalProps) {
  if (!props.isOpen) return null;
  return <MathEditorModalContent key={props.initialLatex} {...props} />;
}

function MathEditorModalContent({
  onClose,
  onInsert,
  initialLatex = '',
  initialIsBlock = false,
}: MathEditorModalProps) {
  const [mathEditorMode, setMathEditorMode] = useState<'visual' | 'latex'>('visual');
  const [mathInput, setMathInput] = useState(initialLatex);
  const [isMathBlock, setIsMathBlock] = useState(initialIsBlock);

  // Keyboard shortcut listener (Escape to close, Ctrl+Enter to apply)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (mathInput.trim()) {
          onInsert(mathInput, isMathBlock);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mathInput, isMathBlock, onInsert, onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[620px] max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center border border-amber-500/30">
              <FunctionSquare size={16} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">Sisipkan Rumus Matematika</h2>
              <p className="text-[11px] text-slate-400 leading-tight">Pilih struktur rumus dari toolbar atau tulis kode LaTeX</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            title="Tutup"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Left: Templates Toolbar */}
          <div className="w-full md:w-72 shrink-0 border-r border-slate-100 overflow-y-auto bg-slate-50/40 p-3">
            <MathToolbar
              onInsert={(latex) => {
                if (mathEditorMode === 'visual') {
                  const mf = document.getElementById('mf-editor-modal') as MathfieldTarget | null;
                  if (mf) {
                    const liveLatex = latex.replace(/\?/g, '#?');
                    mf.executeCommand(['insert', liveLatex]);
                    setMathInput(mf.value);
                  }
                } else {
                  const plainLatex = latex.replace(/\?/g, '\\dots');
                  setMathInput((prev) => prev + plainLatex);
                }
              }}
            />
          </div>

          {/* Right: Editor & Live Preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toggles */}
            <div className="px-5 pt-4 flex items-center justify-between gap-3 flex-wrap shrink-0">
              <div className="flex bg-slate-100 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMathEditorMode('visual')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    mathEditorMode === 'visual'
                      ? 'bg-white text-slate-800 shadow-xs'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  Visual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMathInput((prev) =>
                      prev
                        .replace(/\\placeholder(?:\[[^\]]*\])?\{([^}]*)\}/g, (_, inner) => inner.trim() || '\\dots')
                        .replace(/\\placeholder(?:\[[^\]]*\])?/g, '\\dots')
                        .replace(/#\?/g, '\\dots')
                    );
                    setMathEditorMode('latex');
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    mathEditorMode === 'latex'
                      ? 'bg-white text-slate-800 shadow-xs'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  LaTeX
                </button>
              </div>

              <div className="flex bg-slate-100 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setIsMathBlock(false)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    !isMathBlock
                      ? 'bg-white text-slate-800 shadow-xs'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  Inline
                </button>
                <button
                  type="button"
                  onClick={() => setIsMathBlock(true)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    isMathBlock
                      ? 'bg-white text-slate-800 shadow-xs'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  Block
                </button>
              </div>
            </div>

            {/* Input Area */}
            <div className="px-5 pt-3 shrink-0">
              {mathEditorMode === 'visual' ? (
                <div className="w-full min-h-[110px] p-3 border border-slate-200 rounded-xl focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-50 bg-white transition-all">
                  <style>{`
                    #mf-editor-modal::part(menu-toggle) { display: none !important; }
                    #mf-editor-modal::part(virtual-keyboard-toggle) { display: none !important; }
                    #mf-editor-modal { --placeholder-color: transparent; --placeholder-opacity: 1; --prompt-background-color: #f8fafc; }
                    #mf-editor-modal::part(prompt) { border: 1px dashed #94a3b8 !important; background-color: #f1f5f9 !important; border-radius: 2px !important; min-width: 0.8em; min-height: 1em; margin: 0 1px; }
                    #mf-editor-modal::part(placeholder) { border: 1px dashed #94a3b8 !important; background-color: #f1f5f9 !important; border-radius: 2px !important; }
                  `}</style>
                  {/* @ts-expect-error math-field is a custom web component */}
                  <math-field
                    id="mf-editor-modal"
                    style={{ width: '100%', fontSize: '1.3rem', padding: '4px', outline: 'none' }}
                    onInput={(e: React.FormEvent<HTMLElement>) => {
                      const target = e.target as MathfieldTarget;
                      let val = target.value;
                      const originalVal = val;
                      val = val
                        .replace(/\\overrightarrow\{\}/g, '\\overrightarrow{\\placeholder{}}')
                        .replace(/\\widehat\{\}/g, '\\widehat{\\placeholder{}}')
                        .replace(/\\overline\{\}/g, '\\overline{\\placeholder{}}')
                        .replace(/\\wideparen\{\}/g, '\\wideparen{\\placeholder{}}')
                        .replace(/\\underline\{\}/g, '\\underline{\\placeholder{}}');
                      if (val !== originalVal) {
                        target.value = val;
                        target.executeCommand(['moveToNextPlaceholder']);
                      }
                      setMathInput(val);
                    }}
                    ref={(el: unknown) => {
                      const target = el as MathfieldTarget | null;
                      if (target) {
                        if (target.value !== mathInput) target.value = mathInput;
                        target.placeholderSymbol = '⬚';
                      }
                    }}
                  >
                    {/* @ts-expect-error math-field close tag */}
                  </math-field>
                </div>
              ) : (
                <textarea
                  value={mathInput}
                  onChange={(e) => setMathInput(e.target.value)}
                  placeholder="\\frac{a}{b} + x^2"
                  autoFocus
                  className="w-full h-28 p-3 bg-white border border-slate-200 rounded-xl text-sm font-mono text-slate-700 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-50 transition-all resize-none placeholder:text-slate-300"
                />
              )}
            </div>

            {/* KaTeX Preview */}
            <div className="px-5 pt-3 pb-4 flex-1 flex flex-col min-h-0">
              <div
                className={`rounded-xl flex-1 min-h-[140px] p-4 flex items-center justify-center overflow-auto transition-all ${
                  mathInput.trim()
                    ? 'bg-slate-50 border border-slate-200'
                    : 'bg-slate-50/50 border border-dashed border-slate-200'
                }`}
              >
                {mathInput.trim() ? (
                  <MathRenderer latex={mathInput} displayMode={isMathBlock} />
                ) : (
                  <span className="text-xs text-slate-300 italic">Pratinjau Rumus</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer font-medium"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => {
              if (mathInput.trim()) {
                onInsert(mathInput, isMathBlock);
                onClose();
              }
            }}
            disabled={!mathInput.trim()}
            className="px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
          >
            Sisipkan Rumus
          </button>
        </div>
      </div>
    </div>
  );
}
