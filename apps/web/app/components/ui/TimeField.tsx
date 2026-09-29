'use client';

import { useRef } from 'react';
import './time-field.css';

export function TimeField({
    value,
    onChange,
    label = 'Waktu',
    disabled = false,
    className = '',
}: {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
}) {
    const ref = useRef<HTMLInputElement>(null);

    const openPicker = () => {
        const el = ref.current;
        if (!el || disabled) return;
        el.focus();
        try { el.showPicker?.(); } catch { /* dipanggil tanpa gestur pengguna */ }
    };

    return (
        <div className={`tfd ${className}`.trim()}>
            <button
                type="button"
                className="tfd__icon"
                onClick={openPicker}
                disabled={disabled}
                aria-label={`Pilih ${label}`}
                title={`Pilih ${label}`}
                tabIndex={-1}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M12 7.5V12L15 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            <input
                ref={ref}
                type="time"
                className="tfd__input"
                aria-label={label}
                value={value}
                disabled={disabled}
                onChange={e => onChange(e.target.value)}
            />
        </div>
    );
}

export default TimeField;
