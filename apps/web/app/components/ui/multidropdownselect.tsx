'use client';

import { useClientMounted } from '@/hooks/useClientMounted';
import React,{ useCallback,useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import './multi-select-dropdown.css';

export type MultiSelectOption<T extends string | number = string> = {
    value: T;
    label: string;
    disabled?: boolean;
};

export interface MultiSelectDropdownProps<T extends string | number = string> {
    options: MultiSelectOption<T>[];
    value: T[];
    onChange: (value: T[]) => void;
    label?: string;
    placeholder?: string;
    allSelectedText?: string;
    columns?: number;
    className?: string;
    disabled?: boolean;
    height?: string;
    minWidth?: string;
    showQuickActions?: boolean;
}

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

export function MultiSelectDropdown<T extends string | number = string>({
    options,
    value,
    onChange,
    label,
    placeholder = 'Pilih...',
    allSelectedText = 'Semua Terpilih',
    columns = 1,
    className = '',
    disabled = false,
    height = '40px',
    minWidth = '100%',
    showQuickActions = true,
}: MultiSelectDropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const mounted = useClientMounted();
    const [coords, setCoords] = useState<{
        top: number;
        left: number;
        width: number;
        maxHeight: number;
        isUpward: boolean;
    }>({ top: 0, left: 0, width: 0, maxHeight: 260, isUpward: false });

    const wrapperRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const updateCoords = useCallback(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const isUpward = spaceBelow < 220 && spaceAbove > spaceBelow;

        const top = isUpward ? rect.top - 4 : rect.bottom + 4;
        let left = rect.left;
        const width = rect.width;

        // Horizontally stay within screen
        if (left + width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - width - 8);
        }
        if (left < 8) left = 8;

        const maxHeight = isUpward
            ? Math.min(260, Math.max(100, rect.top - 16))
            : Math.min(260, Math.max(100, window.innerHeight - rect.bottom - 16));

        setCoords({
            top,
            left,
            width,
            maxHeight,
            isUpward,
        });
    }, []);

    const toggleOpen = () => {
        if (disabled) return;
        if (!isOpen) {
            updateCoords();
        }
        setIsOpen(prev => !prev);
    };

    // Recalculate on open, scroll, or resize
    useEffect(() => {
        if (!isOpen) return;

        const handleScrollOrResize = (e: Event) => {
            // If scrolling inside the dropdown menu itself, don't update coords
            if (menuRef.current && e.target && menuRef.current.contains(e.target as Node)) {
                return;
            }
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                if (rect.bottom < 0 || rect.top > window.innerHeight) {
                    setIsOpen(false);
                    return;
                }
            }
            updateCoords();
        };

        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isOpen, updateCoords]);

    // Close menu when clicking outside component or pressing Escape
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                wrapperRef.current && !wrapperRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const isAllSelected = options.length > 0 && value.length === options.length;
    const isNoneSelected = value.length === 0;

    const summaryText = isNoneSelected
        ? placeholder
        : isAllSelected
        ? allSelectedText
        : `${value.length} Terpilih`;

    const toggleSelectAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isAllSelected) {
            onChange([]);
        } else {
            onChange(options.filter(o => !o.disabled).map(o => o.value));
        }
    };

    const toggleItem = (val: T) => {
        if (value.includes(val)) {
            onChange(value.filter(v => v !== val));
        } else {
            onChange([...value, val]);
        }
    };

    return (
        <div ref={wrapperRef} className={`uimsel-wrapper ${className}`.trim()} style={{ minWidth }}>
            {label && (
                <div className="uimsel-header-row">
                    <label className="uimsel-label">{label}</label>
                    {showQuickActions && (
                        <button
                            type="button"
                            className="uimsel-quick-btn"
                            onClick={toggleSelectAll}
                            disabled={disabled}
                        >
                            {isAllSelected ? 'Kosongkan' : 'Pilih Semua'}
                        </button>
                    )}
                </div>
            )}
            <div
                className={`uimsel ${isOpen ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
                style={{ '--uimsel-h': height } as React.CSSProperties}
            >
                <div
                    ref={triggerRef}
                    className="uimsel-trigger"
                    onClick={toggleOpen}
                    tabIndex={disabled ? -1 : 0}
                    onKeyDown={e => {
                        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                            e.preventDefault();
                            toggleOpen();
                        }
                        if (e.key === 'Escape') setIsOpen(false);
                    }}
                >
                    <span className="uimsel-text">{summaryText}</span>
                    <DropDownIcon size={16} className="uimsel-icon" />
                </div>

                {isOpen && mounted && coords.width > 0 && typeof document !== 'undefined' && createPortal(
                    <div
                        ref={menuRef}
                        className="uimsel-menu"
                        style={{
                            position: 'fixed',
                            top: `${coords.top}px`,
                            left: `${coords.left}px`,
                            width: `${coords.width}px`,
                            maxHeight: `${coords.maxHeight}px`,
                            transform: coords.isUpward ? 'translateY(-100%)' : 'none',
                            zIndex: 999999,
                            ...(columns > 1
                                ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
                                : { display: 'flex', flexDirection: 'column' }),
                        }}
                    >
                        {options.map(opt => {
                            const selected = value.includes(opt.value);
                            return (
                                <label
                                    key={String(opt.value)}
                                    className={`uimsel-item ${selected ? 'is-selected' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected}
                                        disabled={opt.disabled}
                                        onChange={() => toggleItem(opt.value)}
                                        className="uimsel-checkbox"
                                    />
                                    <span className="uimsel-item-label">{opt.label}</span>
                                </label>
                            );
                        })}
                    </div>,
                    document.body
                )}
            </div>
        </div>
    );
}

export const MultiSelect = MultiSelectDropdown;
export type MultiSelectProps<T extends string | number = string> = MultiSelectDropdownProps<T>;
export type MultiSelectDropdownOption<T extends string | number = string> = MultiSelectOption<T>;

export default MultiSelectDropdown;
