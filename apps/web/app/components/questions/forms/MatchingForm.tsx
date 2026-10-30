"use client";
/**
 * MatchingForm — Menjodohkan (matching left items with right items)
 * Clean card-style columns.
 */
import { ChevronDown,Link2,Trash2 } from 'lucide-react';
import React,{ useEffect,useRef,useState } from 'react';
import { extractMathExpressions,renderLatex } from '../math-utils';
import { BaseOption } from '../schema';
import { EquationDialog,TableDialog } from './AnswerOptionCard';
import { RichInput } from './RichInput';

/* ─── Inline math label: renders $...$ as KaTeX for the pairing UI ───
 * The KaTeX markup comes from our own renderLatex; the surrounding text
 * segments are HTML-stripped and escaped, so this is safe to inject. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
function renderInlineMath(raw: string): string {
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

const InlineMathLabel = React.memo(({ text, fallback, className }: { text: string; fallback: string; className?: string }) => {
  const [ready, setReady] = useState(false);
  const [html, setHtml] = useState('');
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    try { setHtml(renderInlineMath(text)); } catch { setHtml(''); }
  }, [text, ready]);

  const plain = stripTags(text || '').trim() || fallback;
  if (!ready || !html) return <>{plain}</>;
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
InlineMathLabel.displayName = 'InlineMathLabel';

interface MatchingFormProps {
  options: BaseOption[]; // left items
  rightItems: string[];
  onAddLeftItem: () => void;
  onRemoveLeftItem: (index: number) => void;
  onUpdateLeftItem: (index: number, text: string) => void;
  onAddRightItem: () => void;
  onRemoveRightItem: (index: number) => void;
  onUpdateRightItem: (index: number, text: string) => void;
  onSetLeftMatch: (optIndex: number, rightTexts: string[]) => void;
}

export const MatchingForm = React.memo(({
  options,
  rightItems,
  onAddLeftItem,
  onRemoveLeftItem,
  onUpdateLeftItem,
  onAddRightItem,
  onRemoveRightItem,
  onUpdateRightItem,
  onSetLeftMatch,
}: MatchingFormProps) => {
  return (
    <div className="space-y-2">
      {/* Two columns */}
      <div className="grid grid-cols-2 gap-2">
        <MatchingColumn
          label="Kolom Kiri"
          items={options.map((opt, idx) => ({ key: opt.id || idx, idx, text: opt.text }))}
          onTextChange={onUpdateLeftItem}
          onDelete={onRemoveLeftItem}
          onAdd={onAddLeftItem}
          canDelete={options.length > 2}
        />
        <MatchingColumn
          label="Kolom Kanan"
          items={rightItems.map((item, idx) => ({ key: idx, idx, text: item }))}
          onTextChange={onUpdateRightItem}
          onDelete={onRemoveRightItem}
          onAdd={onAddRightItem}
          canDelete={rightItems.length > 2}
        />
      </div>

      {/* Pairing section */}
      {options.length > 0 && rightItems.filter(r => r.trim()).length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Pasangkan Jawaban</p>
          <div className="space-y-1">
            {options.map((opt, idx) => {
              const selectedMatches = opt.match_texts || [];
              const availableRight = rightItems.filter(r => r.trim());
              return (
                <PairingRow
                  key={opt.id || idx}
                  leftLabel={opt.text || ''}
                  leftFallback={`Item ${idx + 1}`}
                  selectedMatches={selectedMatches}
                  rightItems={availableRight}
                  onToggle={(rightText) => {
                    const next = selectedMatches.includes(rightText)
                      ? selectedMatches.filter(m => m !== rightText)
                      : [...selectedMatches, rightText];
                    onSetLeftMatch(idx, next);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

MatchingForm.displayName = 'MatchingForm';

/* ─── PairingRow ─── */
interface PairingRowProps {
  leftLabel: string;
  leftFallback: string;
  selectedMatches: string[];
  rightItems: string[];
  onToggle: (rightText: string) => void;
}

const PairingRow = React.memo(({ leftLabel, leftFallback, selectedMatches, rightItems, onToggle }: PairingRowProps) => {
  const [open, setOpen] = useState(false);
  const hasMatch = selectedMatches.length > 0;

  return (
    <div className="flex items-center gap-1.5 p-1.5 bg-white rounded border border-slate-200 hover:border-slate-300 transition-all">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-700 truncate">
          <InlineMathLabel text={leftLabel} fallback={leftFallback} />
        </p>
      </div>
      <Link2 size={11} className="shrink-0 text-slate-300" />
      <div className="relative flex-1 min-w-0">
        <button type="button" onClick={() => setOpen(o => !o)}
          className={`w-full flex items-center justify-between gap-1 px-1.5 py-1 rounded border text-[11px] transition-all ${hasMatch ? 'border-blue-200 bg-blue-50 text-blue-700 font-medium' : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300 hover:bg-white'}`}>
          <span className="truncate">
            {hasMatch
              ? selectedMatches.map((m, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && ', '}
                    <InlineMathLabel text={m} fallback={`Item ${i + 1}`} />
                  </React.Fragment>
                ))
              : 'Pilih...'}
          </span>
          <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded shadow-lg z-50 overflow-hidden">
            {rightItems.map((item, i) => {
              const isSelected = selectedMatches.includes(item);
              return (
                <button key={i} type="button"
                  onClick={() => { onToggle(item); setOpen(false); }}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-slate-50 ${isSelected ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}>
                  <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-[#3083FF] border-blue-500' : 'border-slate-300'}`}>
                    {isSelected && <svg width="5" height="5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                  <InlineMathLabel text={item} fallback={`Item ${i + 1}`} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

PairingRow.displayName = 'PairingRow';

/* ─── MatchingColumn ─── */
interface MatchItem { key: React.Key; idx: number; text: string; }
interface MatchingColumnProps {
  label: string;
  items: MatchItem[];
  onTextChange: (idx: number, text: string) => void;
  onDelete: (idx: number) => void;
  onAdd: () => void;
  canDelete: boolean;
}

const MatchingColumn = React.memo(({ label, items, onTextChange, onDelete, onAdd, canDelete }: MatchingColumnProps) => {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</span>
        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">{items.length}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <MatchingItemRow
            key={item.key}
            index={item.idx + 1}
            value={item.text}
            onChange={(text) => onTextChange(item.idx, text)}
            onDelete={canDelete ? () => onDelete(item.idx) : undefined}
          />
        ))}
      </div>
      <button type="button" onClick={onAdd}
        className="group w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold rounded-lg border border-dashed border-slate-200 text-slate-400 hover:border-primary/30 hover:text-primary transition-all">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Tambah
      </button>
    </div>
  );
});
MatchingColumn.displayName = 'MatchingColumn';

/* ─── MatchingItemRow — single line card ─── */
interface MatchingItemRowProps {
  index: number;
  value: string;
  onChange: (text: string) => void;
  onDelete?: () => void;
}

const MatchingItemRow = React.memo(({ index, value, onChange, onDelete }: MatchingItemRowProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showEquation, setShowEquation] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = (text: string) => {
    const ta = inputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newValue = value.slice(0, start) + text + value.slice(end);
    onChange(newValue);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    }, 0);
  };

  const handleInsertEquation = (latex: string) => {
    insertAtCursor(`$${latex}$`);
  };

  const handleInsertTable = (rows: number, cols: number) => {
    let table = '\n';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        table += (c > 0 ? '\t' : '') + `Cell ${r + 1},${c + 1}`;
      }
      table += '\n';
    }
    insertAtCursor(table);
  };

  return (
    <div className="group relative flex items-center gap-1.5">
      {/* Letter Badge - Outside */}
      <div className={`
        shrink-0 flex items-center justify-center w-6 h-6 rounded text-[11px] font-black transition-all duration-200
        ${isFocused ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'}
      `}>
        {index}
      </div>

      {/* Text Input - Full width card */}
      <div className={`
        flex-1 flex items-center rounded border transition-all duration-200
        ${isFocused ? 'border-primary bg-white' : 'border-slate-200 bg-white hover:border-slate-300'}
      `}>
        {/* Left accent */}
        <div className={`
          w-1 h-full shrink-0 rounded-l transition-all duration-200
          ${isFocused ? 'bg-primary' : 'bg-transparent'}
        `} />

        {/* Text Input */}
        <div className="flex-1 min-w-0 px-2 py-1.5">
          <RichInput
            inputRef={inputRef}
            value={value}
            onChange={onChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={`Item ${index}...`}
          />
        </div>

        {/* Toolbar */}
        <div className="shrink-0 px-2 py-2 flex items-center gap-1">
          {/* Equation */}
          <button type="button"
              onClick={(e) => { e.stopPropagation(); setShowEquation(true); }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Sisipkan Rumus">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v3h3"/>
              </svg>
          </button>

          {/* Table */}
          <button type="button"
              onClick={(e) => { e.stopPropagation(); setShowTable(true); }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Sisipkan Tabel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
          </button>
        </div>
      </div>

      {/* Delete - Outside */}
      {onDelete && (
        <button type="button" onClick={onDelete}
          className={`
            shrink-0 flex items-center justify-center w-6 h-6 rounded transition-all duration-200
            ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}
            text-slate-400 hover:text-error hover:bg-error/10
          `}
          title="Hapus"
        >
          <Trash2 size={11} />
        </button>
      )}

      {/* Dialogs */}
      <EquationDialog
        isOpen={showEquation}
        onClose={() => setShowEquation(false)}
        onInsert={handleInsertEquation}
      />
      <TableDialog
        isOpen={showTable}
        onClose={() => setShowTable(false)}
        onInsert={handleInsertTable}
      />
    </div>
  );
});

MatchingItemRow.displayName = 'MatchingItemRow';
