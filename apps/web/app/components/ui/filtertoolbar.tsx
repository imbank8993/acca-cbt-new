'use client';

/**
 * FilterToolbar — satu model baris filter yang dipakai bersama semua tab/halaman.
 *
 * Semua field punya bentuk yang sama: label kapital kecil di atas, kotak
 * bertepi dengan ikon di kiri, tinggi 38px. Gaya-nya ada di
 * `filter-toolbar.css` (file CSS biasa, bukan <style jsx>,
 * supaya tetap berlaku saat dipakai sebagai subkomponen).
 */

import React, { CSSProperties, ReactNode, useState } from 'react';
import { SlidersHorizontal, Check } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from './modal';
import { Button } from './button';
import './filter-toolbar.css';

export interface FilterOption {
    value: string;
    label: string;
}

/** Prop lebar yang dipakai semua field; di bawah 640px selalu ditimpa jadi 1 kolom. */
export interface FilterWidthProps {
    /** Lebar dasar field, mis. "220px" atau 220. Default 130px. */
    width?: string | number;
    /** Porsi sisa ruang yang diambil field ini. Default 1, search 2, 0 = lebar tetap. */
    grow?: number;
    className?: string;
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

export function MobileOption({
    selected,
    onClick,
    children,
    icon,
    hint,
}: {
    selected: boolean;
    onClick: () => void;
    children: ReactNode;
    icon?: string;
    hint?: ReactNode;
}) {
    return (
        <button
            type="button"
            className={`mui-opt ${selected ? 'isSelected' : ''}`.trim()}
            onClick={onClick}
            role="radio"
            aria-checked={selected}
        >
            {icon && (
                <span className="mui-opt__icon" aria-hidden="true">
                    <i className={`bi bi-${icon}`} />
                </span>
            )}
            <span className="mui-opt__text">
                <span className="mui-opt__label">{children}</span>
                {hint && <span className="mui-opt__hint">{hint}</span>}
            </span>
            <span className="mui-opt__mark" aria-hidden="true">
                {selected && <Check size={18} />}
            </span>
        </button>
    );
}

function widthStyle({ width, grow }: FilterWidthProps): CSSProperties | undefined {
    if (width === undefined && grow === undefined) return undefined;
    const w = typeof width === 'number' ? `${width}px` : width;
    return {
        ...(w ? { '--ftb-basis': w, '--ftb-min': w } : {}),
        ...(grow !== undefined ? { '--ftb-grow': grow } : {}),
    } as CSSProperties;
}

function flattenChildren(children: ReactNode): ReactNode[] {
    const result: ReactNode[] = [];
    React.Children.forEach(children, (child) => {
        if (!child) return;
        if (React.isValidElement(child) && child.type === React.Fragment) {
            result.push(...flattenChildren((child.props as any).children));
        } else if (Array.isArray(child)) {
            result.push(...flattenChildren(child));
        } else {
            result.push(child);
        }
    });
    return result;
}

function isSearchElement(element: React.ReactElement): boolean {
    if (!element || !React.isValidElement(element)) return false;
    const type = element.type as any;
    if (type === FilterSearch) return true;
    if (type?.displayName === 'FilterSearch' || type?.name === 'FilterSearch') return true;
    if ((element.props as any)?.variant === 'search') return true;
    return false;
}

function isActionElement(element: React.ReactElement): boolean {
    if (!element || !React.isValidElement(element)) return false;
    const type = element.type as any;
    if (type === FilterActions) return true;
    if (type?.displayName === 'FilterActions' || type?.name === 'FilterActions') return true;
    const props = element.props as any;
    if (props?.className && typeof props.className === 'string' && props.className.includes('ftb-field--action')) return true;
    return false;
}

function isValueActive(value: any): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return false;
        const lower = trimmed.toLowerCase();
        if (
            lower === 'semua' ||
            lower === 'all' ||
            lower === '-' ||
            lower === '*' ||
            lower.startsWith('semua ') ||
            lower.startsWith('semua-') ||
            lower.startsWith('semua_') ||
            lower.startsWith('all ') ||
            lower.startsWith('pilih ') ||
            lower === 'pilih'
        ) {
            return false;
        }
        return true;
    }
    if (typeof value === 'number') {
        return !isNaN(value);
    }
    if (typeof value === 'boolean') {
        return value === true;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return true;
}

