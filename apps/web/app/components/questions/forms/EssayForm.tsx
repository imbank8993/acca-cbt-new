"use client";
/**
 * EssayForm — Essay / Uraian
 * Minimal UI — essay answers are written by students, not pre-defined by teacher.
 */
import { FileText,Info,Upload,Video } from 'lucide-react';
import React from 'react';
import type { EssayMetadata } from '../schema';

interface EssayFormProps {
  metadata?: Partial<EssayMetadata>;
  onUpdateMetadata?: (updates: Partial<EssayMetadata>) => void;
}

export const EssayForm = React.memo(({ metadata, onUpdateMetadata }: EssayFormProps) => {
  const allowFileUpload = metadata?.allow_file_upload || false;
  const allowVideoLink = metadata?.allow_video_link || false;
  const isMultiTopic = metadata?.is_multi_topic || false;

  return (
    <div className="p-5 bg-slate-50/50 rounded-lg border-2 border-slate-100 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-[#3083FF] flex items-center justify-center shadow-sm shadow-blue-200">
          <FileText size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-700">Format Essay</p>
          <p className="text-[11px] text-slate-400">Jawaban ditulis oleh siswa</p>
        </div>
      </div>
      
      <div className="flex items-start gap-3 p-4 bg-blue-50/50 border border-blue-100 rounded-lg">
        <Info size={15} className="text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-blue-700 font-medium">
            Siswa akan menulis jawaban uraian secara lengkap. Nilai ditentukan oleh guru setelah ujian selesai.
          </p>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-200 space-y-3">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">Pengaturan Tambahan</p>
        
        <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
          <div className="pt-0.5">
            <input 
              type="checkbox" 
              checked={allowFileUpload}
              onChange={(e) => onUpdateMetadata?.({ allow_file_upload: e.target.checked })}
              className="w-4 h-4 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Upload size={14} className="text-blue-500" />
              <p className="text-sm font-bold text-slate-700">Izinkan Unggah File</p>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Siswa dapat mengunggah file (PDF, DOC, Gambar, dll) sebagai bagian dari jawaban.</p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
          <div className="pt-0.5">
            <input 
              type="checkbox" 
              checked={isMultiTopic}
              onChange={(e) => onUpdateMetadata?.({ is_multi_topic: e.target.checked })}
              className="w-4 h-4 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-blue-500" />
              <p className="text-sm font-bold text-slate-700">Jadikan Multi-Topik</p>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Siswa wajib memilih salah satu topik sebelum mengunggah/menulis jawaban. Opsi topik dapat ditambahkan di bawah.</p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
          <div className="pt-0.5">
            <input 
              type="checkbox" 
              checked={allowVideoLink}
              onChange={(e) => onUpdateMetadata?.({ allow_video_link: e.target.checked })}
              className="w-4 h-4 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Video size={14} className="text-blue-500" />
              <p className="text-sm font-bold text-slate-700">Izinkan Link Video</p>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Siswa dapat melampirkan tautan video (YouTube, Google Drive, dll) sebagai bagian dari jawaban.</p>
          </div>
        </label>
      </div>
    </div>
  );
});

EssayForm.displayName = 'EssayForm';
