import React from 'react';
import './action-buttons.css';

export type ActionType =
    | 'edit'
    | 'view'
    | 'delete'
    | 'file'
    | 'print'
    | 'settings'
    | 'import'
    | 'export'
    | 'add'
    | 'whatsapp'
    | 'surat'
    | 'download'
    | 'replace'
    | 'toggle'
    | 'catatan'
    | 'catatan_pembelajaran'
    | 'copy'
    | 'chart'
    | 'fill'
    | 'move'
    | 'approve'
    | 'reject';

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    action: ActionType;
    label?: string;
    iconOnly?: boolean;
    tooltipPos?: 'top' | 'bottom' | 'left' | 'right';
    tooltip?: string;
    isLoading?: boolean;
    size?: 'sm' | 'md' | 'lg' | string;
    icon?: React.ReactNode;
}

const ACTION_CONFIG: Record<ActionType, { iconClass: string; btnClass: string; defaultLabel: string; title: string }> = {
    edit: {
        iconClass: 'bi bi-pencil-fill',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Edit',
        title: 'Edit',
    },
    view: {
        iconClass: 'bi bi-card-text',
        btnClass: 'btn-icon-view',
        defaultLabel: 'Detail',
        title: 'Detail',
    },
    delete: {
        iconClass: 'bi bi-trash-fill',
        btnClass: 'btn-icon-delete',
        defaultLabel: 'Hapus',
        title: 'Hapus',
    },
    file: {
        iconClass: 'bi bi-paperclip',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'File',
        title: 'Lihat Dokumen',
    },
    print: {
        iconClass: 'bi bi-printer-fill',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Cetak',
        title: 'Cetak Surat',
    },
    settings: {
        iconClass: 'bi bi-gear-fill',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Pengaturan',
        title: 'Pengaturan',
    },
    import: {
        iconClass: 'bi bi-upload',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Import',
        title: 'Import Data',
    },
    export: {
        iconClass: 'bi bi-download',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Export',
        title: 'Export Data',
    },
    add: {
        iconClass: 'bi bi-plus-lg',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Tambah',
        title: 'Tambah Baru',
    },
    whatsapp: {
        iconClass: 'bi bi-whatsapp',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Kirim Info',
        title: 'Kirim Pesan WhatsApp',
    },
    surat: {
        iconClass: 'bi bi-envelope-paper',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Daftar Surat',
        title: 'Daftar Arsip Surat',
    },
    download: {
        iconClass: 'bi bi-download',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Unduh',
        title: 'Unduh File',
    },
    replace: {
        iconClass: 'bi bi-arrow-repeat',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Ganti',
        title: 'Ganti File',
    },
    toggle: {
        iconClass: 'bi bi-toggle-on',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Status',
        title: 'Ubah Status',
    },
    catatan: {
        iconClass: 'bi bi-pencil-square',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Catatan',
        title: 'Edit Catatan / Keterangan',
    },
    catatan_pembelajaran: {
        iconClass: 'bi bi-journal-plus',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Catatan Pembelajaran',
        title: 'Catatan Pembelajaran (Positif/Negatif)',
    },
    copy: {
        iconClass: 'bi bi-link-45deg',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Salin Link',
        title: 'Salin Link',
    },
    chart: {
        iconClass: 'bi bi-bar-chart-line-fill',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Hasil',
        title: 'Lihat Hasil Tanggapan',
    },
    fill: {
        iconClass: 'bi bi-pencil-square',
        btnClass: 'btn-icon-view',
        defaultLabel: 'Isi',
        title: 'Buka & Isi Formulir',
    },
    move: {
        iconClass: 'bi bi-arrow-left-right',
        btnClass: 'btn-icon-soft',
        defaultLabel: 'Pindah',
        title: 'Pindahkan',
    },
    approve: {
        iconClass: 'bi bi-check-lg',
        btnClass: 'btn-icon-approve',
        defaultLabel: 'Setujui',
        title: 'Setujui',
    },
    reject: {
        iconClass: 'bi bi-x-lg',
        btnClass: 'btn-icon-delete',
        defaultLabel: 'Tolak',
        title: 'Tolak',
    },
};

/**
 * Komponen ActionButton yang seragam untuk seluruh aplikasi.
 * Khusus untuk tombol ikon tabel (Edit, View, Delete, File, Print, dll).
 */
export function ActionButton({
    action,
    label,
    iconOnly = true,
    tooltipPos,
    tooltip,
    className = '',
    title,
    isLoading = false,
    disabled,
    size,
    icon,
    ...props
}: ActionButtonProps) {
    const config = ACTION_CONFIG[action];

    if (!config) return null;

    const buttonTitle = tooltip || title || config.title;
    const sizeClass = size === 'sm' ? 'btn-size-sm' : size === 'lg' ? 'btn-size-lg' : '';

    return (
        <button
            type="button"
            className={`${config.btnClass} ${sizeClass} ${!iconOnly ? 'btn-has-label' : ''} ${className}`.trim()}
            data-tooltip={iconOnly ? buttonTitle : undefined}
            data-tooltip-pos={tooltipPos}
            aria-label={buttonTitle}
            disabled={disabled || isLoading}
            {...props}
        >
            {isLoading ? (
                <i className="bi bi-arrow-repeat spin"></i>
            ) : icon ? (
                icon
            ) : (
                <i className={config.iconClass}></i>
            )}
            {!iconOnly && (
                <span style={{ fontSize: '0.8rem', fontWeight: 600, marginLeft: '0.35rem' }}>
                    {label || config.defaultLabel}
                </span>
            )}
        </button>
    );
}

/**
 * Wrapper untuk grup aksi (biasanya dalam sel tabel)
 * Supaya spacing antar tombol seragam.
 */
export function ActionGroup({
    children,
    className = '',
    align,
    style,
}: {
    children: React.ReactNode;
    className?: string;
    align?: 'left' | 'center' | 'right' | string;
    style?: React.CSSProperties;
}) {
    const alignClass = align === 'center' ? 'justify-center' : align === 'left' ? 'justify-start' : '';
    return (
        <div className={`ab-actions-row ${alignClass} ${className}`.trim()} style={style}>
            {children}
        </div>
    );
}

export default ActionButton;
