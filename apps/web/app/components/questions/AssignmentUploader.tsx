"use client";
import { deleteFromHosting,uploadToHosting } from '@/lib/uploader';
import { AlertCircle,CheckCircle2,File,FileText,Image as ImageIcon,Loader2,Upload,X } from 'lucide-react';
import React,{ useCallback,useEffect,useRef,useState } from 'react';

type UploadedFile = {
    id: string;
    name: string;
    size: number;
    url: string;
    type: string;
};

type Props = {
    examId: string;
    userId: string;
    allowedFileTypes: string[];
    maxFileSizeMb?: number;
    maxFiles?: number;
    onFilesChange: (fileUrls: string[]) => void;
    initialUrls?: string[];
    disabled?: boolean;
};

/** Nama tampilan dari URL storage; decodeURIComponent bisa melempar pada % ilegal. */
function fileNameFromUrl(url: string, fallback: string): string {
    const raw = url.split('?')[0].split('/').pop() || '';
    if (!raw) return fallback;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

let uploadSeq = 0;

export default function AssignmentUploader({
    examId,
    userId,
    allowedFileTypes,
    maxFileSizeMb = 20,
    maxFiles = 5,
    onFilesChange,
    initialUrls = [],
    disabled = false,
}: Props) {
    const buildFromUrls = (urls: string[], previous: UploadedFile[] = []): UploadedFile[] =>
        urls.map((url, i) => {
            const known = previous.find(p => p.url === url);
            if (known) return known;
            return {
                id: `url-${i}-${url}`,
                name: fileNameFromUrl(url, `File ${i + 1}`),
                size: 0,
                url,
                type: '',
            };
        });

    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(() => buildFromUrls(initialUrls));
    const [isDragging, setIsDragging] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Daftar file dipegang juga di ref supaya proses upload yang berjalan async
    // selalu menghitung dari daftar termutakhir, bukan dari closure saat proses
    // dimulai (drop dua batch berturut-turut dulu saling menimpa).
    const filesRef = useRef<UploadedFile[]>(uploadedFiles);
    const inFlightRef = useRef(0);
    // Callback selalu dipanggil lewat ref: prop `onFilesChange` dibuat ulang
    // tiap render induk, dan versi lama membawa nilai jawaban yang basi.
    const onFilesChangeRef = useRef(onFilesChange);

    useEffect(() => {
        onFilesChangeRef.current = onFilesChange;
    }, [onFilesChange]);

    // Sinkronisasi dari induk. Tanpa ini, komponen yang di-mount ulang (pindah
    // soal lalu kembali, atau jawaban tersimpan yang baru tiba setelah render
    // pertama) menampilkan daftar kosong — dan unggahan berikutnya menghapus
    // URL lama dari jawaban karena hanya mengirim isi state internal.
    useEffect(() => {
        const incoming = initialUrls || [];
        const current = filesRef.current.map(f => f.url);
        const same = incoming.length === current.length && incoming.every((u, i) => u === current[i]);
        if (same) return;
        const next = buildFromUrls(incoming, filesRef.current);
        filesRef.current = next;
        setUploadedFiles(next);
        // Tidak memanggil onFilesChange: ini arus masuk dari induk, bukan perubahan kita.
    }, [initialUrls]);

    /** Satu-satunya jalan mengubah daftar: simpan ke ref + state, lalu beritahu induk. */
    const commit = useCallback((next: UploadedFile[]) => {
        filesRef.current = next;
        setUploadedFiles(next);
        onFilesChangeRef.current(next.map(f => f.url));
    }, []);

    const acceptedTypes = allowedFileTypes.map(t => `.${t}`).join(',');
    const maxSizeBytes = maxFileSizeMb * 1024 * 1024;

    const getFileIcon = (name: string) => {
        const ext = name.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return <ImageIcon size={16} className="text-blue-500" />;
        if (ext === 'pdf') return <FileText size={16} className="text-red-500" />;
        return <File size={16} className="text-slate-500" />;
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const validateFile = useCallback((file: File): string | null => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!allowedFileTypes.includes(ext || '')) {
            return `Jenis file .${ext} tidak diizinkan. Gunakan: ${allowedFileTypes.map(t => `.${t}`).join(', ')}`;
        }
        if (file.size > maxSizeBytes) {
            return `File terlalu besar. Maksimum ${maxFileSizeMb}MB.`;
        }
        return null;
    }, [allowedFileTypes, maxFileSizeMb, maxSizeBytes]);

    const processFiles = useCallback(async (files: FileList | File[]) => {
        const newErrors: string[] = [];
        const filesToUpload: File[] = [];

        for (const file of Array.from(files)) {
            // Kuota dihitung dari ref + jumlah upload yang masih berjalan agar
            // dua batch beruntun tidak sama-sama merasa masih ada tempat.
            const used = filesRef.current.length + inFlightRef.current + filesToUpload.length;
            if (used >= maxFiles) {
                newErrors.push(`Maksimum ${maxFiles} file diizinkan.`);
                break;
            }
            const err = validateFile(file);
            if (err) {
                newErrors.push(`${file.name}: ${err}`);
            } else {
                filesToUpload.push(file);
            }
        }

        setErrors(newErrors);

        for (const file of filesToUpload) {
            const tempId = `uploading-${++uploadSeq}`;
            inFlightRef.current += 1;
            setUploadingFiles(prev => [...prev, `${tempId}::${file.name}`]);

            const folder = `assignments/${examId}/${userId}`;
            let result: Awaited<ReturnType<typeof uploadToHosting>>;
            try {
                result = await uploadToHosting(file, folder);
            } catch (err: unknown) {
                result = {
                    success: false,
                    error: err instanceof Error ? err.message : 'Kesalahan tidak diketahui',
                };
            } finally {
                inFlightRef.current -= 1;
                setUploadingFiles(prev => prev.filter(entry => !entry.startsWith(`${tempId}::`)));
            }

            if (result.success && result.url) {
                commit([
                    ...filesRef.current,
                    {
                        id: `file-${++uploadSeq}`,
                        name: file.name,
                        size: file.size,
                        url: result.url,
                        type: file.type,
                    },
                ]);
            } else {
                setErrors(prev => [...prev, `Gagal mengunggah ${file.name}: ${result.error}`]);
            }
        }
    }, [examId, userId, maxFiles, commit, validateFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        processFiles(e.dataTransfer.files);
    }, [disabled, processFiles]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) processFiles(e.target.files);
        e.target.value = '';
    };

    const handleRemove = (file: UploadedFile) => {
        // Best-effort: penghapusan objek diurus server (provider-agnostic).
        deleteFromHosting(file.url).catch(console.error);
        commit(filesRef.current.filter(f => f.url !== file.url));
    };

    const isUploading = uploadingFiles.length > 0;
    const canUpload = !disabled && uploadedFiles.length + uploadingFiles.length < maxFiles;

    return (
        <div className="space-y-3">
            {/* Drop Zone */}
            {canUpload && (
                <div
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${isDragging
                        ? 'border-amber-400 bg-amber-50 scale-[1.01]'
                        : 'border-slate-300 hover:border-amber-400 hover:bg-amber-50/50'
                        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={acceptedTypes}
                        onChange={handleFileInput}
                        className="hidden"
                        disabled={disabled}
                    />
                    <div className="flex flex-col items-center gap-2">
                        {isUploading ? (
                            <Loader2 size={28} className="text-amber-500 animate-spin" />
                        ) : (
                            <Upload size={28} className={`transition-colors ${isDragging ? 'text-amber-500' : 'text-slate-400'}`} />
                        )}
                        <div>
                            <p className="text-sm font-medium text-slate-700">
                                {isUploading ? 'Mengunggah...' : 'Klik atau seret file ke sini'}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Format: {allowedFileTypes.map(t => `.${t}`).join(', ')} • Maks. {maxFileSizeMb}MB per file
                            </p>
                            <p className="text-xs text-slate-400">{uploadedFiles.length}/{maxFiles} file</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Sedang diunggah — jangan tutup tab sebelum selesai */}
            {uploadingFiles.length > 0 && (
                <div className="space-y-2">
                    {uploadingFiles.map(entry => {
                        const [id, ...rest] = entry.split('::');
                        return (
                            <div key={id} className="flex items-center gap-3 p-3 bg-amber-50/60 rounded-xl border border-amber-200">
                                <Loader2 size={14} className="text-amber-500 animate-spin shrink-0" />
                                <p className="text-xs font-medium text-amber-700 truncate">
                                    Mengunggah {rest.join('::')}…
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600">File yang diunggah:</p>
                    {uploadedFiles.map(file => (
                        <div
                            key={file.id}
                            className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 group"
                        >
                            {getFileIcon(file.name)}
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-slate-700 truncate">{file.name}</p>
                                {file.size > 0 && (
                                    <p className="text-[10px] text-slate-400">{formatSize(file.size)}</p>
                                )}
                            </div>
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => handleRemove(file)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    title="Hapus file"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Errors */}
            {errors.length > 0 && (
                <div className="space-y-1">
                    {errors.map((err, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-200">
                            <AlertCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-600">{err}</p>
                            <button type="button" onClick={() => setErrors(prev => prev.filter((_, j) => j !== i))} className="ml-auto text-red-400 hover:text-red-600">
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
