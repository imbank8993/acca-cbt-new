"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2, PieChart, LineChart, Plus, Trash2, X, Check } from 'lucide-react';

export interface ChartEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (chartHTML: string) => void;
}

export default function ChartEditorModal(props: ChartEditorModalProps) {
  if (!props.isOpen) return null;
  return <ChartEditorModalContent {...props} />;
}

function ChartEditorModalContent({
  onClose,
  onInsert,
}: ChartEditorModalProps) {
  const [chartType, setChartType] = useState<'bar' | 'pie' | 'line'>('bar');
  const [chartData, setChartData] = useState({
    labels: ['A', 'B', 'C', 'D'],
    datasets: [{
      label: 'Data',
      data: [12, 19, 8, 15],
      backgroundColor: ['#3083FF', '#3083FF', '#10b981', '#ef4444'],
      borderColor: ['#3083FF', '#3083FF', '#10b981', '#ef4444'],
      borderWidth: 1,
    }],
  });

  const handleInsert = useCallback(() => {
    const maxVal = Math.max(1, ...chartData.datasets[0].data);
    const chartHTML = `
      <div class="chart-container" style="width:100%;max-width:500px;margin:1rem auto;padding:1rem;background:#f8fafc;border-radius:0.75rem;border:1px solid #e2e8f0;text-align:center">
        <h4 style="font-weight:bold;margin-bottom:0.75rem;font-size:0.875rem;color:#1e293b">Grafik Data (${chartType.toUpperCase()})</h4>
        <div style="display:flex;align-items:flex-end;justify-content:center;gap:0.75rem;height:140px;padding:0.5rem;background:#ffffff;border-radius:0.5rem;border:1px dashed #cbd5e1">
          ${chartData.labels.map((l, i) => `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem;flex:1;max-width:44px">
              <div style="width:100%;height:${Math.max(8, (chartData.datasets[0].data[i] / maxVal) * 100)}%;background:${chartData.datasets[0].backgroundColor[i] || '#3083FF'};border-radius:3px"></div>
              <span style="font-size:10px;font-weight:600;color:#64748b">${l}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    onInsert(chartHTML);
    onClose();
  }, [chartData, chartType, onInsert, onClose]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleInsert();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleInsert, onClose]);

  const addDataPoint = () => {
    if (chartData.labels.length >= 8) return;
    const nextChar = String.fromCharCode(65 + chartData.labels.length);
    const colors = ['#3083FF', '#3083FF', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];
    setChartData({
      labels: [...chartData.labels, nextChar],
      datasets: [{
        ...chartData.datasets[0],
        data: [...chartData.datasets[0].data, 10],
        backgroundColor: colors.slice(0, chartData.labels.length + 1),
        borderColor: colors.slice(0, chartData.labels.length + 1),
      }],
    });
  };

  const removeDataPoint = (index: number) => {
    if (chartData.labels.length <= 2) return;
    const newLabels = chartData.labels.filter((_, i) => i !== index);
    const newData = chartData.datasets[0].data.filter((_, i) => i !== index);
    setChartData({
      labels: newLabels,
      datasets: [{
        ...chartData.datasets[0],
        data: newData,
      }],
    });
  };

  const maxVal = Math.max(1, ...chartData.datasets[0].data);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center border border-indigo-500/30">
              <BarChart2 size={16} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">Sisipkan Grafik</h2>
              <p className="text-[11px] text-slate-400 leading-tight">Buat visualisasi data grafik sederhana untuk soal</p>
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
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Tipe Grafik */}
          <div>
            <label className="text-xs font-bold text-slate-700 mb-2 block">Tipe Tampilan Grafik</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { type: 'bar', icon: BarChart2, label: 'Batang (Bar)' },
                { type: 'pie', icon: PieChart, label: 'Lingkaran (Pie)' },
                { type: 'line', icon: LineChart, label: 'Garis (Line)' },
              ].map((ct) => {
                const Icon = ct.icon;
                const isActive = chartType === ct.type;
                return (
                  <button
                    key={ct.type}
                    type="button"
                    onClick={() => setChartType(ct.type as typeof chartType)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                      isActive
                        ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{ct.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Label & Nilai Data */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700">Label & Nilai Data</label>
              {chartData.labels.length < 8 && (
                <button
                  type="button"
                  onClick={addDataPoint}
                  className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={12} /> Tambah Data
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {chartData.labels.map((label, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: chartData.datasets[0].backgroundColor[i] || '#3083FF' }}
                  />
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => {
                      const newLabels = [...chartData.labels];
                      newLabels[i] = e.target.value;
                      setChartData({ ...chartData, labels: newLabels });
                    }}
                    placeholder={`Label ${i + 1}`}
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  />
                  <input
                    type="number"
                    value={chartData.datasets[0].data[i]}
                    onChange={(e) => {
                      const newData = [...chartData.datasets[0].data];
                      newData[i] = parseInt(e.target.value, 10) || 0;
                      setChartData({
                        ...chartData,
                        datasets: [{ ...chartData.datasets[0], data: newData }],
                      });
                    }}
                    className="w-20 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-right font-medium text-slate-700 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  />
                  {chartData.labels.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeDataPoint(i)}
                      className="p-1.5 text-slate-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50 cursor-pointer"
                      title="Hapus baris data"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Pratinjau Grafik */}
          <div>
            <label className="text-xs font-bold text-slate-700 mb-2 block">Pratinjau Grafik</label>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 shadow-xs">
              <div className="flex items-center justify-center gap-3 mb-3 flex-wrap">
                {chartData.labels.map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                    <div
                      className="w-2.5 h-2.5 rounded-xs"
                      style={{ backgroundColor: chartData.datasets[0].backgroundColor[i] || '#3083FF' }}
                    />
                    <span>{l}: {chartData.datasets[0].data[i]}</span>
                  </div>
                ))}
              </div>

              {/* Visual Bars Simulation */}
              <div className="flex items-end justify-center gap-2 h-20 px-4 pt-2 pb-1 bg-white rounded-lg border border-slate-100">
                {chartData.datasets[0].data.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm max-w-10 transition-all duration-300"
                    style={{
                      height: `${Math.max(8, (v / maxVal) * 100)}%`,
                      backgroundColor: chartData.datasets[0].backgroundColor[i] || '#3083FF',
                    }}
                  />
                ))}
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
            onClick={handleInsert}
            className="px-5 py-2 text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#0a1a6e] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Check size={16} /> Sisipkan Grafik
          </button>
        </div>
      </div>
    </div>
  );
}
