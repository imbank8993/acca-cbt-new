"use client";
/**
 * OrderingForm — Pengurutan
 * Pernyataan disusun dalam urutan benar menggunakan drag-and-drop.
 * Tabel dengan 2 kolom: kolom kiri = pernyataan, kolom kanan = urutan.
 */
import { Plus,Trash2 } from 'lucide-react';
import React,{ useState } from 'react';
import { BaseOption } from '../schema';
import { OptionRichInput } from './OptionRichInput';

interface OrderingFormProps {
  options: BaseOption[];
  correctOrder: string[]; // ordered array of option IDs
  onAddItem: () => void;
  onBulkAdd?: (texts: string[]) => void;
  onRemoveItem: (index: number) => void;
  onUpdateItem: (index: number, fields: Partial<BaseOption>) => void;
  onMoveItem: (from: number, to: number) => void;
  onSetCorrectOrder: (order: string[]) => void;
}

const OrderingForm = React.memo(({
  options,
  onAddItem,
  onBulkAdd,
  onRemoveItem,
  onUpdateItem,
  onMoveItem,
  onSetCorrectOrder,
}: OrderingFormProps) => {

  // ── Move up/down without drag ─────────────────────────────────────────

  // ── Move up/down without drag ─────────────────────────────────────────

  // ── Move up/down without drag ─────────────────────────────────────────

  // ── Sync correct_order when options change ─────────────────────────────

  const handleAdd = (texts: string[]) => {
    if (onBulkAdd) onBulkAdd(texts);
    // After adding, correct_order should be reset to match new options
    setTimeout(() => {
      onSetCorrectOrder(options.map(o => o.id || String(o.order)));
    }, 50);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex gap-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 items-center">
        <div className="w-10 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">No.</div>
        <div className="flex-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pernyataan</div>
        <div className="w-24 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">Urutan</div>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {options.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-400">
            Belum ada pernyataan. Klik &quot;Tambah Pernyataan&quot; untuk menambahkan.
          </div>
        )}

        {options.map((opt, idx) => (
          <OrderingItemRow
            key={opt.id || idx}
            opt={opt}
            idx={idx}
            total={options.length}
            canDelete={options.length > 2}
            onMove={onMoveItem}
            onRemove={() => onRemoveItem(idx)}
            onUpdate={(fields) => onUpdateItem(idx, fields)}
          />
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAddItem}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
        >
          <Plus size={14} />
          Tambah Pernyataan
        </button>
        {onBulkAdd && (
          <button
            type="button"
            onClick={() => {
              const text = window.prompt('Ketik beberapa pernyataan (pisah baris baru):');
              if (text) {
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length > 0) handleAdd(lines);
              }
            }}
            className="px-4 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
          >
            <Plus size={14} />
            Banyak
          </button>
        )}
      </div>
    </div>
  );
});

OrderingForm.displayName = 'OrderingForm';

// ── Single row component ─────────────────────────────────────────────────────

interface OrderingItemRowProps {
  opt: BaseOption;
  idx: number;
  total: number;
  canDelete: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onUpdate: (fields: Partial<BaseOption>) => void;
}

const OrderingItemRow = React.memo(({
  opt, idx, total, canDelete,
  onMove, onRemove, onUpdate,
}: OrderingItemRowProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div
      className={`
        group flex items-center gap-3 p-3
        rounded-lg border-2 transition-all duration-150
        ${isFocused
          ? 'border-slate-800 bg-white shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300'}
      `}
    >
      {/* Left side: Number indicator */}
      <div className="flex flex-col items-center shrink-0 w-10">
        <div className={`
          flex items-center justify-center w-8 h-8 rounded-lg font-black text-sm
          ${idx === 0 ? 'bg-pink-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}
        `}>
          P{idx + 1}
        </div>
      </div>

      {/* Text input */}
      <div className="flex-1 min-w-0">
        <OptionRichInput
          value={opt.text}
          onChange={(text) => onUpdate({ text })}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={`Pernyataan P${idx + 1}...`}
        />
      </div>

      {/* Right side: Order controls & Delete */}
      <div className="flex items-center gap-1.5 shrink-0 w-24 justify-center">
        {/* Order Dropdown */}
        <div className="flex bg-slate-50 border border-slate-200 rounded shadow-sm">
          <select
            value={idx}
            onChange={(e) => onMove(idx, parseInt(e.target.value))}
            className="w-12 h-7 px-1 rounded flex items-center justify-center text-sm font-semibold text-slate-600 bg-transparent outline-none cursor-pointer hover:bg-slate-100 transition-all text-center appearance-none"
            title="Ubah Urutan"
            style={{ textAlignLast: 'center' }}
          >
            {Array.from({ length: total }).map((_, i) => (
              <option key={i} value={i}>{i + 1}</option>
            ))}
          </select>
        </div>

        {/* Delete */}
        {canDelete && (
          <button
            type="button"
            onClick={onRemove}
            className={`w-7 h-7 rounded flex items-center justify-center transition-all text-slate-300 hover:text-rose-500 hover:bg-rose-50 ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            title="Hapus"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

OrderingItemRow.displayName = 'OrderingItemRow';

export { OrderingForm };
