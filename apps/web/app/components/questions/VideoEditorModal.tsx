"use client";
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { Check,Monitor,Play,Trash2,X,Youtube } from 'lucide-react';
import { useCallback,useEffect,useState } from 'react';
import { CustomVideoPlayer } from './CustomVideoPlayer';

export type VideoModalMode = 'insert' | 'edit' | 'play';

export interface VideoData {
  rawUrl: string;
  embedUrl: string;
  provider: 'YouTube' | 'Vimeo';
  id: string;
  width: string;
}

export interface VideoEditorModalProps {
  isOpen: boolean;
  mode: VideoModalMode;
  onClose: () => void;
  initialUrl?: string;
  initialWidth?: string;
  playSrc?: string;
  onInsert?: (data: VideoData) => void;
  onUpdate?: (data: VideoData) => void;
  onDelete?: () => void;
}

const VIDEO_PROVIDERS = [
  { name: 'YouTube' as const, rx: /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/ },
  { name: 'Vimeo' as const,   rx: /vimeo\.com\/(?:video\/)?(\d+)/ },
];

export function parseVideoUrl(raw: string): { provider: 'YouTube' | 'Vimeo'; id: string; embedUrl: string } | null {
  const url = (raw || '').trim();
  if (!url) return null;
  for (const p of VIDEO_PROVIDERS) {
    const m = url.match(p.rx);
    if (m && m[1]) {
      const id = m[1];
      const embedUrl = p.name === 'YouTube'
        ? `https://www.youtube.com/embed/${id}?rel=0`
        : `https://player.vimeo.com/video/${id}`;
      return { provider: p.name, id, embedUrl };
    }
  }
  return null;
}

export default function VideoEditorModal(props: VideoEditorModalProps) {
  if (!props.isOpen) return null;
  return <VideoEditorModalContent key={`${props.mode}-${props.initialUrl || ''}`} {...props} />;
}

