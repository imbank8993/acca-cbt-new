'use client';

import { type CSSProperties,type ReactNode } from 'react';
import './inline-select.css';

export type InlineSelectOption = { value: string; label: string; disabled?: boolean };

function DropDownIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
    return (
        <svg
            stroke="currentColor"
            fill="currentColor"
            strokeWidth="0"
            viewBox="0 0 24 24"
            height={size}
            width={size}
            className={className}
            aria-hidden="true"
        >
            <path d="M12 16L6 10H18L12 16Z" />
        </svg>
    );
}

/**
 * Select ringkas sebaris dengan <ActionButton>: tingginya sama (34px) dan
 * panahnya berputar saat fokus.
 * Pakai `options`, atau `children` kalau daftar opsinya perlu dirakit sendiri.
 */
export function InlineSelect({
    value,
    onChange,
    options,
    children,
    title,
    disabled,
    minWidth = '120px',
    height,
    className = '',
    style,
}: {
    value: string;
    onChange: (value: string) => void;
    options?: InlineSelectOption[];
    children?: ReactNode;
    title?: string;
    disabled?: boolean;
    minWidth?: string;
    /** Override tinggi kalau disandingkan dengan kontrol non-ActionButton. */
    height?: string;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <div
            className={`uisel ${className}`.trim()}
            style={{ minWidth, ...(height ? { ['--uisel-h' as string]: height } : null), ...style }}
        >
            <select
                className="uisel-input"
                value={value}
                onChange={e => onChange(e.target.value)}
                title={title}
                disabled={disabled}
            >
                {options?.map(opt => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                        {opt.label}
                    </option>
                ))}
                {children}
            </select>
            <DropDownIcon size={20} className="uisel-icon" />
        </div>
    );
}

export default InlineSelect;
