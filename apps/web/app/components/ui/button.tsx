import React from 'react';
import { Spinner } from './Spinner';
import { 
    Eye, 
    FileText, 
    Printer, 
    Send, 
    Plus, 
    Pencil, 
    Trash2, 
    Check, 
    X, 
    Search, 
    Download, 
    Filter, 
    RefreshCw, 
    Clock, 
    Mail, 
    GalleryVerticalEnd,
    FileSpreadsheet
} from 'lucide-react';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost' | 'cancel' | 'reset' | 'more' | 'activate' | 'edit' | 'add' | 'ajukan';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonIconPreset = 'import' | 'export' | 'add' | 'edit' | 'delete' | 'save' | 'cancel' | 'search' | 'toggle' | 'download' | 'whatsapp' | 'print' | 'pdf' | 'preview' | 'pratinjau' | 'cetak' | 'ajukan' | 'send' | 'paperplane' | 'surat' | 'riwayat' | 'history' | 'clock' | 'filter' | 'refresh';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    isLoading?: boolean;
    pill?: boolean;
    icon?: ButtonIconPreset | (string & {});
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

/**
 * Presets Ikon Terpusat untuk Komponen Button.
 * Menggunakan ikon Lucide terstandar agar presisi, tidak bertumpuk, dan seimbang dengan label.
 */
export const ICON_PRESETS: Record<ButtonIconPreset, React.ReactNode> = {
    import: <FileSpreadsheet size={16} strokeWidth={2} style={{ color: '#f97316' }} />,
    export: <Download size={16} strokeWidth={2} style={{ color: '#3b82f6' }} />,
    add: <Plus size={18} strokeWidth={2.2} style={{ color: '#3083FF' }} />,
    edit: <Pencil size={16} strokeWidth={2} style={{ color: '#3083FF' }} />,
    delete: <Trash2 size={16} strokeWidth={2} style={{ color: '#dc2626' }} />,
    save: <Check size={18} strokeWidth={2.5} style={{ color: '#16a34a' }} />,
    cancel: <X size={18} strokeWidth={2.5} style={{ color: '#ef4444' }} />,
    search: <Search size={16} strokeWidth={2} style={{ color: '#64748b' }} />,
    toggle: <i className="bi bi-toggle-on" />,
    download: <Download size={16} strokeWidth={2} style={{ color: 'inherit' }} />,
    whatsapp: <i className="bi bi-whatsapp" style={{ color: '#25D366' }} />,
    print: <Printer size={16} strokeWidth={2} />,
    pdf: <FileText size={16} strokeWidth={2} />,
    preview: <Eye size={16} strokeWidth={2} />,
    pratinjau: <Eye size={16} strokeWidth={2} />,
    cetak: <Printer size={16} strokeWidth={2} />,
    ajukan: <Send size={15} strokeWidth={2.2} style={{ color: 'inherit' }} />,
    send: <Send size={15} strokeWidth={2.2} style={{ color: 'inherit' }} />,
    paperplane: <Send size={15} strokeWidth={2.2} style={{ color: 'inherit' }} />,
    surat: <Mail size={16} strokeWidth={2} style={{ color: '#6366f1' }} />,
    riwayat: <GalleryVerticalEnd size={16} strokeWidth={2} style={{ color: '#8b5cf6' }} />,
    history: <Clock size={16} strokeWidth={2} style={{ color: '#8b5cf6' }} />,
    clock: <Clock size={16} strokeWidth={2} style={{ color: '#64748b' }} />,
    filter: <Filter size={16} strokeWidth={2} style={{ color: '#3b82f6' }} />,
    refresh: <RefreshCw size={16} strokeWidth={2} style={{ color: '#3083FF' }} />,
};

/**
 * Komponen Button Universal Aplikasi.
 * Gunakan komponen ini untuk semua tombol aksi halaman/toolbar/modal.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ 
        className = '', 
        variant, 
        size = 'md', 
        isLoading = false, 
        pill = false,
        icon,
        leftIcon, 
        rightIcon, 
        children, 
        disabled, 
        ...props 
    }, ref) => {
        // HATI-HATI: `icon` ikut menentukan VARIANT bila `variant` tidak diisi.
        // Ini mudah mengejutkan — `<Button icon="cetak">` diam-diam jadi `ghost`
        // (nyaris tak terlihat di atas latar toolbar yang juga terang), bukan
        // tombol biasa seperti yang diduga penulisnya. Sebutkan `variant`
        // secara eksplisit kalau penampilannya penting.
        const effectiveVariant = variant || (
            (icon === 'add') ? 'add' :
            (icon === 'edit') ? 'edit' :
            (icon === 'preview' || icon === 'pratinjau' || icon === 'cetak' || icon === 'pdf') ? 'ghost' :
            (icon === 'ajukan' || icon === 'send' || icon === 'paperplane') ? 'ajukan' :
            'primary'
        );
        const pillClass = (pill || effectiveVariant === 'ajukan') ? 'ui-btn--pill' : '';
        const btnClass = `ui-btn ui-btn--${effectiveVariant} ui-btn--${size} ${pillClass} ${className}`.trim();
        const effectiveLeftIcon = leftIcon || (icon ? (ICON_PRESETS[icon as ButtonIconPreset] || (typeof icon === 'string' ? <i className={`bi bi-${icon}`} /> : icon)) : undefined);

        const content = variant === 'more' && !children && !effectiveLeftIcon 
            ? <i className="bi bi-three-dots" style={{ fontSize: '1.15rem' }} /> 
            : children;

        return (
            <button
                ref={ref}
                disabled={isLoading || disabled}
                className={btnClass}
                {...props}
            >
                {isLoading ? (
                    <Spinner variant="buble" size={20} color="currentColor" />
                ) : (
                    <>
                        {effectiveLeftIcon}
                        {content && <span className="ui-btn__label">{content}</span>}
                        {rightIcon}
                    </>
                )}
            </button>
        );
    }
);

Button.displayName = 'Button';

export interface SubmitButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    isLoading?: boolean;
    /** true = tampilkan centang keberhasilan menggantikan label */
    isSuccess?: boolean;
    children: React.ReactNode;
}

/**
 * SubmitButton — tombol submit yang isinya crossfade antara label, spinner ring (isLoading),
 * dan centang (isSuccess), tanpa mengubah bentuk/ukuran tombol itu sendiri. Warna/tampilan
 * idle sepenuhnya mengikuti className/style pemanggil (mis. className="lp-btn" di halaman
 * login, atau kelas ui-btn biasa).
 */
export const SubmitButton = React.forwardRef<HTMLButtonElement, SubmitButtonProps>(
    ({ className = '', isLoading = false, isSuccess = false, children, disabled, ...props }, ref) => {
        return (
            <button
                ref={ref}
                type="submit"
                disabled={isLoading || disabled}
                className={`ui-submit-fade ${isLoading ? 'is-loading' : ''} ${isSuccess ? 'is-success' : ''} ${className}`.trim()}
                {...props}
            >
                <span className="ui-submit-fade__label">{children}</span>
                <span className="ui-submit-fade__ring" aria-hidden="true" />
                <svg className="ui-submit-fade__check" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z" />
                </svg>
            </button>
        );
    }
);

SubmitButton.displayName = 'SubmitButton';

export default Button;
