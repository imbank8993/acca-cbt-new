"use client";
import { FunctionSquare } from 'lucide-react';
import { Modal, ModalFooter } from '@/app/components/ui/modal';
import './question-editor-dark.css';
import { Button } from '@/app/components/ui/button';
import React,{ useEffect,useState } from 'react';
import { MathRenderer } from './MathRenderer';
import { MathToolbar } from './MathToolbar';

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
    // Dynamically import mathlive to register <math-field> without breaking Next.js SSR
    import('mathlive').catch((err) => console.error('Failed to load mathlive', err));

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
    <Modal open onClose={onClose} size="xl" className="insertion-modal h-[620px] max-h-[92vh] flex flex-col"
      title="Sisipkan Rumus Matematika" subtitle="Pilih struktur rumus dari toolbar atau tulis kode LaTeX"
      icon={<FunctionSquare size={18} />}>
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
        <ModalFooter>
          <Button
            type="button"
            onClick={onClose}
            variant="cancel"
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (mathInput.trim()) {
                onInsert(mathInput, isMathBlock);
                onClose();
              }
            }}
            disabled={!mathInput.trim()}
            variant="primary"
          >
            Sisipkan Rumus
          </Button>
        </ModalFooter>
    </Modal>
  );
}
