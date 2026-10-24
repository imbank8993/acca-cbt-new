"use client";

import { useState } from 'react';
import type { OrganizationExam } from '@/lib/api/proctor';
import { Archive, Eye, EyeOff, FileText, MoreHorizontal, Settings, Trash2, Unlock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody } from '@/components/ui/modal';
import { CollaborationButton } from './CollaborationButton';

interface ExamMobileActionsProps {
    exam: OrganizationExam;
    busy: boolean;
    canPublish: boolean;
    onPublish: () => void;
    onMonitor: () => void;
    onEdit: () => void;
    onAssign: () => void;
    onArchive: () => void;
    onDelete: () => void;
    onReview: () => void;
    onChanged: () => void;
}

export function ExamMobileActions({ exam, busy, canPublish, onPublish, onMonitor, onEdit, onAssign, onArchive, onDelete, onReview, onChanged }: ExamMobileActionsProps) {
    const [open, setOpen] = useState(false);
    const act = (callback: () => void) => { setOpen(false); callback(); };
    const canShare = exam.canShare || exam.collaborationPermission;
    return <>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:hidden">
            <Button type="button" size="sm" variant="primary" icon="preview" onClick={onMonitor}>Monitor</Button>
            <Button type="button" size="sm" variant={exam.is_published ? 'unpublish' : 'primary'}
                isLoading={busy}
                disabled={!exam.canManage || exam.status === 'archived' || (!exam.is_published && !canPublish)}
                leftIcon={exam.is_published ? <EyeOff size={16} /> : <Eye size={16} />}
                title={!exam.is_published && !canPublish ? 'Tugaskan ke kelas terlebih dahulu sebelum mempublish' : undefined}
                onClick={onPublish}>{exam.is_published ? 'Unpublish' : 'Publish'}</Button>
            <div className="col-span-2 flex flex-wrap gap-2">
            {canShare && <CollaborationButton className="flex-1 basis-40 min-w-0" type="exam" resourceId={exam.id} collaboratorCount={exam.collaboratorCount} onChanged={onChanged} />}
            <Button type="button" size="sm" variant="outline" leftIcon={<MoreHorizontal size={16} />}
                className="flex-1 basis-24" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Lainnya</Button>
            </div>
        </div>
        <Modal open={open} onClose={() => setOpen(false)} title="Aksi ujian" size="sm">
            <ModalBody>
                <p className="text-sm text-slate-500 break-words">{exam.title}</p>
                <div className="flex flex-col gap-2">
                    <Button type="button" variant="outline" leftIcon={<Settings size={16} />} disabled={!exam.canManage} onClick={() => act(onEdit)}>Pengaturan</Button>
                    <Button type="button" variant="outline" leftIcon={<Users size={16} />} disabled={!exam.canManage} onClick={() => act(onAssign)}>Peserta dan penugasan</Button>
                    {exam.canManage && exam.exam_type === 'assignment' && <Button type="button" variant="outline" leftIcon={<FileText size={16} />} onClick={() => act(onReview)}>Review tugas</Button>}
                    <Button type="button" variant="outline" leftIcon={exam.status === 'archived' ? <Unlock size={16} /> : <Archive size={16} />} disabled={!exam.canManage} onClick={() => act(onArchive)}>{exam.status === 'archived' ? 'Pulihkan sebagai draf' : 'Arsipkan'}</Button>
                    <Button type="button" variant="danger" leftIcon={<Trash2 size={16} />} disabled={!exam.canDelete} onClick={() => act(onDelete)}>Hapus</Button>
                </div>
            </ModalBody>
        </Modal>
    </>;
}