function VideoEditorModalContent({
  mode,
  onClose,
  initialUrl = '',
  initialWidth = '100%',
  playSrc = '',
  onInsert,
  onUpdate,
  onDelete,
}: VideoEditorModalProps) {
  const standardPresets = ['25%', '50%', '75%', '100%'];
  const [url, setUrl] = useState(initialUrl || '');
  const [width, setWidth] = useState(standardPresets.includes(initialWidth) ? initialWidth : 'custom');
  const [customWidth, setCustomWidth] = useState(standardPresets.includes(initialWidth) ? '' : (initialWidth || ''));
  const [error, setError] = useState('');

  // Derived parsed video
  const parsed = parseVideoUrl(url);

  const getEffectiveWidth = useCallback((): string => {
    if (width === 'custom') {
      return customWidth.trim() || '100%';
    }
    return width;
  }, [width, customWidth]);

  const handleSubmit = useCallback(() => {
    if (!parsed) {
      setError('URL tidak dikenali. Gunakan link YouTube atau Vimeo yang valid.');
      return;
    }
    const finalWidth = getEffectiveWidth();
    const data: VideoData = {
      rawUrl: url,
      embedUrl: parsed.embedUrl,
      provider: parsed.provider,
      id: parsed.id,
      width: finalWidth,
    };

    if (mode === 'insert' && onInsert) {
      onInsert(data);
      onClose();
    } else if (mode === 'edit' && onUpdate) {
      onUpdate(data);
      onClose();
    }
  }, [parsed, getEffectiveWidth, url, mode, onInsert, onUpdate, onClose]);

  // Keyboard shortcut listener (Escape to close, Ctrl+Enter to submit)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSubmit, onClose]);

  // PLAY MODE (Cinema / Overlay view)
  if (mode === 'play') {
    const activePlaySrc = playSrc || (parsed ? parsed.embedUrl : url);
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
          className="w-full max-w-4xl bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 flex items-center justify-between border-b border-white/10 bg-slate-950/70">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center">
                <Youtube size={18} />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Pratinjau Video</h3>
                <p className="text-[11px] text-slate-400">Putar video dalam mode simulasi ujian</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Tutup (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* Video Player */}
          <div className="p-4 bg-black/90 flex justify-center items-center">
            <div className="w-full max-w-3xl rounded-xl overflow-hidden shadow-xl aspect-video bg-black">
              {activePlaySrc ? (
                <CustomVideoPlayer url={activePlaySrc} width="100%" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                  Tidak ada video yang dapat diputar
                </div>
              )}
            </div>
          </div>

          {/* Footer note */}
          <div className="px-6 py-3 bg-slate-950/60 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
            <span>Video terkunci di dalam lingkungan ujian CBT tanpa tautan keluar</span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  }

  // INSERT / EDIT MODE
  const isEdit = mode === 'edit';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 transition-all">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#3083FF] to-[#020826] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
              <Youtube size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide">
                {isEdit ? 'Edit Pengaturan Video' : 'Sisipkan Video'}
              </h3>
              <p className="text-[11px] text-slate-300">
                Mendukung tautan YouTube dan Vimeo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Tutup (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* URL Input */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              URL / Tautan Video
            </label>
            <div className="relative">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError('');
                }}
                placeholder="Contoh: https://www.youtube.com/watch?v=... atau https://youtu.be/..."
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:bg-white focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/10 transition-all pr-10"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
              {parsed && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                  {parsed.provider}
                </span>
              )}
            </div>

            {error ? (
              <p className="text-xs text-red-600 mt-1.5 font-medium">{error}</p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-1.5">
                Format yang didukung: <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[10px]">youtube.com/watch?v=...</code>, <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[10px]">youtu.be/...</code>, <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[10px]">vimeo.com/...</code>
              </p>
            )}
          </div>

          {/* Live Thumbnail / Player Preview */}
          {parsed && (
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-900">
              <div className="relative aspect-video flex items-center justify-center overflow-hidden">
                {parsed.provider === 'YouTube' ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://img.youtube.com/vi/${parsed.id}/hqdefault.jpg`}
                      alt="Thumbnail Video"
                      className="w-full h-full object-cover opacity-85"
                    />
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                        <Play size={20} className="ml-1" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-white text-center p-4">
                    <Youtube size={32} className="mx-auto text-blue-400 mb-2" />
                    <p className="text-xs font-semibold">Video Vimeo terdeteksi (ID: {parsed.id})</p>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-black/70 backdrop-blur-xs text-[10px] text-white font-medium flex items-center gap-1.5">
                  <Monitor size={12} />
                  <span>Ukuran: {getEffectiveWidth()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Width Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-2">
              Ukuran Tampilan Video
            </label>
            <div className="grid grid-cols-4 gap-2 mb-2.5">
              {(['25%', '50%', '75%', '100%'] as const).map((w) => (
                <button
                  type="button"
                  key={w}
                  onClick={() => {
                    setWidth(w);
                    setCustomWidth('');
                  }}
                  className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    width === w && !customWidth
                      ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-[#3083FF]/40 hover:bg-slate-50'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>

            {/* Custom Width Input */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">
                Kustom:
              </span>
              <input
                type="text"
                value={customWidth}
                onChange={(e) => {
                  setCustomWidth(e.target.value);
                  setWidth('custom');
                }}
                placeholder="misal: 600px, 80%, atau auto"
                className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:bg-white focus:border-[#3083FF]"
              />
            </div>
          </div>

          {/* CBT Security Badge */}
          <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-800 flex items-start gap-2.5">
            <span className="text-sm">🛡️</span>
            <div>
              <p className="font-semibold mb-0.5">Keamanan Lingkungan Ujian</p>
              <p className="text-blue-700/80 leading-relaxed">
                Video disematkan dalam pemutar khusus tanpa rekomendasi video luar, sehingga siswa tidak dapat membuka tab YouTube selama ujian.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
          {isEdit && onDelete ? (
            <button
              type="button"
              onClick={async () => {
                if (await deleteConfirmDialog('Hapus Video?', 'Hapus video ini dari naskah soal?')) {
                  onDelete();
                  onClose();
                }
              }}
              className="py-2.5 px-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 size={14} /> Hapus
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-semibold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!url.trim()}
              className="px-5 py-2.5 bg-[#3083FF] hover:bg-[#0a1a6e] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-xs transition-all flex items-center gap-2 shadow-sm cursor-pointer"
            >
              <Check size={15} />
              {isEdit ? 'Simpan Perubahan' : 'Sisipkan Video'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
