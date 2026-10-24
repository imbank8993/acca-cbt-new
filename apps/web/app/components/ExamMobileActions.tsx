"use client";

import { useState } from 'react';
import type { OrganizationExam } from '@/lib/api/proctor';
import { Archive, CloudUpload, CloudOff, FileText, MoreHorizontal, Settings, Trash2, Unlock, Users } from 'lucide-react';
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
        <div className="exam-mobile-action-row px-4 pb-4 sm:hidden">
            <Button className="exam-mobile-publish" aria-label={exam.is_published ? 'Unpublish' : 'Publish'} type="button" size="sm" variant={exam.is_published ? 'unpublish' : 'primary'}
                isLoading={busy}
                disabled={!exam.canManage || exam.status === 'archived' || (!exam.is_published && !canPublish)}
                leftIcon={exam.is_published ? <CloudOff size={16} /> : <CloudUpload size={16} />}
                title={!exam.is_published && !canPublish ? 'Tugaskan ke kelas terlebih dahulu sebelum mempublish' : undefined}
                onClick={onPublish}>{exam.is_published ? 'Unpublish' : 'Publish'}</Button>
            <Button mobileIconOnly aria-label="Monitor ujian" title="Monitor ujian" type="button" size="sm" variant="primary" leftIcon={<i className="fa-solid fa-chart-line" aria-hidden="true" />} onClick={onMonitor}>Monitor</Button>
            {canShare && <CollaborationButton mobileIconOnly className="min-w-0" type="exam" resourceId={exam.id} collaboratorCount={exam.collaboratorCount} onChanged={onChanged} />}
            <Button mobileIconOnly aria-label="Aksi lainnya" title="Aksi lainnya" type="button" size="sm" variant="outline" leftIcon={<MoreHorizontal size={16} />}
                className="min-w-0" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Lainnya</Button>
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
