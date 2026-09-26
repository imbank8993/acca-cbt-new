"use client";
import React, { useState, useEffect } from 'react';
import { Table as TableIcon, Plus, Minus, Trash2, X, Check } from 'lucide-react';

export type TableWidthPreset = 'auto' | '100%' | '75%' | '50%';

export interface TableEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInTable: boolean;
  activeTablePreview?: string;
  onInsertTable: (rows: number, cols: number, withHeader: boolean, width?: string) => void;
  onAddRowBefore: () => void;
  onAddRowAfter: () => void;
  onDeleteRow: () => void;
  onAddColumnBefore: () => void;
  onAddColumnAfter: () => void;
  onDeleteColumn: () => void;
  onApplyTableWidth: (width: string) => void;
  onDeleteTable: () => void;
  currentTableWidth?: { preset: TableWidthPreset; custom: string };
}

export default function TableEditorModal({
  isOpen,
  onClose,
  isInTable,
  activeTablePreview = '',
  onInsertTable,
  onAddRowBefore,
  onAddRowAfter,
  onDeleteRow,
  onAddColumnBefore,
  onAddColumnAfter,
  onDeleteColumn,
  onApplyTableWidth,
  onDeleteTable,
  currentTableWidth,
}: TableEditorModalProps) {
  const [tableRowsInput, setTableRowsInput] = useState(3);
  const [tableColsInput, setTableColsInput] = useState(3);
  const [tableHeaderRow, setTableHeaderRow] = useState(true);
  const [tableWidthPreset, setTableWidthPreset] = useState<TableWidthPreset>('100%');
  const [tableWidthCustom, setTableWidthCustom] = useState<string>('');

  useEffect(() => {
    if (isOpen && currentTableWidth) {
      setTableWidthPreset(currentTableWidth.preset);
      setTableWidthCustom(currentTableWidth.custom);
    }
  }, [isOpen, currentTableWidth]);

  // Keyboard shortcut listener
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!isInTable) {
          handleInsert();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, isInTable, tableRowsInput, tableColsInput, tableHeaderRow, tableWidthPreset, tableWidthCustom]);

  const handleInsert = () => {
    const custom = tableWidthCustom.trim();
    const finalWidth = custom ? custom : tableWidthPreset === 'auto' ? '' : tableWidthPreset;
    onInsertTable(tableRowsInput, tableColsInput, tableHeaderRow, finalWidth);
    onClose();
  };

  const TABLE_WIDTH_PRESETS: { key: TableWidthPreset; label: string }[] = [
    { key: 'auto', label: 'Otomatis' },
    { key: '50%', label: '50%' },
    { key: '75%', label: '75%' },
    { key: '100%', label: '100%' },
  ];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
              <TableIcon size={16} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">
                {isInTable ? 'Kelola & Edit Tabel' : 'Sisipkan Tabel Baru'}
              </h2>
              <p className="text-[11px] text-slate-400 leading-tight">
                {isInTable ? 'Ubah baris, kolom, atau lebar tabel aktif' : 'Atur jumlah baris, kolom, dan baris header'}
              </p>
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
        <div className="p-5 max-h-[75vh] overflow-y-auto">
          {!isInTable ? (
            /* Mode 1: Buat Tabel Baru */
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Kolom Kiri: Input Pengaturan */}
              <div className="md:col-span-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Jumlah Baris</label>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setTableRowsInput((r) => Math.max(1, r - 1))}
                        className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-l-lg text-slate-600 font-bold transition-colors cursor-pointer"
                      >
                        <Minus size={12} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={tableRowsInput}
                        onChange={(e) => setTableRowsInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-12 h-8 text-center border-y border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setTableRowsInput((r) => Math.min(30, r + 1))}
                        className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-r-lg text-slate-600 font-bold transition-colors cursor-pointer"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Jumlah Kolom</label>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setTableColsInput((c) => Math.max(1, c - 1))}
                        className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-l-lg text-slate-600 font-bold transition-colors cursor-pointer"
                      >
                        <Minus size={12} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={tableColsInput}
                        onChange={(e) => setTableColsInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-12 h-8 text-center border-y border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setTableColsInput((c) => Math.min(30, c + 1))}
                        className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-r-lg text-slate-600 font-bold transition-colors cursor-pointer"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={tableHeaderRow}
                      onChange={(e) => setTableHeaderRow(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-700">Baris Header (Teks Tebal & Latar Gelap)</span>
                  </label>
                </div>
              </div>

              {/* Kolom Kanan: Pratinjau Grid */}
              <div className="md:col-span-7 border border-slate-100 bg-slate-50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[160px]">
                <span className="text-[10px] font-bold text-slate-400 uppercase mb-3 block">
                  Pratinjau Struktur ({tableRowsInput} × {tableColsInput})
                </span>
                <div className="w-full max-h-[160px] overflow-auto p-1 bg-white border border-slate-200 rounded-lg shadow-inner">
                  <table className="w-full border-collapse">
                    <tbody>
                      {Array.from({ length: Math.min(6, tableRowsInput) }).map((_, rIdx) => (
                        <tr key={rIdx}>
                          {Array.from({ length: Math.min(6, tableColsInput) }).map((_, cIdx) => {
                            const isHeader = rIdx === 0 && tableHeaderRow;
                            return (
                              <td
                                key={cIdx}
                                className={`border border-slate-200 p-2 text-center text-[10px] transition-all ${
                                  isHeader ? 'bg-blue-50 font-bold text-blue-900' : 'bg-white text-slate-400'
                                }`}
                              >
                                {isHeader ? 'Header' : '—'}
                              </td>
                            );
                          })}
                          {tableColsInput > 6 && (
                            <td className="border border-dashed border-slate-200 p-2 text-center text-[10px] text-slate-400">
                              ...
                            </td>
                          )}
                        </tr>
                      ))}
                      {tableRowsInput > 6 && (
                        <tr>
                          <td
                            colSpan={Math.min(7, tableColsInput + (tableColsInput > 6 ? 1 : 0))}
                            className="border border-dashed border-slate-200 p-1.5 text-center text-[10px] text-slate-400"
                          >
                            ...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* Mode 2: Kelola Tabel Aktif */
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Kolom Kiri: Tombol Aksi Kelola */}
              <div className="md:col-span-5 space-y-4">
                {/* Baris */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-slate-700 block">Baris (Rows)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onAddRowBefore();
                        onClose();
                      }}
                      className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer text-center"
                    >
                      + Di Atas
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAddRowAfter();
                        onClose();
                      }}
                      className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer text-center"
                    >
                      + Di Bawah
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteRow();
                      onClose();
                    }}
                    className="w-full py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold text-red-700 transition-colors cursor-pointer"
                  >
                    Hapus Baris Ini
                  </button>
                </div>

                <div className="w-full h-px bg-slate-100" />

                {/* Kolom */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-slate-700 block">Kolom (Columns)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onAddColumnBefore();
                        onClose();
                      }}
                      className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer text-center"
                    >
                      + Di Kiri
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAddColumnAfter();
                        onClose();
                      }}
                      className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer text-center"
                    >
                      + Di Kanan
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteColumn();
                      onClose();
                    }}
                    className="w-full py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold text-red-700 transition-colors cursor-pointer"
                  >
                    Hapus Kolom Ini
                  </button>
                </div>

                <div className="w-full h-px bg-slate-100" />

                {/* Lebar Tabel */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-slate-700 block">Lebar Tabel</span>
                  <div className="grid grid-cols-4 gap-1">
                    {TABLE_WIDTH_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          setTableWidthPreset(p.key);
                          setTableWidthCustom('');
                        }}
                        className={`py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
                          tableWidthPreset === p.key && !tableWidthCustom
                            ? 'bg-[#030C4D] text-white border-[#030C4D] shadow-xs'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tableWidthCustom}
                      onChange={(e) => setTableWidthCustom(e.target.value)}
                      placeholder="Kustom (misal 500px atau 80%)"
                      className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const custom = tableWidthCustom.trim();
                      const finalWidth = custom ? custom : tableWidthPreset === 'auto' ? '' : tableWidthPreset;
                      onApplyTableWidth(finalWidth);
                      onClose();
                    }}
                    className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    Terapkan Lebar
                  </button>
                </div>
              </div>

              {/* Kolom Kanan: Pratinjau Tabel Aktif */}
              <div className="md:col-span-7 border border-slate-100 bg-slate-50 rounded-xl p-4 flex flex-col items-stretch justify-start min-h-[220px]">
                <span className="text-[10px] font-bold text-slate-400 uppercase mb-3 block text-center">
                  Pratinjau Tabel Terpilih
                </span>

                <div className="flex justify-center flex-1 overflow-auto">
                  {activeTablePreview ? (
                    <div
                      className="tiptap-live-preview max-h-[260px] overflow-auto p-3 bg-white border border-slate-200 rounded-lg shadow-inner"
                      style={(() => {
                        const custom = tableWidthCustom.trim();
                        if (custom) return { width: custom, maxWidth: '100%' };
                        if (tableWidthPreset === 'auto') return { maxWidth: '100%' };
                        return { width: tableWidthPreset, maxWidth: '100%' };
                      })()}
                      dangerouslySetInnerHTML={{ __html: activeTablePreview }}
                    />
                  ) : (
                    <div className="flex items-center justify-center p-6 text-center text-xs text-slate-400 italic">
                      Letakkan kursor di dalam tabel pada editor untuk melihat pratinjau langsung di sini.
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Apakah Anda yakin ingin menghapus seluruh tabel ini?')) {
                      onDeleteTable();
                      onClose();
                    }
                  }}
                  className="mt-4 w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Trash2 size={13} /> Hapus Seluruh Tabel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer font-medium"
          >
            {isInTable ? 'Tutup' : 'Batal'}
          </button>
          {!isInTable && (
            <button
              type="button"
              onClick={handleInsert}
              className="px-5 py-2 text-sm font-semibold bg-[#030C4D] text-white rounded-lg hover:bg-[#0a1a6e] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Check size={16} /> Sisipkan Tabel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
