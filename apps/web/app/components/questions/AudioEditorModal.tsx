"use client";
import { Check,Link as LinkIcon,Loader2,Mic,Music,RotateCcw,Square,UploadCloud,Volume2,X } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';

export interface AudioEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (audioUrl: string) => void;
  onUpload?: (file: File) => Promise<string>;
}

type AudioTab = 'upload' | 'record' | 'url';

export default function AudioEditorModal(props: AudioEditorModalProps) {
  if (!props.isOpen) return null;
  return <AudioEditorModalContent {...props} />;
}

function AudioEditorModalContent({
  onClose,
  onInsert,
  onUpload,
}: AudioEditorModalProps) {
  const [activeTab, setActiveTab] = useState<AudioTab>('upload');
  
  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string>('');
  
  // Voice Note Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string>('');
  const [micPermissionError, setMicPermissionError] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Direct URL State
  const [directUrl, setDirectUrl] = useState('');
  
  // General State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup URLs and recording on unmount
  useEffect(() => {
    return () => {
      if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(filePreviewUrl);
      }
      if (recordedAudioUrl && recordedAudioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [filePreviewUrl, recordedAudioUrl]);

  // Keyboard shortcut listener (Escape to close)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRecording && !isUploading) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isRecording, isUploading, onClose]);

  // Handle local audio file selection
  const handleFileChange = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setUploadError('Pilih file audio yang valid (contoh: MP3, WAV, M4A, OGG).');
      return;
    }
    setUploadError('');
    setSelectedFile(file);
    if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objectUrl);
  };

  // Start microphone recording
  const startRecording = async () => {
    setMicPermissionError('');
    setUploadError('');
    recordedChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        // Stop audio tracks so the mic icon disappears from the browser tab
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordDuration(0);

      timerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      console.error('Microphone error:', err);
      setMicPermissionError(
        'Tidak dapat mengakses mikrofon. Pastikan Anda telah memberikan izin akses mikrofon di browser.'
      );
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  // Reset recording to record again
  const resetRecording = () => {
    if (recordedAudioUrl && recordedAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(recordedAudioUrl);
    }
    setRecordedBlob(null);
    setRecordedAudioUrl('');
    setRecordDuration(0);
    setIsRecording(false);
  };

  // Format seconds to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle final submission / insertion
  const handleInsertAudio = async () => {
    setUploadError('');
    setIsUploading(true);

    try {
      if (activeTab === 'upload') {
        if (!selectedFile) {
          setUploadError('Silakan pilih file audio terlebih dahulu.');
          setIsUploading(false);
          return;
        }

        if (onUpload) {
          const uploadedUrl = await onUpload(selectedFile);
          onInsert(uploadedUrl);
        } else {
          // Fallback to data URL or preview URL
          onInsert(filePreviewUrl);
        }
        onClose();
      } else if (activeTab === 'record') {
        if (!recordedBlob) {
          setUploadError('Belum ada rekaman suara.');
          setIsUploading(false);
          return;
        }

        const fileName = `voicenote-${Date.now()}.webm`;
        const audioFile = new File([recordedBlob], fileName, { type: recordedBlob.type || 'audio/webm' });

        if (onUpload) {
          const uploadedUrl = await onUpload(audioFile);
          onInsert(uploadedUrl);
        } else {
          onInsert(recordedAudioUrl);
        }
        onClose();
      } else if (activeTab === 'url') {
        if (!directUrl.trim()) {
          setUploadError('Silakan masukkan tautan audio.');
          setIsUploading(false);
          return;
        }
        onInsert(directUrl.trim());
        onClose();
      }
    } catch (err: unknown) {
      console.error('Audio insert error:', err);
      setUploadError('Gagal memproses file audio. Silakan coba lagi.');
    } finally {
      setIsUploading(false);
    }
  };

  const canInsert =
    (activeTab === 'upload' && selectedFile !== null) ||
    (activeTab === 'record' && recordedBlob !== null && !isRecording) ||
    (activeTab === 'url' && directUrl.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRecording && !isUploading) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 transition-all">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#3083FF] to-[#020826] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Mic size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide">
                Sisipkan Audio & Rekaman Suara
              </h3>
              <p className="text-[11px] text-slate-300">
                Mendukung upload file MP3 atau rekam suara langsung
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isRecording || isUploading}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Tutup (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 bg-slate-50/70 p-1.5 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-white text-[#3083FF] shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <UploadCloud size={15} />
            <span>Unggah MP3 / Audio</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('record')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'record'
                ? 'bg-white text-[#3083FF] shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Mic size={15} />
            <span>Rekam Suara (Voice Note)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('url')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'url'
                ? 'bg-white text-[#3083FF] shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <LinkIcon size={15} />
            <span>Tautan URL</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6">
          {/* TAB 1: FILE UPLOAD */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileChange(file);
                }}
              />

              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileChange(file);
                  }}
                  className="border-2 border-dashed border-slate-200 hover:border-[#3083FF] bg-slate-50/50 hover:bg-blue-50/20 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 group-hover:text-[#3083FF] group-hover:scale-105 transition-all">
                    <Music size={28} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700 group-hover:text-[#3083FF]">
                      Pilih file audio atau seret ke sini
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Mendukung MP3, WAV, M4A, OGG, AAC (Maks. 25MB)
                    </p>
                  </div>
                  <span className="px-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 shadow-2xs group-hover:bg-slate-50">
                    Jelajahi File
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                        <Volume2 size={20} />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-slate-800 truncate">
                          {selectedFile.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setFilePreviewUrl('');
                      }}
                      className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                      title="Ganti File"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {filePreviewUrl && (
                    <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Pratinjau Suara:
                      </p>
                      <audio controls src={filePreviewUrl} className="w-full h-10" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: VOICE RECORDER */}
          {activeTab === 'record' && (
            <div className="space-y-5">
              {micPermissionError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
                  {micPermissionError}
                </div>
              )}

              <div className="flex flex-col items-center justify-center py-6 bg-slate-50 border border-slate-200 rounded-2xl">
                {/* Timer Display */}
                <div className="text-3xl font-mono font-bold text-slate-800 tracking-wider mb-4">
                  {formatTime(recordDuration)}
                </div>

                {/* Big Action Button */}
                {!isRecording && !recordedBlob ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="group relative w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <div className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-25 group-hover:opacity-40" />
                    <Mic size={28} />
                  </button>
                ) : isRecording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="w-16 h-16 rounded-full bg-slate-800 hover:bg-slate-900 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer animate-pulse"
                  >
                    <Square size={24} className="fill-white" />
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={resetRecording}
                      className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                    >
                      <RotateCcw size={14} /> Rekam Ulang
                    </button>
                  </div>
                )}

                <p className="text-xs font-medium text-slate-500 mt-4">
                  {!isRecording && !recordedBlob
                    ? 'Klik tombol merah untuk mulai merekam'
                    : isRecording
                    ? 'Sedang merekam suara... Klik untuk berhenti'
                    : 'Rekaman suara siap disisipkan'}
                </p>
              </div>

              {recordedAudioUrl && !isRecording && (
                <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Pratinjau Hasil Rekaman:
                  </p>
                  <audio controls src={recordedAudioUrl} className="w-full h-10" />
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DIRECT AUDIO URL */}
          {activeTab === 'url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  Tautan File Audio Langsung
                </label>
                <input
                  type="text"
                  value={directUrl}
                  onChange={(e) => setDirectUrl(e.target.value)}
                  placeholder="https://domain.com/audio/listening-comprehension.mp3"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:bg-white focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/10 transition-all"
                  autoFocus
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Gunakan URL publik langsung yang mengarah ke file audio (akhiran .mp3, .wav, dsb).
                </p>
              </div>

              {directUrl.trim() && (
                <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Pratinjau Suara:
                  </p>
                  <audio controls src={directUrl.trim()} className="w-full h-10" />
                </div>
              )}
            </div>
          )}

          {uploadError && (
            <p className="text-xs text-red-600 font-semibold mt-3 bg-red-50 p-2.5 rounded-xl border border-red-100">
              {uploadError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-semibold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleInsertAudio}
            disabled={!canInsert || isUploading}
            className="px-5 py-2.5 bg-[#3083FF] hover:bg-[#0a1a6e] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-xs transition-all flex items-center gap-2 shadow-sm cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Mengunggah...</span>
              </>
            ) : (
              <>
                <Check size={15} />
                <span>Sisipkan Audio</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