function getActiveCount(items: ReactNode[]): number {
    let count = 0;
    items.forEach((item) => {
        if (React.isValidElement(item)) {
            const props = (item as any).props || {};
            const { value, selectedMonths, checked } = props;
            if (Array.isArray(selectedMonths)) {
                if (selectedMonths.length > 0) count++;
            } else if (checked !== undefined) {
                if (checked === true) count++;
            } else if (value !== undefined) {
                if (isValueActive(value)) count++;
            }
        }
    });
    return count;
}

/* ---------------------------------- Toolbar --------------------------------- */

export function FilterToolbar({
    children,
    className = '',
    style,
    actionsInline = false,
    alwaysExpanded = false,
    leading,
}: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
    /** Slot kecil di UJUNG KIRI toolbar, sebelum kolom cari/filter. */
    leading?: ReactNode;
    /** Di mobile, letakkan aksi SEBARIS dengan kolom cari, bukan di baris sendiri. */
    actionsInline?: boolean;
    /** Di mobile, tampilkan field langsung ditumpuk vertikal alih-alih disembunyikan di modal filter. */
    alwaysExpanded?: boolean;
}) {
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

    const flattened = flattenChildren(children);

    const searchItems: ReactNode[] = [];
    const actionItems: ReactNode[] = [];
    const filterItems: ReactNode[] = [];

    flattened.forEach((child) => {
        if (!React.isValidElement(child)) {
            filterItems.push(child);
            return;
        }

        if (isSearchElement(child)) {
            searchItems.push(child);
        } else if (isActionElement(child)) {
            actionItems.push(child);
        } else {
            filterItems.push(child);
        }
    });

    const activeCount = getActiveCount(filterItems);
    const hasFilters = filterItems.length > 0;
    const hasSearch = searchItems.length > 0;
    const hasActions = actionItems.length > 0;

    const soleChoiceFilter = (() => {
        if (filterItems.length !== 1) return null;
        const item = filterItems[0];
        if (!React.isValidElement(item)) return null;
        const props = (item as any).props || {};
        const usable = Array.isArray(props.options)
            && props.options.length > 0
            && typeof props.onChange === 'function'
            && props.value !== undefined
            && !props.disabled;
        return usable ? props : null;
    })();

    const handleResetFilters = () => {
        filterItems.forEach((item) => {
            if (React.isValidElement(item)) {
                const props = (item as any).props || {};
                if (typeof props.onChange === 'function') {
                    if (Array.isArray(props.selectedMonths)) {
                        props.onChange([]);
                    } else if (props.checked !== undefined) {
                        props.onChange(false);
                    } else if (props.value !== undefined) {
                        props.onChange('');
                    }
                }
            }
        });
    };

    return (
        <>
            <div className={`ftb-toolbar ${className}`.trim()} style={style}>
                {/* Desktop View: tampilkan semua field seperti biasa */}
                <div className="ftb-desktop-wrap">
                    {leading}
                    {children}
                </div>

                {/* Mobile View: field wajib ditumpuk langsung, tanpa tombol "Filter" */}
                {alwaysExpanded ? (
                    <div className="ftb-mobile-wrap">
                        {hasFilters && (
                            <div className="ftb-modal-filter-list ftb-mobile-expanded-list">
                                {filterItems}
                            </div>
                        )}
                        {hasActions && (
                            <div className="ftb-mobile-actions ftb-mobile-actions--expanded">
                                {actionItems}
                            </div>
                        )}
                    </div>
                ) : (
                /* Mobile View: Search dengan Embedded Filter & Aksi */
                <div className="ftb-mobile-wrap">
                    {(hasSearch || hasFilters || (actionsInline && hasActions) || leading) && (
                        <div className="ftb-mobile-topbar">
                            {leading}
                            {hasSearch ? (
                                <div className="ftb-mobile-search-wrap">
                                    {searchItems.map((item, idx) => {
                                        if (React.isValidElement(item)) {
                                            return React.cloneElement(item as React.ReactElement<any>, {
                                                key: idx,
                                                placeholder: 'Cari',
                                                trailing: (hasFilters && idx === searchItems.length - 1) ? (
                                                    <button
                                                        type="button"
                                                        className={`ftb-embedded-filter-btn ${activeCount > 0 ? 'ftb-embedded-filter-btn--active' : ''}`}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setIsFilterModalOpen(true);
                                                        }}
                                                        aria-label="Filter"
                                                        title="Opsi Filter"
                                                    >
                                                        <SlidersHorizontal size={17} strokeWidth={2.2} />
                                                        {activeCount > 0 && (
                                                            <span className="ftb-embedded-filter-badge">{activeCount}</span>
                                                        )}
                                                    </button>
                                                ) : undefined,
                                            });
                                        }
                                        return item;
                                    })}
                                </div>
                            ) : (
                                hasFilters && (
                                    <button
                                        type="button"
                                        className={`ftb-mobile-filter-btn ftb-mobile-filter-btn--expanded ${activeCount > 0 ? 'ftb-mobile-filter-btn--active' : ''}`}
                                        onClick={() => setIsFilterModalOpen(true)}
                                        aria-label="Filter"
                                        title="Opsi Filter"
                                    >
                                        <SlidersHorizontal size={18} strokeWidth={2.2} />
                                        <span>Filter</span>
                                        {activeCount > 0 && (
                                            <span className="ftb-mobile-filter-badge">{activeCount}</span>
                                        )}
                                    </button>
                                )
                            )}

                            {actionsInline && hasActions && (
                                <div className="ftb-mobile-inlineActions">
                                    {actionItems}
                                </div>
                            )}
                        </div>
                    )}

                    {!actionsInline && hasActions && (
                        <div className="ftb-mobile-actions">
                            {actionItems}
                        </div>
                    )}
                </div>
                )}
            </div>

            {/* Modal Filter Khusus Mobile */}
            {!alwaysExpanded && hasFilters && isFilterModalOpen && (
                <Modal
                    open={isFilterModalOpen}
                    onClose={() => setIsFilterModalOpen(false)}
                    size="sm"
                    title={soleChoiceFilter ? (soleChoiceFilter.label || 'Opsi Filter') : 'Opsi Filter'}
                    icon={<SlidersHorizontal size={20} />}
                    className="ftb-modal-panel"
                >
                    <ModalBody className="ftb-modal-body">
                        {soleChoiceFilter ? (
                            <div role="radiogroup" aria-label={soleChoiceFilter.label || 'Filter'}>
                                {soleChoiceFilter.options.map((opt: { value: string; label: string }) => (
                                    <MobileOption
                                        key={opt.value}
                                        selected={String(soleChoiceFilter.value) === String(opt.value)}
                                        onClick={() => {
                                            soleChoiceFilter.onChange(opt.value);
                                            setIsFilterModalOpen(false);
                                        }}
                                    >
                                        {opt.label}
                                    </MobileOption>
                                ))}
                            </div>
                        ) : (
                            <div className="ftb-modal-filter-list">
                                {filterItems}
                            </div>
                        )}
                    </ModalBody>

                    {!soleChoiceFilter && (
                        <ModalFooter align="between" className="ftb-modal-footer">
                            <Button
                                type="button"
                                variant="cancel"
                                onClick={handleResetFilters}
                                leftIcon={<i className="bi bi-arrow-counterclockwise" />}
                                disabled={activeCount === 0}
                            >
                                Reset
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                onClick={() => setIsFilterModalOpen(false)}
                                leftIcon={<i className="bi bi-check2" />}
                            >
                                Terapkan
                            </Button>
                        </ModalFooter>
                    )}
                </Modal>
            )}
        </>
    );
}

