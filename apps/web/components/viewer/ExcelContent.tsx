'use client';

import { useState } from 'react';

interface SheetData {
    sheetName: string;
    data: any[][];
}

interface ExcelContentProps {
    sheets: SheetData[];
}

export default function ExcelContent({ sheets }: ExcelContentProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const activeSheet = sheets[activeIndex];

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Sheet Tabs */}
            {sheets.length > 1 && (
                <div className="flex items-center gap-1 px-4 py-2.5 bg-[#f8fafc] border-b border-gray-200 overflow-x-auto shrink-0">
                    <i className="bi bi-table text-emerald-600 mr-1.5 text-sm shrink-0" />
                    {sheets.map((sheet, idx) => (
                        <button
                            key={sheet.sheetName}
                            onClick={() => setActiveIndex(idx)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0 ${
                                idx === activeIndex
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            <i className={`bi ${idx === activeIndex ? 'bi-check-circle-fill' : 'bi-circle'} mr-1.5 text-[10px]`} />
                            {sheet.sheetName}
                            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${
                                idx === activeIndex ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-500'
                            }`}>
                                {sheet.data.length}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto p-4 bg-[#f8fafc]">
                {activeSheet && activeSheet.data.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs bg-white rounded-xl shadow-sm overflow-hidden">
                            <tbody>
                                {activeSheet.data.map((row, rowIdx) => (
                                    <tr key={rowIdx} className={rowIdx < activeSheet.data.length - 1 ? 'border-b border-gray-100' : ''}>
                                        <td className="px-3 py-2 border-r border-gray-100 bg-gray-50 text-gray-400 text-[10px] font-semibold text-center min-w-[32px]">
                                            {rowIdx + 1}
                                        </td>
                                        {row.map((cell: any, cellIdx: number) => (
                                            <td
                                                key={cellIdx}
                                                className={`px-3 py-2 border-r border-gray-100 whitespace-pre-wrap break-words max-w-[280px] ${
                                                    rowIdx === 0 ? 'bg-green-50 font-semibold text-gray-700' : 'text-gray-600'
                                                }`}
                                            >
                                                {cell !== null && cell !== undefined ? String(cell) : ''}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-3">
                        <i className="bi bi-inbox text-4xl opacity-40" />
                        <p className="text-sm m-0">Sheet kosong</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-white border-t border-gray-100 shrink-0">
                <span className="text-[11px] text-gray-400">
                    <i className="bi bi-file-earmark-excel text-emerald-600 mr-1.5" />
                    {activeSheet?.sheetName}
                </span>
                <span className="text-[11px] text-gray-400">
                    {activeSheet?.data.length || 0} baris &times; {activeSheet?.data[0]?.length || 0} kolom
                </span>
            </div>
        </div>
    );
}
