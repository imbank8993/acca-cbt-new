'use client';

/**
 * Modal — satu kerangka dialog yang dipakai bersama semua halaman.
 *
 * Yang diseragamkan HANYA kerangkanya: overlay, panel, header, dan footer.
 * Isi body tetap milik masing-masing halaman karena formulirnya memang beda.
 *
 * Gaya-nya ada di `modal.css` (file CSS biasa, bukan <style jsx>,
 * supaya tetap berlaku saat dipakai sebagai subkomponen).
 */

import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';
import './modal.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
export type ModalVariant = 'default' | 'add' | 'edit' | 'delete';

/* ---------------------------------- Shell ---------------------------------- */

export function Modal({
    open = true,
    children,
    onClose,
    size = 'md',
    variant = 'default',
    title,
    subtitle,
    icon,
    labelledBy,
    className = '',
    closeOnOverlayClick = true,
}: {
    open?: boolean;
    children: ReactNode;
    onClose: () => void;
    size?: ModalSize;
    /**
     * Menentukan warna garis tepi panel (dan ikon judul di dalamnya).
     * Ditaruh di sini, bukan di ModalHeader, karena garisnya mengelilingi
     * seluruh panel — bukan hanya headernya.
     */
    variant?: ModalVariant;
    title?: ReactNode;
    subtitle?: ReactNode;
    /** Nama ikon Bootstrap tanpa awalan (mis. "pencil-square"), atau elemen ikon siap pakai. */
    icon?: string | ReactNode;
    /** id elemen judul (dipakai ModalHeader) untuk aria-labelledby */
    labelledBy?: string;
    className?: string;
    closeOnOverlayClick?: boolean;
}) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Escape untuk menutup + kunci scroll body selama modal terbuka.
    useEffect(() => {
        if (!open || !mounted) return;
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, mounted, onClose]);

    if (!open || !mounted) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="mdl-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            // mousedown, bukan click: menyeret teks dari dalam panel lalu melepas
            // di luar tidak boleh ikut menutup modal.
            onMouseDown={e => { if (closeOnOverlayClick && e.target === e.currentTarget) onClose(); }}
        >
            <div className={`mdl-panel mdl-panel--${size} mdl-panel--${variant} ${className}`.trim()}>
                {title && <ModalHeader title={title} subtitle={subtitle} icon={icon} onClose={onClose} id={labelledBy} />}
                {children}
            </div>
        </div>,
        document.body
    );
}

/* --------------------------------- Header ---------------------------------- */

export function ModalHeader({
    title,
    subtitle,
    icon,
    onClose,
    id,
    variant,
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    /** Nama ikon Bootstrap tanpa prefix (mis. "pencil-square"), atau elemen ikon siap pakai. */
    icon?: string | ReactNode;
    onClose?: () => void;
    id?: string;
    variant?: ModalVariant;
}) {
    return (
        <div className={`mdl-head ${subtitle ? '' : 'mdl-head--solo'}`.trim()}>
            {icon && (
                <span className="mdl-head__icon" aria-hidden="true">
                    {typeof icon === 'string' ? <i className={`bi bi-${icon}`} /> : icon}
                </span>
            )}
            <div className="mdl-head__text">
                <h2 className="mdl-head__title" id={id}>
                    <span className="mdl-head__titleText">{title}</span>
                </h2>
                {subtitle && <div className="mdl-head__sub">{subtitle}</div>}
            </div>
            {onClose && (
                <button type="button" className="mdl-head__x" onClick={onClose} aria-label="Tutup">
                    <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
            )}
        </div>
    );
}

/* ---------------------------------- Body ----------------------------------- */

