'use client';

import React, { useState } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { deleteExam, purgeTrialExam } from '@/lib/api/exams';
import type { OrganizationExam } from '@/lib/api/proctor';

interface DeleteExamModalProps {
    isOpen: boolean;
    onClose: () => void;
    exam: OrganizationExam | null;
    onSuccess: () => Promise<void> | void;
}

export const DeleteExamModal: React.FC<DeleteExamModalProps> = ({
    isOpen,
    onClose,
    exam,
    onSuccess,
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen || !exam) return null;

    const handleDelete = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const result = await deleteExam(exam.id);
            if (result.success) {
                onClose();
                await onSuccess();
            } else if (/pengerjaan siswa|sertifikat/i.test(result.error || '')) {
                if (exam.is_published) {
                    setError('Batalkan publikasi ujian terlebih dahulu sebelum membersihkan data uji coba.');
                } else {
                    const confirmation = prompt(
                        `Jika ini benar-benar ujian uji coba, ketik judul berikut untuk menghapus seluruh hasil secara permanen:\n\n${exam.title}`,
                    );
                    if (confirmation !== null) {
                        const purge = await purgeTrialExam(exam.id, confirmation);
                        if (purge.success) {
                            alert(`Ujian uji coba dan ${purge.purgedAttempts} pengerjaan berhasil dihapus.`);
                            onClose();
                            await onSuccess();
                        } else {
                            setError(purge.error || 'Data uji coba gagal dihapus.');
                        }
                    }
                }
            } else {
                setError(result.error || 'Ujian gagal dihapus.');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menghapus ujian.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            size="sm"
            variant="delete"
            title="Hapus Ujian"
            subtitle="Tindakan ini tidak dapat dibatalkan"
            icon="trash"
        >
            <ModalBody>
                {error && (
                    <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 text-left">
                        {error}
                    </div>
                )}
                <p className="text-sm text-slate-600">
                    Apakah Anda yakin ingin menghapus ujian <strong className="text-slate-900">&quot;{exam.title}&quot;</strong>? Ujian hanya dapat dihapus jika belum pernah dikerjakan siswa.
                </p>
            </ModalBody>
            <ModalFooter align="between">
                <Button
                    type="button"
                    variant="cancel"
                    onClick={onClose}
                    icon="cancel"
                    disabled={isSubmitting}
                >
                    Batal
                </Button>
                <Button
                    type="button"
                    variant="danger"
                    onClick={handleDelete}
                    isLoading={isSubmitting}
                    icon="trash"
                >
                    Hapus
                </Button>
            </ModalFooter>
        </Modal>
    );
};
