"use client";
/**
 * CategorizationForm — Kategorisasi
 * Clean table-style editor for assigning items to categories.
 */
import { AnimatePresence,motion } from 'framer-motion';
import { Plus,Trash2 } from 'lucide-react';
import React,{ useState } from 'react';
import { BaseOption } from '../schema';
import { BulkAddModal } from './AnswerOptionCard';
import { OptionRichInput } from './OptionRichInput';

interface CategorizationFormProps {
  options: BaseOption[];
  categories: string[];
  onAddItem: () => void;
  onBulkAdd?: (texts: string[]) => void;
  onInsertItem: (index: number) => void;
  onRemoveItem: (index: number) => void;
  onUpdateItem: (index: number, text: string) => void;
  onSetCategories: (categories: string[]) => void;
  onSetItemCategory: (optIndex: number, categories: string[]) => void;
}

const CATEGORY_COLORS = [
  { bg: 'bg-violet-500', light: 'bg-violet-100', border: 'border-violet-200', text: 'text-violet-600', ring: 'ring-violet-400' },
  { bg: 'bg-blue-500', light: 'bg-blue-100', border: 'border-blue-200', text: 'text-blue-600', ring: 'ring-blue-400' },
  { bg: 'bg-teal-500', light: 'bg-teal-100', border: 'border-teal-200', text: 'text-teal-600', ring: 'ring-teal-400' },
  { bg: 'bg-[#3083FF]', light: 'bg-blue-100', border: 'border-blue-200', text: 'text-blue-600', ring: 'ring-blue-400' },
  { bg: 'bg-amber-500', light: 'bg-amber-100', border: 'border-amber-200', text: 'text-amber-600', ring: 'ring-amber-400' },
  { bg: 'bg-rose-500', light: 'bg-rose-100', border: 'border-rose-200', text: 'text-rose-600', ring: 'ring-rose-400' },
  { bg: 'bg-indigo-500', light: 'bg-indigo-100', border: 'border-indigo-200', text: 'text-indigo-600', ring: 'ring-indigo-400' },
  { bg: 'bg-cyan-500', light: 'bg-cyan-100', border: 'border-cyan-200', text: 'text-cyan-600', ring: 'ring-cyan-400' },
];// Category edit modal
function CategoryEditModal({
  categories,
  onSave,
  onClose,
}: {
  categories: string[];
  onSave: (cats: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(categories.join(', '));

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
      >
        <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 6h16M4 12h16M4 18h10"/>
              </svg>
            </div>
            <div>
              <h3 className="text-[15px] font-black text-primary uppercase tracking-tight">Edit Kategori</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pisahkan dengan koma</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Kategori 1, Kategori 2, Kategori 3..."
            rows={3}
            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-lg text-sm text-slate-700 outline-none focus:border-primary/30 focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all resize-none"
          />
          {draft.trim() && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {draft.split(',').map(s => s.trim()).filter(Boolean).map((cat, idx) => {
                const c = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                return (
                  <span key={idx} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold ${c.light} ${c.text} border ${c.border} shadow-sm`}>
                    {cat}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
          <button onClick={onClose} className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:text-primary transition-colors rounded-lg hover:bg-primary/5">
            Batal
          </button>
          <button
            onClick={() => {
              onSave(draft.split(',').map(s => s.trim()).filter(Boolean));
              onClose();
            }}
            className="px-6 py-2.5 text-xs font-black bg-primary text-white rounded-lg hover:bg-primary-hover shadow-lg shadow-primary/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            Simpan Kategori
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export const CategorizationForm = React.memo(({
  options,
  categories,
  onAddItem,
  onBulkAdd,
  onInsertItem,
  onRemoveItem,
  onUpdateItem,
  onSetCategories,
  onSetItemCategory,
}: CategorizationFormProps) => {
  const [showCategoryEdit, setShowCategoryEdit] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Category header bar */}
      <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100 overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-2 shrink-0 pl-1">
          <div className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/10">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M4 6h16M4 12h16M4 18h10"/>
            </svg>
          </div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] whitespace-nowrap">Kategori</span>
        </div>

        {categories.length > 0 ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {categories.map((cat, idx) => {
              const c = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
              return (
                <span
                  key={cat}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-black ${c.light} ${c.text} border ${c.border} shrink-0 shadow-sm`}
                >
                  {cat}
                </span>
              );
            })}
            <button
              onClick={() => setShowCategoryEdit(true)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-white hover:bg-primary hover:text-white text-slate-400 transition-all border-2 border-dashed border-slate-200 hover:border-primary/50 shadow-sm"
              title="Edit kategori"
            >
              <Plus size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCategoryEdit(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-[11px] font-black uppercase tracking-wider shadow-lg shadow-primary/20 hover:bg-primary-hover transition-all"
          >
            <Plus size={14} />
            Tambah Kategori
          </button>
        )}
      </div>

      {/* Table — only show if categories exist */}
      {categories.length > 0 && (
        <div className="overflow-x-auto -mx-1 scrollbar-thin scrollbar-thumb-slate-200">
          <table className="w-full min-w-[700px] border-separate border-spacing-y-1">
            {/* Header row */}
            <thead>
              <tr>
                <th className="w-[50%] min-w-[350px] px-1">
                  <div className="px-3 text-left">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Item Pertanyaan</span>
                  </div>
                </th>
                {categories.map((cat, catIdx) => {
                  const c = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];
                  return (
                    <th key={cat} className="w-20 min-w-[80px] px-1">
                      <div className={`rounded-full ${c.bg} text-white px-3 py-1.5 text-center shadow-sm`}>
                        <span className="text-[9px] font-black uppercase tracking-widest truncate block">{cat}</span>
                      </div>
                    </th>
                  );
                })}
                <th className="w-10 px-1"></th>
              </tr>
            </thead>
            <tbody className="before:block before:h-1">
              {options.map((opt, idx) => {
                const assignedCats = opt.category_names || [];
                return (
                  <React.Fragment key={opt.id || idx}>
                    {/* Insert Between - Categorization */}
                    {idx > 0 && (
                      <tr className="h-2 group/insert">
                        <td colSpan={categories.length + 2} className="relative p-0">
                          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-opacity z-10">
                            <button
                              type="button"
                              onClick={() => onInsertItem(idx)}
                              className="bg-white border-2 border-slate-200 text-slate-400 hover:text-primary hover:border-primary w-6 h-6 rounded-full flex items-center justify-center shadow-sm transition-all"
                              title="Sisipkan Item di sini"
                            >
                              <Plus size={12} strokeWidth={3} />
                            </button>
                          </div>
                          <div className="absolute inset-x-10 top-1/2 border-t border-dashed border-slate-100 opacity-0 group-hover/insert:opacity-100 transition-opacity" />
                        </td>
                      </tr>
                    )}
                    <tr className="group">
                      <td className="px-1 py-1">
                        <CategorizationItemRow
                          index={idx + 1}
                          value={opt.text}
                          onChange={(text) => onUpdateItem(idx, text)}
                        />
                      </td>
                      {categories.map((cat, catIdx) => {
                        const c = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];
                        const selected = assignedCats.includes(cat);
                        return (
                          <td key={cat} className="px-1 text-center">
                            <div className="flex justify-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = selected
                                    ? assignedCats.filter((c) => c !== cat)
                                    : [...assignedCats, cat];
                                  onSetItemCategory(idx, next);
                                }}
                                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all transform active:scale-90
                                  ${selected
                                    ? `${c.bg} border-transparent text-white shadow-sm scale-110`
                                    : `bg-white border-slate-200 text-slate-300 hover:border-slate-300 hover:bg-slate-50`
                                  }`}
                              >
                                {selected ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5">
                                    <polyline points="20,6 9,17 4,12"/>
                                  </svg>
                                ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                )}
                              </button>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-1">
                        {options.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onRemoveItem(idx)}
                            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all duration-200"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add item button */}
      <div className="flex gap-3">
        <button
            type="button"
            onClick={onAddItem}
            disabled={categories.length === 0}
            className={`group flex-1 flex items-center justify-center gap-3 py-4 text-sm font-bold rounded-lg border-2 border-dashed transition-all duration-300 ${categories.length === 0 ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-300' : 'border-slate-200 text-slate-400 hover:border-primary/30 hover:text-primary hover:bg-primary/5'}`}
        >
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                <Plus size={18} strokeWidth={3} />
            </div>
            Tambah Item
        </button>

        {onBulkAdd && (
          <button
            type="button"
            onClick={() => setIsBulkModalOpen(true)}
            disabled={categories.length === 0}
            className={`group px-6 flex items-center justify-center gap-3 py-4 text-sm font-bold rounded-lg border-2 border-dashed transition-all duration-300 ${categories.length === 0 ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-300' : 'border-slate-200 text-slate-400 hover:border-primary/30 hover:text-primary hover:bg-primary/5'}`}
          >
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            Banyak
          </button>
        )}
      </div>

      {/* Bulk Add Modal */}
      {onBulkAdd && (
        <BulkAddModal
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          onAdd={onBulkAdd}
          title="Tambah Item Sekaligus"
          placeholder="Ketik atau tempel beberapa item di sini...&#10;Gunakan baris baru untuk memisahkan item."
        />
      )}

      {categories.length === 0 && (
        <div className="p-8 border-2 border-dashed border-slate-100 rounded-lg flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-lg bg-slate-50 flex items-center justify-center text-slate-300 mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6h16M4 12h16M4 18h10"/>
                </svg>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Tambahkan minimal 1 kategori</p>
        </div>
      )}

      {/* Category edit modal */}
      <AnimatePresence>
          {showCategoryEdit && (
            <CategoryEditModal
              categories={categories}
              onSave={onSetCategories}
              onClose={() => setShowCategoryEdit(false)}
            />
          )}
      </AnimatePresence>
    </div>
  );
});

/* ─── CategorizationItemRow ─── */
interface CategorizationItemRowProps {
  index: number;
  value: string;
  onChange: (text: string) => void;
}

const CategorizationItemRow = React.memo(({ index, value, onChange }: CategorizationItemRowProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="group/item relative">
      {/* Input Card */}
      <div className={`
        flex items-center bg-white rounded-lg border-2 transition-all duration-200 px-3 py-0.5
        ${isFocused ? 'border-primary' : 'border-slate-100 hover:border-slate-200'}
      `}>
        {/* Number Badge - Now Inside */}
        <div className={`
          shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-200 mr-1
          ${isFocused ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}
        `}>
          {index}
        </div>

        <div className="flex-1 min-w-0">
          <OptionRichInput
            value={value}
            onChange={onChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={`Item ${index}...`}
            className="text-[13px] font-medium"
          />
        </div>


      </div>


    </div>
  );
});

CategorizationItemRow.displayName = 'CategorizationItemRow';
CategorizationForm.displayName = 'CategorizationForm';