/* ----------------------------------- Field ---------------------------------- */

export interface FilterFieldProps extends FilterWidthProps {
    label?: string;
    /** Nama ikon bootstrap tanpa prefix (mis. "door-open"), atau elemen ikon ReactNode (mis. Lucide) */
    icon?: string | ReactNode;
    children: ReactNode;
    /** true = tampilkan anak apa adanya tanpa kotak bertepi (mis. DatePicker) */
    bare?: boolean;
    disabled?: boolean;
    variant?: 'default' | 'search' | 'wide';
}

export function FilterField({
    label,
    icon,
    children,
    bare = false,
    disabled = false,
    variant = 'default',
    width,
    grow,
    className = '',
}: FilterFieldProps) {
    const classes = [
        'ftb-field',
        variant !== 'default' ? `ftb-field--${variant}` : '',
        disabled ? 'ftb-field--disabled' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={classes} style={widthStyle({ width, grow })}>
            {label ? (
                <label className="ftb-label">{label}</label>
            ) : (
                <span className="ftb-label ftb-label--spacer" aria-hidden="true">&nbsp;</span>
            )}
            {bare ? children : (
                <div className="ftb-box">
                    {icon && (
                        React.isValidElement(icon)
                            ? <span className="ftb-icon-elem" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: 'var(--n-muted)' }}>{icon}</span>
                            : (typeof icon === 'string' ? <i className={`bi bi-${icon}`} /> : null)
                    )}
                    {children}
                </div>
            )}
        </div>
    );
}

