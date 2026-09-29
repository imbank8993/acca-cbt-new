'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Folder,
    Loader2,
    Plus,
    Trash2,
    Upload,
} from 'lucide-react';
import Image from 'next/image';
import { Modal, ModalBody, ModalFooter, ModalField, type ModalSize } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { InlineSelect } from '@/components/ui/InlineSelect';
import ImageCropperModal from '@/app/components/ImageCropperModal';
import {
    createQuestionBank,
    updateQuestionBankAction,
    createOrganizationLabel,
    listOrganizationLabels,
} from '@/lib/api/questions';
import type { BankFolder, OrganizationLabel, QuestionBank } from '@/lib/api/questions';
import type { SchoolSubject } from '@/lib/api/proctor';
import { uploadToHosting } from '@/lib/uploader';
import { getErrorMessage } from '@/lib/errors';

export interface CreateBankModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => Promise<void> | void;
    editingBank?: QuestionBank | null;
    defaultFolderId?: string;
    folders?: BankFolder[];
    labels?: OrganizationLabel[];
    orgSubjects?: SchoolSubject[];
    onLabelsUpdated?: (labels: OrganizationLabel[]) => void;
    size?: ModalSize;
}

interface BankFormData {
    title: string;
    description: string;
    subject: string;
    classLevel: string;
    iconIdentifier: string;
    imageUrl: string;
    tags: string[];
    folderId: string | undefined;
}

const DEFAULT_FORM_DATA: BankFormData = {
    title: '',
    description: '',
    subject: '',
    classLevel: '',
    iconIdentifier: 'BookOpen',
    imageUrl: '',
    tags: [],
    folderId: undefined,
};

