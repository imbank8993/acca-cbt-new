import Swal, { SweetAlertIcon } from 'sweetalert2';
import './confirm-dialog.css';

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'primary' | 'success';
  icon?: SweetAlertIcon;
}

export interface AlertOptions {
  title: string;
  text?: string;
  confirmText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'primary' | 'success';
  icon?: SweetAlertIcon;
}

const variantStyles = {
  danger: {
    confirmBtn: '#ef4444',
    icon: 'warning' as SweetAlertIcon,
  },
  warning: {
    confirmBtn: '#f59e0b',
    icon: 'warning' as SweetAlertIcon,
  },
  info: {
    confirmBtn: '#3083FF',
    icon: 'info' as SweetAlertIcon,
  },
  primary: {
    confirmBtn: '#3083FF',
    icon: 'question' as SweetAlertIcon,
  },
  success: {
    confirmBtn: '#10b981',
    icon: 'success' as SweetAlertIcon,
  },
};

export async function confirmDialog({
  title,
  text,
  confirmText = 'Ya, Lanjutkan',
  cancelText = 'Batal',
  variant = 'primary',
  icon,
}: ConfirmOptions): Promise<boolean> {
  const style = variantStyles[variant] || variantStyles.primary;

  const result = await Swal.fire({
    title,
    text,
    icon: icon || style.icon,
    showCancelButton: true,
    confirmButtonColor: '#3083FF',
    cancelButtonColor: '#ffffff',
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    reverseButtons: true,
    focusCancel: variant === 'danger',
    width: 440,
    padding: 0,
    buttonsStyling: false,
    iconColor: '#3083FF',
    customClass: {
      container: 'acca-confirm-overlay',
      popup: 'acca-confirm',
      icon: 'acca-confirm-icon',
      title: 'acca-confirm-title',
      htmlContainer: 'acca-confirm-body',
      confirmButton: 'acca-confirm-yes',
      cancelButton: 'acca-confirm-no',
      actions: 'acca-confirm-actions',
    },
  });

  return result.isConfirmed;
}

export async function deleteConfirmDialog(
  titleOrOptions: string | Omit<ConfirmOptions, 'variant'>,
  text?: string
): Promise<boolean> {
  if (typeof titleOrOptions === 'string') {
    return confirmDialog({
      title: titleOrOptions,
      text,
      confirmText: 'Ya, Hapus',
      cancelText: 'Batal',
      variant: 'danger',
      icon: 'warning',
    });
  }

  return confirmDialog({
    confirmText: 'Ya, Hapus',
    cancelText: 'Batal',
    variant: 'danger',
    icon: 'warning',
    ...titleOrOptions,
  });
}

export async function alertDialog({
  title,
  text,
  confirmText = 'OK',
  variant = 'info',
  icon,
}: AlertOptions): Promise<void> {
  const style = variantStyles[variant] || variantStyles.info;

  await Swal.fire({
    title,
    text,
    icon: icon || style.icon,
    confirmButtonColor: style.confirmBtn,
    confirmButtonText: confirmText,
    customClass: {
      popup: 'rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 dark:bg-slate-900 p-6',
      title: 'text-lg font-bold text-slate-900 dark:text-white',
      htmlContainer: 'text-sm text-slate-600 dark:text-slate-300 my-2',
      confirmButton: 'px-6 py-2.5 rounded-xl text-sm font-semibold shadow-md focus:outline-none transition-all',
    },
  });
}