/* ---------------------------------- Select ---------------------------------- */

export interface FilterSelectProps extends FilterWidthProps {
    label?: string;
    icon?: string | ReactNode;
    value: string;
    onChange: (value: string) => void;
    /** pakai `options`, atau `children` bila butuh <option> kustom */
    options?: FilterOption[];
    children?: ReactNode;
    disabled?: boolean;
    title?: string;
    variant?: 'default' | 'wide';
}

export function FilterSelect({
    label,
    icon,
    value,
    onChange,
    options,
    children,
    disabled = false,
    title,
    variant = 'default',
    width,
    grow,
    className,
}: FilterSelectProps) {
    return (
        <FilterField
            label={label}
            icon={icon}
            disabled={disabled}
            variant={variant}
            width={width}
            grow={grow}
            className={className}
        >
            <div className="ftb-select-wrapper">
                <select
                    className="ftb-input ftb-select-input"
                    value={value}
                    disabled={disabled}
                    title={title || label}
                    onChange={e => onChange(e.target.value)}
                >
                    {options && options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    {children}
                </select>
                <DropDownIcon size={20} className="ftb-select-icon" />
            </div>
        </FilterField>
    );
}

/* ----------------------------------- Input ---------------------------------- */

export interface FilterInputProps extends FilterWidthProps {
    label: string;
    icon?: string | ReactNode;
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'month' | 'date' | 'number';
    placeholder?: string;
    disabled?: boolean;
    min?: string;
    max?: string;
    variant?: 'default' | 'search' | 'wide';
    clearable?: boolean;
    trailing?: ReactNode;
    /** Mis. Enter untuk memicu pencarian sisi-server. */
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function FilterInput({
    label,
    icon,
    value,
    onChange,
    type = 'text',
    placeholder,
    disabled = false,
    min,
    max,
    variant = 'default',
    width,
    grow,
    className,
    clearable = false,
    trailing,
    onKeyDown,
}: FilterInputProps) {
    const showClear = (clearable || variant === 'search') && value && !disabled;

    return (
        <FilterField
            label={label}
            icon={icon}
            disabled={disabled}
            variant={variant}
            width={width}
            grow={grow}
            className={className}
        >
            <input
                className="ftb-input"
                type={type}
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                min={min}
                max={max}
                onChange={e => onChange(e.target.value)}
                onKeyDown={onKeyDown}
            />
            {showClear && (
                <button
                    type="button"
                    className="ftb-clear-btn"
                    onClick={() => onChange('')}
                    title="Hapus pencarian"
                    tabIndex={-1}
                >
                    <i className="bi bi-x-lg"></i>
                </button>
            )}
            {trailing}
        </FilterField>
    );
}

/* ---------------------------------- Search ---------------------------------- */

export function FilterSearch({
    value,
    onChange,
    label = '',
    placeholder = 'Cari',
    icon = 'search',
    width,
    grow,
    className,
    trailing,
    onKeyDown,
}: FilterWidthProps & {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    icon?: string | ReactNode;
    trailing?: ReactNode;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
    return (
        <FilterInput
            label={label}
            icon={icon}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            variant="search"
            clearable={true}
            width={width}
            grow={grow}
            className={className}
            trailing={trailing}
            onKeyDown={onKeyDown}
        />
    );
}

/* ---------------------------------- Toggle ---------------------------------- */

export function FilterToggle({
    label,
    text,
    checked,
    onChange,
}: {
    label: string;
    text: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="ftb-field ftb-field--action">
            <label className="ftb-label">{label}</label>
            <label className="ftb-toggle">
                <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
                <span className="ftb-toggle-track" />
                <span>{text}</span>
            </label>
        </div>
    );
}

/* ---------------------------------- Actions --------------------------------- */

export function FilterActions({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
    return (
        <div className={`ftb-field ftb-field--action ${className}`.trim()} style={style}>
            <span className="ftb-label ftb-label--spacer" aria-hidden="true">.</span>
            <div className="ftb-actions">{children}</div>
        </div>
    );
}

/* -------------------------------- Month Select ------------------------------ */

const MONTHS = [
    { id: 1, label: 'Jan', short: 'Januari' },
    { id: 2, label: 'Feb', short: 'Februari' },
    { id: 3, label: 'Mar', short: 'Maret' },
    { id: 4, label: 'Apr', short: 'April' },
    { id: 5, label: 'Mei', short: 'Mei' },
    { id: 6, label: 'Jun', short: 'Juni' },
    { id: 7, label: 'Jul', short: 'Juli' },
    { id: 8, label: 'Agt', short: 'Agustus' },
    { id: 9, label: 'Sep', short: 'September' },
    { id: 10, label: 'Okt', short: 'Oktober' },
    { id: 11, label: 'Nov', short: 'November' },
    { id: 12, label: 'Des', short: 'Desember' },
];

export function FilterMonthSelect({
    label = 'Bulan',
    selectedMonths = [],
    value,
    onChange,
    width,
    grow,
    className,
}: FilterWidthProps & {
    selectedMonths?: number[];
    value?: string;
    onChange: (value: any) => void;
    label?: string;
}) {
    let currentMonthVal = '';
    if (value !== undefined) {
        if (value && value.includes('-')) {
            const parts = value.split('-');
            currentMonthVal = String(parseInt(parts[1], 10) || '');
        } else {
            currentMonthVal = value || '';
        }
    } else if (Array.isArray(selectedMonths) && selectedMonths.length > 0) {
        currentMonthVal = selectedMonths[0].toString();
    }

    const handleChange = (val: string) => {
        if (value !== undefined) {
            if (value && value.includes('-') && val) {
                const year = value.split('-')[0] || new Date().getFullYear().toString();
                const paddedMonth = String(parseInt(val, 10)).padStart(2, '0');
                onChange(`${year}-${paddedMonth}`);
            } else {
                onChange(val);
            }
        } else if (typeof onChange === 'function') {
            onChange(val ? [parseInt(val, 10)] : []);
        }
    };

    return (
        <FilterSelect
            label={label}
            value={currentMonthVal}
            onChange={handleChange}
            width={width}
            grow={grow}
            className={className}
        >
            <option value="">Semua Bulan</option>
            {MONTHS.map(month => (
                <option key={month.id} value={month.id.toString()}>
                    {month.short}
                </option>
            ))}
        </FilterSelect>
    );
}

export default FilterToolbar;