export function ModalBody({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
    return <div className={`mdl-body ${className}`.trim()} style={style}>{children}</div>;
}

/* --------------------------------- Footer ---------------------------------- */

export function ModalFooter({
    children,
    align = 'end',
    className = '',
}: {
    children: ReactNode;
    /** 'end' (default) atau 'between' bila ada aksi sekunder di kiri. */
    align?: 'end' | 'between';
    className?: string;
}) {
    return <div className={`mdl-foot mdl-foot--${align} ${className}`.trim()}>{children}</div>;
}

/* ------------------------------ View footer -------------------------------- */

export function ModalViewFooter({
    onClose,
    onEdit,
    onDelete,
    extraActions,
    showClose = false,
    closeLabel = 'Tutup',
    editLabel = 'Edit Data',
    deleteLabel = 'Hapus',
    isDeleting = false,
}: {
    onClose?: () => void;
    /** Bila diisi, tombol "Edit Data" tampil dan memanggil ini */
    onEdit?: () => void;
    /** Bila diisi, tombol "Hapus" tampil di kiri footer. */
    onDelete?: () => void;
    /** Tombol tambahan di sisi kanan, sebelum "Edit Data" */
    extraActions?: React.ReactNode;
    showClose?: boolean;
    closeLabel?: string;
    editLabel?: string;
    deleteLabel?: string;
    isDeleting?: boolean;
}) {
    return (
        <ModalFooter align="between" className="mdl-viewFoot">
            {onDelete ? (
                <Button
                    type="button"
                    variant="danger"
                    onClick={onDelete}
                    isLoading={isDeleting}
                    icon="delete"
                >
                    {deleteLabel}
                </Button>
            ) : <div />}
            <div className="mdl-viewFoot__right">
                {showClose && onClose && (
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={onClose}
                        icon="cancel"
                    >
                        {closeLabel}
                    </Button>
                )}
                {extraActions}
                {onEdit && (
                    <Button
                        type="button"
                        variant="edit"
                        onClick={onEdit}
                        icon="edit"
                    >
                        {editLabel}
                    </Button>
                )}
            </div>
        </ModalFooter>
    );
}

/* ------------------------------ Form Field ---------------------------------- */

export function ModalField({
    label,
    hint,
    required = false,
    children,
}: {
    label: ReactNode;
    hint?: ReactNode;
    required?: boolean;
    children: ReactNode;
}) {
    return (
        <div className="mdl-field">
            <span className="mdl-field__label">
                {label}
                {required && <span className="mdl-field__req" aria-hidden="true"> *</span>}
            </span>
            <span className="mdl-field__control">{children}</span>
            {hint && <small className="mdl-field__hint">{hint}</small>}
        </div>
    );
}

/* ---------------------------- File Input ------------------------------------ */

export function ModalFileInput({
    files,
    onPick,
    accept,
    multiple = false,
    placeholder = 'Pilih berkas atau jatuhkan di sini',
    disabled = false,
}: {
    files: File[];
    onPick: (files: File[]) => void;
    accept?: string;
    multiple?: boolean;
    placeholder?: string;
    disabled?: boolean;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const open = () => {
        if (!disabled) inputRef.current?.click();
    };

    const removeAt = (idx: number) => {
        onPick(files.filter((_, i) => i !== idx));
    };

    const formatSize = (bytes: number) => {
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    };

    return (
        <div className="mdl-file">
            <div
                className={`mdl-file__row ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`.trim()}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={open}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                }}
                onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    if (disabled) return;
                    const dropped = Array.from(e.dataTransfer.files || []);
                    if (dropped.length) onPick(multiple ? [...files, ...dropped] : dropped.slice(0, 1));
                }}
            >
                <span className="mdl-file__icon" aria-hidden="true">
                    <i className="bi bi-cloud-arrow-up-fill" />
                </span>
                <span className="mdl-file__text">
                    {files.length === 0
                        ? placeholder
                        : files.length === 1
                            ? files[0].name
                            : `${files.length} berkas dipilih`}
                </span>
                <span className="mdl-file__btn">Telusuri</span>
            </div>

            <input
                ref={inputRef}
                type="file"
                className="mdl-file__native"
                accept={accept}
                multiple={multiple}
                disabled={disabled}
                onChange={e => {
                    const picked = Array.from(e.target.files || []);
                    if (picked.length) onPick(multiple ? [...files, ...picked] : picked);
                    e.target.value = '';
                }}
            />

            {files.length > 0 && (
                <ul className="mdl-file__list">
                    {files.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="mdl-file__chip">
                            <i className="bi bi-file-earmark mdl-file__chipIcon" aria-hidden="true" />
                            <span className="mdl-file__chipName" title={f.name}>{f.name}</span>
                            <span className="mdl-file__chipSize">{formatSize(f.size)}</span>
                            <button
                                type="button"
                                className="mdl-file__chipX"
                                onClick={() => removeAt(i)}
                                aria-label={`Buang ${f.name}`}
                                disabled={disabled}
                            >
                                <i className="bi bi-x-lg" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/* ---------------------------- Detail Grid ----------------------------------- */

export function ModalDetailGrid({ children }: { children: ReactNode }) {
    return <div className="mdl-detail__grid">{children}</div>;
}

export function ModalDetailField({
    icon,
    label,
    full = false,
    mode = 'view',
    editor,
    children,
}: {
    icon?: string;
    label: string;
    full?: boolean;
    mode?: 'view' | 'edit';
    editor?: ReactNode;
    children?: ReactNode;
}) {
    const showEditor = mode === 'edit' && editor;
    return (
        <div className={`mdl-detail__item ${full ? 'mdl-detail__item--full' : ''} ${icon ? 'mdl-detail__item--has-icon' : ''}`.trim()}>
            <div className="mdl-detail__content">
                <div className="mdl-detail__label">
                    {icon && (
                        <span className="mdl-detail__label-icon" aria-hidden="true">
                            <i className={`bi bi-${icon}`} />
                        </span>
                    )}
                    <span>{label}</span>
                </div>
                {showEditor ? (
                    <div className="mdl-detail__editor">{editor}</div>
                ) : (
                    <div className="mdl-detail__value">{children}</div>
                )}
            </div>
        </div>
    );
}

export function ModalDetailFooter({
    mode,
    onClose,
    onEdit,
    onCancelEdit,
    onSave,
    isSaving = false,
    onDelete,
    isDeleting = false,
    closeLabel = 'Tutup',
    editLabel = 'Edit Data',
    cancelLabel = 'Batal',
    saveLabel = 'Simpan Perubahan',
    deleteLabel = 'Hapus',
}: {
    mode: 'view' | 'edit';
    onClose: () => void;
    onEdit?: () => void;
    onCancelEdit?: () => void;
    onSave?: () => void;
    isSaving?: boolean;
    onDelete?: () => void;
    isDeleting?: boolean;
    closeLabel?: string;
    editLabel?: string;
    cancelLabel?: string;
    saveLabel?: string;
    deleteLabel?: string;
}) {
    if (mode === 'edit') {
        return (
            <ModalFooter align="between">
                {onDelete ? (
                    <Button type="button" variant="danger" onClick={onDelete} isLoading={isDeleting} leftIcon={<i className="bi bi-trash" />}>
                        {deleteLabel}
                    </Button>
                ) : <div />}
                <div className="mdl-viewFoot__right">
                    <Button type="button" variant="cancel" onClick={onCancelEdit} disabled={isSaving} leftIcon={<i className="bi bi-x-lg" />}>
                        {cancelLabel}
                    </Button>
                    <Button type="button" variant="primary" onClick={onSave} isLoading={isSaving} leftIcon={<i className="bi bi-check-lg" />}>
                        {saveLabel}
                    </Button>
                </div>
            </ModalFooter>
        );
    }
    return (
        <ModalViewFooter
            onClose={onClose}
            onEdit={onEdit}
            onDelete={onDelete}
            isDeleting={isDeleting}
            closeLabel={closeLabel}
            editLabel={editLabel}
            deleteLabel={deleteLabel}
        />
    );
}

export default Modal;
