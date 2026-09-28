"use client";
import {
AlignCenter,
AlignLeft,
AlignRight,
Check,
Crop,
Eye,
ImageIcon,
RotateCcw,
X,
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';

export interface ImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  initialWidth?: string;
  initialAlign?: 'left' | 'center' | 'right';
  onApply: (data: { src: string; width: string; align: 'left' | 'center' | 'right' }) => void;
  onUpload?: (file: File) => Promise<string>;
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
}: ImageEditorModalProps) {
  const originalImageSrc = imageSrc;
  const [currentImageSrc, setCurrentImageSrc] = useState(imageSrc);
  const [imgWidth, setImgWidth] = useState(initialWidth || '100%');
  const [imgAlign, setImgAlign] = useState<'left' | 'center' | 'right'>(initialAlign || 'center');

  // Crop Modal state
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropAspectRatio, setCropAspectRatio] = useState<'original' | '1:1' | '4:3' | '16:9'>('original');
  const [cropBox, setCropBox] = useState({ x: 20, y: 20, width: 200, height: 120 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
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

  const handleFinalApply = useCallback(() => {
    onApply({
      src: currentImageSrc,
      width: imgWidth,
      align: imgAlign,
    });
    onClose();
  }, [currentImageSrc, imgWidth, imgAlign, onApply, onClose]);

  // Global mousemove/mouseup listener for crop box dragging & resizing
  useEffect(() => {
    if (!showCropModal || (!isDragging && !isResizing)) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!cropContainerRef.current) return;
      const rect = cropContainerRef.current.getBoundingClientRect();

      if (isDragging) {
        let newX = e.clientX - dragStart.x;
        let newY = e.clientY - dragStart.y;
        newX = Math.max(0, Math.min(rect.width - cropBox.width, newX));
        newY = Math.max(0, Math.min(rect.height - cropBox.height, newY));
        setCropBox((prev) => ({ ...prev, x: newX, y: newY }));
      } else if (isResizing) {
        let newW = e.clientX - rect.left - cropBox.x;
        let newH = e.clientY - rect.top - cropBox.y;
        newW = Math.max(30, Math.min(rect.width - cropBox.x, newW));
        newH = Math.max(30, Math.min(rect.height - cropBox.y, newH));
        setCropBox((prev) => ({ ...prev, width: newW, height: newH }));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [showCropModal, isDragging, isResizing, dragStart, cropBox.width, cropBox.height, cropBox.x, cropBox.y]);

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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[600px] max-h-[92vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-3.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
                <ImageIcon size={16} className="text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white leading-tight">Pengaturan Gambar Soal</h2>
                <p className="text-[11px] text-slate-400 leading-tight">Sesuaikan ukuran dan perataan posisi gambar pada lembar soal</p>
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
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            {/* Left Column: Settings Panel */}
            <div className="w-full md:w-80 shrink-0 border-r border-slate-100 p-5 space-y-5 bg-white overflow-y-auto">
              {/* Lebar Tampilan */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-700">Lebar Gambar</label>
                  <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {imgWidth === 'original' ? '100% (Asli)' : imgWidth}
                  </span>
                </div>

                {/* Preset Pills */}
                <div className="grid grid-cols-5 gap-1 mb-2.5">
                  {[
                    { key: '25%', label: '25%' },
                    { key: '50%', label: '50%' },
                    { key: '75%', label: '75%' },
                    { key: '100%', label: '100%' },
                    { key: 'original', label: 'Asli' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setImgWidth(item.key)}
                      className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer text-center ${
                        imgWidth === item.key
                          ? 'bg-[#3083FF] text-white border-[#3083FF] shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* Custom Width Input */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Kustom (misal: 350px atau 60%)"
                    value={['25%', '50%', '75%', '100%', 'original'].includes(imgWidth) ? '' : imgWidth}
                    onChange={(e) => setImgWidth(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              {/* Perataan Posisi */}
              <div>
                <label className="text-xs font-bold text-slate-700 mb-2 block">Perataan Posisi</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
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
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          isActive
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Icon size={14} />
                        <span>{align.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pemotongan Gambar (Aksi Buka Modal Crop) */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 flex items-center justify-center shrink-0">
                    <Crop size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Pemotongan (Crop)</span>
                    <span className="text-[11px] text-slate-400 block">
                      {currentImageSrc !== originalImageSrc ? 'Gambar telah dipotong' : 'Potong bagian gambar'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCropModal(true)}
                    className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Crop size={14} className="text-blue-600" />
                    <span>{currentImageSrc !== originalImageSrc ? 'Ubah Potongan...' : 'Buka Alat Potong...'}</span>
                  </button>
                  {currentImageSrc !== originalImageSrc && (
                    <button
                      type="button"
                      onClick={() => setCurrentImageSrc(originalImageSrc)}
                      title="Kembalikan ke gambar asli sebelum dipotong"
                      className="py-2 px-2.5 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-500 hover:text-red-600 text-xs font-medium rounded-lg transition-all flex items-center justify-center cursor-pointer shadow-xs"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Live Document Preview */}
            <div className="flex-1 flex flex-col bg-slate-50/70 p-5 overflow-hidden">
              {/* Preview Topbar */}
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-xs">
                    <Eye size={13} className="text-slate-500" />
                    <span>Pratinjau Lembar Soal</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Ukuran: {imgWidth === 'original' ? '100% (Asli)' : imgWidth}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Tampilan proporsional pada lembar soal
                </div>
              </div>

              {/* Preview Viewport */}
              <div className="flex-1 rounded-xl border border-slate-200/80 bg-white p-6 flex flex-col justify-between overflow-auto shadow-xs">
                {/* Simulated text lines */}
                <div className="space-y-2 mb-4 shrink-0 max-w-lg">
                  <div className="h-2.5 bg-slate-100 rounded-full w-4/5" />
                  <div className="h-2 bg-slate-100 rounded-full w-3/5" />
                </div>

                {/* Simulated Image Container */}
                <div
                  className="w-full flex my-auto py-2 overflow-hidden"
                  style={{
                    justifyContent:
                      imgAlign === 'left' ? 'flex-start' : imgAlign === 'right' ? 'flex-end' : 'center',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImageSrc}
                    alt="Live Style Preview"
                    className="rounded-lg shadow-sm border border-slate-200 transition-all duration-200 object-contain"
                    style={{
                      width: imgWidth === 'original' ? '100%' : imgWidth,
                      maxWidth: '100%',
                      maxHeight: '300px',
                      height: 'auto',
                    }}
                  />
                </div>

                {/* Simulated text line below */}
                <div className="space-y-2 mt-4 shrink-0 max-w-lg">
                  <div className="h-2 bg-slate-100 rounded-full w-2/3" />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span>Pratinjau interaktif real-time</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleFinalApply}
                className="px-5 py-2 text-sm font-semibold bg-[#3083FF] text-white rounded-lg hover:bg-[#0a1a6e] transition-all shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <Check size={16} /> Sisipkan ke Soal
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
                  onMouseDown={(e) => {
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
                  className="border-2 border-white ring-1 ring-blue-500/60 z-10"
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

                  {/* Corner Visual Indicators */}
                  <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-blue-600 rounded-xs shadow-sm pointer-events-none" />
                  <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-blue-600 rounded-xs shadow-sm pointer-events-none" />
                  <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-blue-600 rounded-xs shadow-sm pointer-events-none" />

                  {/* SE Resize Handle */}
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setIsResizing(true);
                    }}
                    className="absolute -bottom-2 -right-2 w-4 h-4 bg-blue-600 border-2 border-white rounded-full shadow-md cursor-se-resize flex items-center justify-center hover:scale-125 transition-transform"
                  />
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