export const CreateBankModal: React.FC<CreateBankModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    editingBank = null,
    defaultFolderId,
    folders = [],
    labels = [],
    orgSubjects = [],
    onLabelsUpdated,
    size = 'lg',
}) => {
    const [formData, setFormData] = useState<BankFormData>(DEFAULT_FORM_DATA);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [newCustomLabel, setNewCustomLabel] = useState('');
    const [error, setError] = useState<string | null>(null);
    // Crop state — gambar sementara sebelum di-upload
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [showCropper, setShowCropper] = useState(false);

    // Sync form state when modal opens or editingBank changes
    useEffect(() => {
        if (!isOpen) return;
        const initializeId = window.setTimeout(() => {
            setError(null);
            setNewCustomLabel('');
            if (editingBank) {
                setFormData({
                    title: editingBank.title || '',
                    description: editingBank.description || '',
                    subject: editingBank.subject || '',
                    classLevel: editingBank.class_level || '',
                    iconIdentifier: editingBank.icon_identifier || 'BookOpen',
                    imageUrl: editingBank.image_url || '',
                    tags: editingBank.tags || [],
                    folderId: editingBank.folder_id || undefined,
                });
            } else {
                setFormData({
                    ...DEFAULT_FORM_DATA,
                    folderId: defaultFolderId || undefined,
                });
            }
        }, 0);
        return () => window.clearTimeout(initializeId);
    }, [isOpen, editingBank, defaultFolderId]);

    // Tingkat Kelas options (preserves custom values if existing)
    const classLevelOptions = useMemo(() => {
        const base = [
            { value: '', label: '— Pilih Tingkat Kelas —' },
            { value: 'Kelas 10', label: 'Kelas 10 (SMA)' },
            { value: 'Kelas 11', label: 'Kelas 11 (SMA)' },
            { value: 'Kelas 12', label: 'Kelas 12 (SMA)' },
            { value: 'Umum', label: 'Umum (Guru/Trainer)' },
        ];
        if (formData.classLevel && !base.some((opt) => opt.value === formData.classLevel)) {
            base.push({ value: formData.classLevel, label: formData.classLevel });
        }
        return base;
    }, [formData.classLevel]);

    // Mata Pelajaran options
    const subjectOptions = useMemo(() => {
        const base: { value: string; label: string }[] = [
            { value: '', label: '— Pilih Mata Pelajaran —' },
            ...orgSubjects.map((sub) => ({ value: sub.name, label: sub.name })),
        ];
        // Preserve custom value if editing a bank that has a subject not in orgSubjects
        if (formData.subject && !base.some((opt) => opt.value === formData.subject)) {
            base.push({ value: formData.subject, label: formData.subject });
        }
        return base;
    }, [orgSubjects, formData.subject]);


    // Folder options
    const folderOptions = useMemo(() => {
        return [
            { value: '', label: '— Tanpa Folder (Folder Utama) —' },
            ...folders.map((folder) => ({
                value: folder.id,
                label: folder.name,
            })),
        ];
    }, [folders]);

    // All display labels (including custom tags on this bank)
    const allDisplayTags = useMemo(() => {
        const list: { id: string; name: string; color: string }[] = [...labels];
        for (const tag of formData.tags) {
            if (!list.some((l) => l.name === tag)) {
                list.push({ id: `tag-${tag}`, name: tag, color: '#3083FF' });
            }
        }
        return list;
    }, [labels, formData.tags]);

    // Step 1 — buka cropper saat file dipilih
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        setCropSrc(objectUrl);
        setShowCropper(true);
        e.target.value = '';
    };

    // Step 2 — upload hasil crop (dataURL → Blob → File)
    const handleCropComplete = async (croppedDataUrl: string) => {
        setShowCropper(false);
        setUploadingImage(true);
        setError(null);
        try {
            const res = await fetch(croppedDataUrl);
            const blob = await res.blob();
            const file = new File([blob], 'cover.jpg', { type: 'image/jpeg' });
            const result = await uploadToHosting(file, 'banks', formData.imageUrl);
            if (result.success && result.url) {
                setFormData((prev) => ({ ...prev, imageUrl: result.url || '', iconIdentifier: '' }));
            } else {
                setError(result.error || 'Gagal mengunggah cover');
            }
        } catch (err) {
            setError('Gagal upload: ' + getErrorMessage(err));
        } finally {
            setUploadingImage(false);
            if (cropSrc) URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
        }
    };

    const toggleTag = (tag: string) => {
        setFormData((prev) => ({
            ...prev,
            tags: prev.tags.includes(tag)
                ? prev.tags.filter((t) => t !== tag)
                : [...prev.tags, tag],
        }));
    };

    const handleCreateCustomLabel = async () => {
        const labelName = newCustomLabel.trim();
        if (!labelName) return;

        const existingLabel = labels.find((l) => l.name.toLowerCase() === labelName.toLowerCase());
        if (existingLabel) {
            if (!formData.tags.includes(existingLabel.name)) {
                setFormData((prev) => ({ ...prev, tags: [...prev.tags, existingLabel.name] }));
            }
            setNewCustomLabel('');
            return;
        }

        const colors = ['#6366f1', '#ec4899', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        try {
            const result = await createOrganizationLabel(labelName, randomColor);
            if (result.success) {
                const labelList = await listOrganizationLabels();
                if (onLabelsUpdated && labelList) {
                    onLabelsUpdated(labelList);
                }
                setFormData((prev) => ({ ...prev, tags: [...prev.tags, labelName] }));
                setNewCustomLabel('');
            } else {
                setError('Gagal membuat label: ' + result.error);
            }
        } catch (err) {
            setError('Error: ' + getErrorMessage(err));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title.trim()) {
            setError('Judul bank soal wajib diisi.');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            let result: Awaited<ReturnType<typeof createQuestionBank>>;
            if (editingBank) {
                result = await updateQuestionBankAction(editingBank.id, {
                    title: formData.title.trim(),
                    description: formData.description.trim(),
                    subject: formData.subject.trim(),
                    classLevel: formData.classLevel,
                    iconIdentifier: formData.iconIdentifier,
                    imageUrl: formData.imageUrl,
                    tags: formData.tags,
                    folderId: formData.folderId || null,
                });
            } else {
                result = await createQuestionBank({
                    title: formData.title.trim(),
                    description: formData.description.trim(),
                    subject: formData.subject.trim(),
                    classLevel: formData.classLevel,
                    iconIdentifier: formData.iconIdentifier,
                    imageUrl: formData.imageUrl,
                    tags: formData.tags,
                    folderId: formData.folderId || null,
                });
            }

            if (result.success) {
                onClose();
                await onSuccess();
            } else {
                setError(result.error || 'Gagal menyimpan bank soal.');
            }
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
        <Modal
            open={isOpen}
            onClose={onClose}
            size={size}
            variant={editingBank ? 'edit' : 'add'}
            title={editingBank ? 'Edit Bank Soal' : 'Buat Bank Soal Baru'}
            icon={editingBank ? 'pencil-square' : 'journal-plus'}
            labelledBy="modal-bank-soal"
        >
            <form onSubmit={handleSubmit}>
                <ModalBody className="space-y-4 max-h-[75vh] overflow-y-auto">
                    {/* Error Notice */}
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
                            <AlertCircle size={16} className="flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Judul Bank Soal */}
                    <ModalField label="Judul Bank Soal" required>
                        <input
                            required
                            type="text"
                            placeholder="Contoh: Penilaian Harian Matematika Wajib Bab 1"
                            value={formData.title}
                            onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                        />
                    </ModalField>

                    {/* Grid 2 Kolom: Mata Pelajaran & Tingkat Kelas (InlineSelect) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <ModalField label="Mata Pelajaran">
                            <InlineSelect
                                value={formData.subject}
                                onChange={(val) => setFormData((prev) => ({ ...prev, subject: val }))}
                                options={subjectOptions}
                            />
                        </ModalField>

                        <ModalField label="Tingkat Kelas">
                            <InlineSelect
                                value={formData.classLevel}
                                onChange={(val) => setFormData((prev) => ({ ...prev, classLevel: val }))}
                                options={classLevelOptions}
                            />
                        </ModalField>
                    </div>

                    {/* Grid 2 Kolom: Folder Penyimpanan & Label (sebaris, tinggi kolom sama) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                        <ModalField label="Folder Penyimpanan" className="h-full flex flex-col">
                            <div className="flex flex-col h-full justify-between gap-2.5">
                                <InlineSelect
                                    value={formData.folderId || ''}
                                    onChange={(val) => setFormData((prev) => ({ ...prev, folderId: val || undefined }))}
                                    options={folderOptions}
                                />
                                <div className="flex-1 min-h-[50px] p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center gap-2.5 text-xs text-slate-500">
                                    <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 flex items-center justify-center text-primary flex-shrink-0 shadow-xs">
                                        <Folder size={15} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-slate-700 truncate text-[11px] leading-tight">
                                            {formData.folderId
                                                ? (folders.find((f) => f.id === formData.folderId)?.name || 'Folder Terpilih')
                                                : 'Folder Utama'}
                                        </div>
                                        <div className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">
                                            {formData.folderId
                                                ? 'Tersimpan di dalam folder ini'
                                                : 'Tersimpan di direktori utama (tanpa folder)'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ModalField>

                        <ModalField label="Label Bank Soal" className="h-full flex flex-col">
                            <div className="flex flex-col h-full justify-between gap-2.5">
                                <div className="flex gap-1.5">
                                    <input
                                        type="text"
                                        placeholder="Tambah label baru..."
                                        value={newCustomLabel}
                                        onChange={(e) => setNewCustomLabel(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleCreateCustomLabel();
                                            }
                                        }}
                                        className="flex-1 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        onClick={handleCreateCustomLabel}
                                        disabled={!newCustomLabel.trim()}
                                        className="px-2.5 py-1.5 text-xs flex-shrink-0"
                                    >
                                        <Plus size={13} />
                                        Tambah
                                    </Button>
                                </div>

                                <div className="flex-1 min-h-[50px] p-2 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col justify-center">
                                    {allDisplayTags.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 max-h-[54px] overflow-y-auto pr-0.5">
                                            {allDisplayTags.map((label) => {
                                                const isSelected = formData.tags.includes(label.name);
                                                return (
                                                    <button
                                                        key={label.id}
                                                        type="button"
                                                        onClick={() => toggleTag(label.name)}
                                                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                                                            isSelected
                                                                ? 'text-white shadow-xs'
                                                                : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'
                                                        }`}
                                                        style={
                                                            isSelected
                                                                ? { backgroundColor: label.color, borderColor: label.color }
                                                                : {}
                                                        }
                                                    >
                                                        {label.name}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-[11px] text-slate-400 text-center italic m-0">
                                            Belum ada label tersedia
                                        </p>
                                    )}
                                </div>
                            </div>
                        </ModalField>
                    </div>

                    {/* Deskripsi */}
                    <ModalField label="Deskripsi">
                        <textarea
                            placeholder="Deskripsi singkat mengenai isi bank soal ini (opsional)..."
                            value={formData.description}
                            onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                            rows={3}
                        />
                    </ModalField>

                    {/* Cover Bank Soal (Preview & Upload) */}
                    <ModalField label="Cover Bank Soal" hint="Format gambar JPG, PNG, atau WebP (opsional, rasio 1:1)">
                        {formData.imageUrl ? (
                            <div className="flex items-center gap-3.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                <div className="relative w-16 h-16 aspect-square rounded-xl overflow-hidden bg-slate-200 flex-shrink-0 border border-slate-300 shadow-xs">
                                    <Image
                                        src={formData.imageUrl}
                                        alt="Cover Preview"
                                        width={64}
                                        height={64}
                                        unoptimized
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                                    <span className="text-xs font-semibold text-slate-700">Cover Terpasang</span>
                                    <div className="flex items-center gap-3">
                                        <label className="text-xs font-medium text-primary hover:text-primary/80 cursor-pointer flex items-center gap-1">
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={handleImageUpload}
                                                disabled={uploadingImage}
                                            />
                                            <Upload size={12} />
                                            {uploadingImage ? 'Mengunggah...' : 'Ganti Cover'}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setFormData((prev) => ({ ...prev, imageUrl: '' }))}
                                            disabled={uploadingImage}
                                            className="text-xs font-medium text-rose-500 hover:text-rose-600 flex items-center gap-1"
                                        >
                                            <Trash2 size={12} />
                                            Hapus
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <label className="flex items-center gap-3 p-3.5 border border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-primary/50 hover:bg-slate-50/60 transition-all">
                                <input
                                    type="file"
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                    disabled={uploadingImage}
                                />
                                <div className="w-12 h-12 aspect-square rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
                                    {uploadingImage ? (
                                        <Loader2 size={18} className="animate-spin text-primary" />
                                    ) : (
                                        <Upload size={18} />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <span className="text-sm font-medium text-slate-700 block">
                                        {uploadingImage ? 'Sedang mengunggah cover...' : 'Klik untuk unggah cover'}
                                    </span>
                                    <p className="text-xs text-slate-400">Rekomendasi rasio 1:1 (persegi)</p>
                                </div>
                            </label>
                        )}
                    </ModalField>
                </ModalBody>

                <ModalFooter align="between">
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={onClose}
                        disabled={isSubmitting || uploadingImage}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        isLoading={isSubmitting || uploadingImage}
                        disabled={isSubmitting || uploadingImage || !formData.title.trim()}
                        icon="save"
                    >
                        {editingBank ? 'Simpan Perubahan' : 'Buat Bank Soal'}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>

        {/* Cropper 1:1 untuk cover bank soal */}
        {cropSrc && (
            <ImageCropperModal
                isOpen={showCropper}
                onClose={() => {
                    setShowCropper(false);
                    setCropSrc(null);
                }}
                imageSrc={cropSrc}
                aspect={1}
                onCropComplete={handleCropComplete}
            />
        )}
        </>
    );
};

export default CreateBankModal;
