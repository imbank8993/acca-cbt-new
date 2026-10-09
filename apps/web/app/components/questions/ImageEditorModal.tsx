"use client";
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import {
AlignCenter,
AlignLeft,
AlignRight,
Check,
Crop,
Eye,
ImageIcon,
RotateCcw,
Trash2,
X,
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';
import { resolveStorageUrl } from '@/lib/safe-url';
import { uploadToHosting } from '@/lib/uploader';

export interface ImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  initialWidth?: string;
  initialAlign?: 'left' | 'center' | 'right';
  onApply: (data: { src: string; width: string; align: 'left' | 'center' | 'right' }) => void;
  onUpload?: (file: File) => Promise<string>;
  onDelete?: () => void;
}

export default function ImageEditorModal(props: ImageEditorModalProps) {
  if (!props.isOpen) return null;
  return <ImageEditorModalContent key={props.imageSrc} {...props} />;
}

function ImageEditorModalContent({
  onClose,
  imageSrc,
  initialWidth = '100%',
  initialAlign = 'center',
  onApply,
  onUpload,
  onDelete,
}: ImageEditorModalProps) {
  const normalizedSrc = resolveStorageUrl(imageSrc);
  const originalImageSrc = normalizedSrc;
  const [currentImageSrc, setCurrentImageSrc] = useState(normalizedSrc);
  const [imgWidth, setImgWidth] = useState(initialWidth || '100%');
  const [imgAlign, setImgAlign] = useState<'left' | 'center' | 'right'>(initialAlign || 'center');

  // Crop Modal state
  const [showCropModal, setShowCropModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [cropAspectRatio, setCropAspectRatio] = useState<'original' | '1:1' | '4:3' | '16:9'>('original');
  const [cropBox, setCropBox] = useState({ x: 20, y: 20, width: 200, height: 120 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState<{
    pointerX: number;
    pointerY: number;
    box: typeof cropBox;
    handle: 'nw' | 'ne' | 'sw' | 'se';
  } | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  const handleApplyCrop = useCallback(() => {
    const img = new window.Image();
    img.src = originalImageSrc || currentImageSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sw = img.naturalWidth || img.width;
      const sh = img.naturalHeight || img.height;

      let sx = 0;
      let sy = 0;
      let sWidth = sw;
      let sHeight = sh;

      if (cropContainerRef.current) {
        const rect = cropContainerRef.current.getBoundingClientRect();
        const scaleX = sw / rect.width;
        const scaleY = sh / rect.height;

        sx = Math.max(0, cropBox.x * scaleX);
        sy = Math.max(0, cropBox.y * scaleY);
        sWidth = Math.min(sw - sx, cropBox.width * scaleX);
        sHeight = Math.min(sh - sy, cropBox.height * scaleY);
      }

      canvas.width = Math.max(1, Math.round(sWidth));
      canvas.height = Math.max(1, Math.round(sHeight));
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.95);
      setCurrentImageSrc(croppedBase64);
      setShowCropModal(false);
    };
  }, [originalImageSrc, currentImageSrc, cropBox]);

  const handleFinalApply = useCallback(async () => {
    setIsUploading(true);
    setUploadError('');
    try {
      let src = currentImageSrc;
      if (src.startsWith('data:')) {
        const uploader = onUpload || (async (file: File) => {
          const res = await uploadToHosting(file, 'questions');
          if (res.success && res.url) return res.url;
          throw new Error(res.error || 'Gagal mengunggah gambar soal.');
        });
        const response = await fetch(src);
        if (!response.ok) throw new Error('Gambar tidak dapat diproses untuk diunggah.');
        const blob = await response.blob();
        const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const file = new File([blob], `question-image-${Date.now()}.${extension}`, {
          type: blob.type || 'image/jpeg',
        });
        src = await uploader(file);
      }
      src = resolveStorageUrl(src);
      if (!src) {
        throw new Error('Gambar belum berhasil diproses. Silakan coba lagi.');
      }
      await onApply({ src, width: imgWidth, align: imgAlign });
      onClose();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Gagal mengunggah gambar.');
    } finally {
      setIsUploading(false);
    }
  }, [currentImageSrc, imgWidth, imgAlign, onApply, onClose, onUpload]);

  // Global pointer listener allows crop adjustments with a mouse, pen, or touch.
  useEffect(() => {
    if (!showCropModal || (!isDragging && !isResizing)) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!cropContainerRef.current) return;
      const rect = cropContainerRef.current.getBoundingClientRect();

      if (isDragging) {
        let newX = e.clientX - dragStart.x;
        let newY = e.clientY - dragStart.y;
        newX = Math.max(0, Math.min(rect.width - cropBox.width, newX));
        newY = Math.max(0, Math.min(rect.height - cropBox.height, newY));
        setCropBox((prev) => ({ ...prev, x: newX, y: newY }));
      } else if (isResizing && resizeStart) {
        const { box, handle, pointerX, pointerY } = resizeStart;
        const isWest = handle.includes('w');
        const isNorth = handle.includes('n');
        const anchorX = isWest ? box.x + box.width : box.x;
        const anchorY = isNorth ? box.y + box.height : box.y;
        const deltaX = (e.clientX - pointerX) * (isWest ? -1 : 1);
        const deltaY = (e.clientY - pointerY) * (isNorth ? -1 : 1);
        let width = Math.max(30, box.width + deltaX);
        let height = Math.max(30, box.height + deltaY);
        const ratio =
          cropAspectRatio === '1:1'
            ? 1
            : cropAspectRatio === '4:3'
              ? 4 / 3
              : cropAspectRatio === '16:9'
                ? 16 / 9
                : null;

        if (ratio) {
          if (Math.abs(deltaX) >= Math.abs(deltaY)) {
            height = width / ratio;
          } else {
            width = height * ratio;
          }
        }

        const maxWidth = isWest ? anchorX : rect.width - anchorX;
        const maxHeight = isNorth ? anchorY : rect.height - anchorY;
        const scale = Math.min(1, maxWidth / width, maxHeight / height);
        width *= scale;
        height *= scale;
        const x = isWest ? anchorX - width : anchorX;
        const y = isNorth ? anchorY - height : anchorY;
        setCropBox((prev) => ({ ...prev, x, y, width, height }));
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeStart(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [showCropModal, isDragging, isResizing, dragStart, cropBox, cropAspectRatio, resizeStart]);

  // Keyboard shortcut listener (Escape to close, Ctrl+Enter to apply)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCropModal) {
          setShowCropModal(false);
        } else {
          onClose();
        }
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (showCropModal) {
          handleApplyCrop();
        } else {
          handleFinalApply();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCropModal, handleApplyCrop, handleFinalApply, onClose]);

  return (
    <>
      {/* 1. Modal Utama: Pengaturan Gambar */}
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[min(760px,92vh)] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                <ImageIcon size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 leading-tight">Edit gambar</h2>
                <p className="text-xs text-slate-500 mt-1">Atur tampilan gambar di soal</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
              title="Tutup"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col bg-slate-50">
            <div className="flex-1 min-h-0 p-4 sm:p-8 flex items-center justify-center overflow-auto">
              <div className="w-full max-w-4xl min-h-[280px] h-full max-h-[520px] bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center p-5 sm:p-10">
                <div className="self-start flex items-center gap-2 text-xs text-slate-500 mb-5">
                  <Eye size={14} />
                  <span>Pratinjau pada lembar soal</span>
                </div>
                <div
                  className="w-full flex flex-1 min-h-0 items-center"
                  style={{
                    justifyContent:
                      imgAlign === 'left' ? 'flex-start' : imgAlign === 'right' ? 'flex-end' : 'center',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImageSrc}
                    alt="Pratinjau gambar soal"
                    className="rounded-lg border border-slate-200 transition-all duration-150 object-contain"
                    style={{
                      width: imgWidth === 'original' ? '100%' : imgWidth,
                      maxWidth: '100%',
                      maxHeight: '100%',
                      height: 'auto',
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-8 py-4 bg-white border-t border-slate-200 grid grid-cols-1 md:grid-cols-[minmax(240px,1fr)_auto_auto] items-center gap-5">
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label htmlFor="question-image-width" className="text-xs font-semibold text-slate-700">Lebar gambar</label>
                  <span className="text-xs font-medium text-slate-500">{imgWidth === 'original' ? 'Asli' : imgWidth}</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    aria-label="Lebar gambar dalam persen"
                    type="range"
                    min="1"
                    max="100"
                    step="0.1"
                    value={/^(\d+(?:\.\d+)?)%$/.exec(imgWidth)?.[1] ?? '100'}
                    onChange={(e) => setImgWidth(`${e.target.value}%`)}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                  <input
                    id="question-image-width"
                    type="text"
                    aria-label="Lebar gambar kustom"
                    placeholder="mis. 63% atau 320px"
                    value={['25%', '50%', '75%', '100%', 'original'].includes(imgWidth) ? '' : imgWidth}
                    onChange={(e) => setImgWidth(e.target.value)}
                    className="w-32 shrink-0 px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setImgWidth('original')}
                    aria-pressed={imgWidth === 'original'}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      imgWidth === 'original'
                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Asli
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-2">Posisi</span>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {[
                    { key: 'left', label: 'Kiri', icon: AlignLeft },
                    { key: 'center', label: 'Tengah', icon: AlignCenter },
                    { key: 'right', label: 'Kanan', icon: AlignRight },
                  ].map((align) => {
                    const Icon = align.icon;
                    const isActive = imgAlign === align.key;
                    return (
                      <button
                        key={align.key}
                        type="button"
                        onClick={() => setImgAlign(align.key as 'left' | 'center' | 'right')}
                        aria-label={`Rata ${align.label.toLowerCase()}`}
                        aria-pressed={isActive}
                        className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
                          isActive ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Icon size={16} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-2">Potong</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCropModal(true)}
                    className="h-11 px-3 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
                  >
                    <Crop size={15} className="text-blue-600" />
                    {currentImageSrc !== originalImageSrc ? 'Ubah crop' : 'Crop gambar'}
                  </button>
                  {currentImageSrc !== originalImageSrc && (
                    <button
                      type="button"
                      onClick={() => setCurrentImageSrc(originalImageSrc)}
                      aria-label="Pulihkan gambar asli"
                      title="Pulihkan gambar asli"
                      className="w-11 h-11 rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors flex items-center justify-center"
                    >
                      <RotateCcw size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-white">
            <div className="min-w-0 pr-3 text-xs">
              {uploadError ? (
                <span role="alert" className="text-rose-600">{uploadError}</span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  <span>Pratinjau interaktif real-time</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onDelete && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await deleteConfirmDialog('Hapus Gambar?', 'Hapus gambar ini dari soal?')) {
                      onDelete();
                      onClose();
                    }
                  }}
                  disabled={isUploading}
                  className="px-3 py-2 text-sm text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer font-medium flex items-center gap-1.5 mr-2"
                  title="Hapus gambar dari lembar soal"
                >
                  <Trash2 size={15} />
                  <span>Hapus</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={isUploading}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleFinalApply()}
                disabled={isUploading}
                className="px-5 py-2 text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#0a1a6e] transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              >
                {isUploading ? 'Mengunggah...' : <><Check size={16} /> Sisipkan ke Soal</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Modal Khusus: Pemotongan Gambar (Crop) */}
      {showCropModal && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCropModal(false);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[620px] max-h-[92vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
                  <Crop size={16} className="text-blue-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white leading-tight">Potong Gambar (Crop)</h2>
                  <p className="text-[11px] text-slate-400 leading-tight">Atur area atau pilih rasio aspek yang diinginkan</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCropModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                title="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            {/* Sub-toolbar (Aspect Ratios & Reset) */}
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500 mr-1">Rasio:</span>
                {[
                  { id: 'original', label: 'Bebas' },
                  { id: '1:1', label: '1:1 (Persegi)' },
                  { id: '4:3', label: '4:3' },
                  { id: '16:9', label: '16:9' },
                ].map((ratio) => (
                  <button
                    key={ratio.id}
                    type="button"
                    onClick={() => {
                      setCropAspectRatio(ratio.id as 'original' | '1:1' | '4:3' | '16:9');
                      if (cropContainerRef.current) {
                        const rect = cropContainerRef.current.getBoundingClientRect();
                        let w = cropBox.width;
                        let h = cropBox.height;
                        if (ratio.id === '1:1') {
                          const size = Math.min(w, h, rect.width - cropBox.x, rect.height - cropBox.y);
                          w = size;
                          h = size;
                        } else if (ratio.id === '4:3') {
                          h = Math.min(rect.height - cropBox.y, w * (3 / 4));
                          w = h * (4 / 3);
                        } else if (ratio.id === '16:9') {
                          h = Math.min(rect.height - cropBox.y, w * (9 / 16));
                          w = h * (16 / 9);
                        }
                        setCropBox((prev) => ({
                          ...prev,
                          width: Math.max(30, Math.round(w)),
                          height: Math.max(30, Math.round(h)),
                        }));
                      }
                    }}
                    className={`px-3 py-1 text-xs rounded-lg font-medium border transition-all cursor-pointer ${
                      cropAspectRatio === ratio.id
                        ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (cropContainerRef.current) {
                    const rect = cropContainerRef.current.getBoundingClientRect();
                    setCropBox({
                      x: 0,
                      y: 0,
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                    });
                  }
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
              >
                <RotateCcw size={13} /> Reset Penuh
              </button>
            </div>

            {/* Crop Canvas Center */}
            <div className="flex-1 bg-slate-900/95 flex items-center justify-center p-6 overflow-hidden relative select-none">
              <div
                ref={cropContainerRef}
                className="relative inline-block overflow-hidden rounded-md shadow-2xl"
                style={{ maxWidth: '100%', maxHeight: '400px' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={originalImageSrc || currentImageSrc}
                  alt="Crop Target"
                  onLoad={(e) => {
                    const target = e.currentTarget;
                    const w = target.clientWidth;
                    const h = target.clientHeight;
                    if (w > 0 && h > 0) {
                      const padX = Math.round(w * 0.08);
                      const padY = Math.round(h * 0.08);
                      setCropBox({
                        x: padX,
                        y: padY,
                        width: Math.max(40, w - padX * 2),
                        height: Math.max(40, h - padY * 2),
                      });
                    }
                  }}
                  className="block max-w-full max-h-[400px] w-auto h-auto object-contain select-none pointer-events-none"
                />

                {/* Interactive Crop Box Overlay */}
                <div
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                    setDragStart({
                      x: e.clientX - cropBox.x,
                      y: e.clientY - cropBox.y,
                    });
                  }}
                  style={{
                    position: 'absolute',
                    left: `${cropBox.x}px`,
                    top: `${cropBox.y}px`,
                    width: `${cropBox.width}px`,
                    height: `${cropBox.height}px`,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
                    cursor: 'move',
                  }}
                  className="border-2 border-white ring-1 ring-blue-500/60 z-10 touch-none"
                >
                  {/* Photography 3x3 Grid Lines */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                    <div className="border-r border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-b border-white" />
                    <div className="border-r border-white" />
                    <div className="border-r border-white" />
                    <div />
                  </div>

                  {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      aria-label={`Ubah ukuran area crop ${handle}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDragging(false);
                        setIsResizing(true);
                        setResizeStart({
                          pointerX: e.clientX,
                          pointerY: e.clientY,
                          box: { ...cropBox },
                          handle,
                        });
                      }}
                      className={`absolute w-4 h-4 bg-white border-2 border-blue-600 rounded-full shadow-md hover:scale-125 transition-transform ${
                        handle === 'nw'
                          ? '-top-2 -left-2 cursor-nwse-resize'
                          : handle === 'ne'
                            ? '-top-2 -right-2 cursor-nesw-resize'
                            : handle === 'sw'
                              ? '-bottom-2 -left-2 cursor-nesw-resize'
                              : '-bottom-2 -right-2 cursor-nwse-resize'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <span className="text-xs text-slate-400">
                Seret kotak atau tarik sudut kanan-bawah untuk menentukan area potongan
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCropModal(false)}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer font-medium"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleApplyCrop}
                  className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-sm flex items-center gap-2 cursor-pointer"
                >
                  <Check size={16} /> Terapkan Potongan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
