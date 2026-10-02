'use client';

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import './DatePicker.css';

export interface DatePickerProps {
    value: string; // 'yyyy-mm-dd' or ''
    onChange: (value: string) => void;
    isRange?: boolean;
    valueEnd?: string;
    onChangeRange?: (start: string, end: string) => void;
    placeholder?: string;
    className?: string;
    style?: CSSProperties;
    disabled?: boolean;
    required?: boolean;
    min?: string; // 'yyyy-mm-dd'
    max?: string; // 'yyyy-mm-dd'
    id?: string;
    name?: string;
    title?: string;
    placement?: 'top' | 'bottom';
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function parseISO(v?: string): Date | null {
    if (!v) return null;
    const clean = String(v).slice(0, 10);
    const parts = clean.split('-').map(Number);
    const [y, m, d] = parts;
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return isNaN(date.getTime()) ? null : date;
}

function toISO(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function fmtDisplay(v?: string): string {
    const d = parseISO(v);
    if (!d) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function calcDays(startISO?: string, endISO?: string): number {
    if (!startISO) return 0;
    const s = parseISO(startISO);
    const e = parseISO(endISO || startISO);
    if (!s || !e) return 0;
    const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 3600 * 24));
    return diff >= 0 ? diff + 1 : 0;
}

export function DatePicker({
    value,
    onChange,
    isRange = false,
    valueEnd = '',
    onChangeRange,
    placeholder = 'dd/mm/yyyy',
    className = '',
    style,
    disabled,
    required,
    min,
    max,
    id,
    name,
    title,
    placement: placementProp
}: DatePickerProps) {
    const [open, setOpen] = useState(false);
    const [viewDate, setViewDate] = useState<Date>(() => parseISO(value) || new Date());
    const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Range selection state draft
    const [rangeStart, setRangeStart] = useState<string>('');
    const [rangeEnd, setRangeEnd] = useState<string>('');
    const [hoverIso, setHoverIso] = useState<string>('');
    const [isPickingEnd, setIsPickingEnd] = useState<boolean>(false);

    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const updateCoords = useCallback(() => {
        if (!rootRef.current) return;
        const rect = rootRef.current.getBoundingClientRect();
        const panelWidth = 288;
        const panelHeight = 350;
        const spaceBelow = window.innerHeight - rect.bottom;
        const placeTop = placementProp === 'top' || (placementProp !== 'bottom' && spaceBelow < panelHeight && rect.top > panelHeight);

        let top = placeTop ? Math.max(10, rect.top - panelHeight - 6) : rect.bottom + 6;
        if (!placeTop && top + panelHeight > window.innerHeight) {
            top = Math.max(10, window.innerHeight - panelHeight - 10);
        }

        let left = rect.left;
        if (left + panelWidth > window.innerWidth - 12) {
            left = Math.max(12, window.innerWidth - panelWidth - 12);
        }
        if (left < 12) left = 12;

        setCoords({ top, left });
    }, [placementProp]);

    useEffect(() => {
        if (open) {
            const syncId = window.setTimeout(() => {
            setViewDate(parseISO(value) || new Date());
            setMode('days');
            setRangeStart(value || '');
            setRangeEnd(valueEnd || value || '');
            setIsPickingEnd(false);
            setHoverIso('');
            updateCoords();
            }, 0);

            const handleScrollOrResize = () => updateCoords();
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);
            return () => {
                window.clearTimeout(syncId);
                window.removeEventListener('scroll', handleScrollOrResize, true);
                window.removeEventListener('resize', handleScrollOrResize);
            };
        }
    }, [open, value, valueEnd, updateCoords]);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const target = e.target as Node;
            if (
                rootRef.current && !rootRef.current.contains(target) &&
                panelRef.current && !panelRef.current.contains(target)
            ) {
                setOpen(false);
            }
        }
        function onEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        if (open) {
            document.addEventListener('mousedown', onDocClick);
            document.addEventListener('keydown', onEsc);
        }
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open]);

    const minD = useMemo(() => parseISO(min), [min]);
    const maxD = useMemo(() => parseISO(max), [max]);
    const selected = useMemo(() => parseISO(value), [value]);
    const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);

    function isDisabledDate(d: Date) {
        if (minD && d < minD) return true;
        if (maxD && d > maxD) return true;
        return false;
    }

    const days = useMemo(() => {
        const y = viewDate.getFullYear(), m = viewDate.getMonth();
        const startOffset = new Date(y, m, 1).getDay();
        const start = new Date(y, m, 1 - startOffset);
        return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }, [viewDate]);

    const years = useMemo(() => {
        const base = Math.floor(viewDate.getFullYear() / 12) * 12;
        return Array.from({ length: 12 }, (_, i) => base - 1 + i);
    }, [viewDate]);

    function commitRange(start: string, end: string) {
        let finalStart = start;
        let finalEnd = end;
        if (finalStart && finalEnd && finalStart > finalEnd) {
            [finalStart, finalEnd] = [finalEnd, finalStart];
        }
        if (onChangeRange) {
            onChangeRange(finalStart, finalEnd);
        } else if (onChange) {
            onChange(finalStart);
        }
        setOpen(false);
    }

    function selectDay(d: Date) {
        if (isDisabledDate(d)) return;
        const iso = toISO(d);

        if (!isRange) {
            onChange(iso);
            setOpen(false);
            return;
        }

        if (!isPickingEnd) {
            setRangeStart(iso);
            setRangeEnd(iso);
            setIsPickingEnd(true);
        } else {
            if (iso < rangeStart) {
                setRangeStart(iso);
                setRangeEnd(iso);
                setIsPickingEnd(true);
            } else {
                setRangeEnd(iso);
                setIsPickingEnd(false);
                commitRange(rangeStart, iso);
            }
        }
    }

    function handleToday() {
        if (isDisabledDate(today)) return;
        const iso = toISO(today);
        if (isRange) {
            commitRange(iso, iso);
        } else {
            onChange(iso);
            setOpen(false);
        }
    }

    function handleClear() {
        if (isRange) {
            commitRange('', '');
        } else {
            onChange('');
            setOpen(false);
        }
    }

    function handleConfirmSingleDay() {
        if (rangeStart) {
            commitRange(rangeStart, rangeStart);
        }
    }

    const activeEffectiveEnd = isPickingEnd && hoverIso && hoverIso >= rangeStart ? hoverIso : rangeEnd;

    let triggerText = placeholder;
    if (value) {
        if (isRange && valueEnd && valueEnd !== value) {
            const count = calcDays(value, valueEnd);
            triggerText = `${fmtDisplay(value)} — ${fmtDisplay(valueEnd)} (${count} Hari)`;
        } else {
            triggerText = isRange ? `${fmtDisplay(value)} (1 Hari)` : fmtDisplay(value);
        }
    }

    return (
        <div className={`dpk-root ${className}`} ref={rootRef}>
            <button
                type="button"
                id={id}
                className={`dpk-trigger${disabled ? ' dpk-disabled' : ''}${open ? ' dpk-open' : ''}`}
                onClick={() => {
                    if (disabled) return;
                    if (!open) {
                        updateCoords();
                        setOpen(true);
                    } else {
                        setOpen(false);
                    }
                }}
                disabled={disabled}
                style={style}
                title={title}
            >
                <svg className="dpk-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M3 9.5H21" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M8 3V6.5M16 3V6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                <span className={value ? 'dpk-value' : 'dpk-placeholder'}>{triggerText}</span>
            </button>
            {name && <input type="hidden" name={name} value={value} required={required} />}

            {open && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="dpk-panel"
                    style={{
                        position: 'fixed',
                        top: `${coords.top}px`,
                        left: `${coords.left}px`,
                        zIndex: 999999,
                    }}
                    role="dialog"
                >
                    {isRange && (
                        <div className="dpk-range-header">
                            <span className="dpk-range-hint">
                                {isPickingEnd ? (
                                    <><i className="bi bi-cursor-fill" style={{ color: '#3083FF', marginRight: '4px' }} /> Pilih tanggal selesai...</>
                                ) : (
                                    <><i className="bi bi-calendar-range-fill" style={{ color: '#3083FF', marginRight: '4px' }} /> Pilih tanggal / rentang</>
                                )}
                            </span>
                            {isPickingEnd && (
                                <button type="button" className="dpk-badge-btn" onClick={handleConfirmSingleDay}>
                                    1 Hari Saja
                                </button>
                            )}
                        </div>
                    )}
                    {mode === 'days' && (
                        <>
                            <div className="dpk-header">
                                <button type="button" className="dpk-nav" onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} aria-label="Bulan sebelumnya">‹</button>
                                <button type="button" className="dpk-title" onClick={() => setMode('months')}>
                                    {BULAN[viewDate.getMonth()]} {viewDate.getFullYear()}
                                </button>
                                <button type="button" className="dpk-nav" onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} aria-label="Bulan berikutnya">›</button>
                            </div>
                            <div className="dpk-weekdays">
                                {HARI_PENDEK.map(h => <span key={h}>{h}</span>)}
                            </div>
                            <div className="dpk-days">
                                {days.map((d, i) => {
                                    const iso = toISO(d);
                                    const inMonth = d.getMonth() === viewDate.getMonth();
                                    const isToday = iso === toISO(today);
                                    const dis = isDisabledDate(d);

                                    let dayClasses = 'dpk-day';
                                    if (!inMonth) dayClasses += ' dpk-day-muted';
                                    if (isToday) dayClasses += ' dpk-day-today';

                                    if (!isRange) {
                                        if (selected && iso === toISO(selected)) dayClasses += ' dpk-day-selected';
                                    } else {
                                        const isStart = iso === rangeStart;
                                        const isEnd = iso === activeEffectiveEnd;
                                        const isInRange = rangeStart && activeEffectiveEnd && iso > rangeStart && iso < activeEffectiveEnd;

                                        if (isStart && isEnd) {
                                            dayClasses += ' dpk-day-selected';
                                        } else if (isStart) {
                                            dayClasses += ' dpk-day-range-start';
                                        } else if (isEnd) {
                                            dayClasses += ' dpk-day-range-end';
                                        } else if (isInRange) {
                                            dayClasses += ' dpk-day-in-range';
                                        }
                                    }

                                    return (
                                        <button
                                            type="button"
                                            key={i}
                                            className={dayClasses}
                                            disabled={dis}
                                            onClick={() => selectDay(d)}
                                            onMouseEnter={() => {
                                                if (isRange && isPickingEnd) setHoverIso(iso);
                                            }}
                                        >
                                            {d.getDate()}
                                        </button>
                                    );
                                })}
                            </div>

                            {isRange && rangeStart && (
                                <div className="dpk-range-summary">
                                    <div className="dpk-range-text">
                                        {rangeStart && activeEffectiveEnd && rangeStart !== activeEffectiveEnd ? (
                                            <><b>{fmtDisplay(rangeStart)}</b> s/d <b>{fmtDisplay(activeEffectiveEnd)}</b> ({calcDays(rangeStart, activeEffectiveEnd)} Hari)</>
                                        ) : (
                                            <><b>{fmtDisplay(rangeStart)}</b> (1 Hari)</>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="dpk-footer">
                                <button type="button" className="dpk-link" onClick={handleToday}>Hari ini</button>
                                {value && <button type="button" className="dpk-link dpk-link-muted" onClick={handleClear}>Bersihkan</button>}
                            </div>
                        </>
                    )}
                    {mode === 'months' && (
                        <>
                            <div className="dpk-header">
                                <button type="button" className="dpk-nav" onClick={() => setViewDate(d => new Date(d.getFullYear() - 1, d.getMonth(), 1))} aria-label="Tahun sebelumnya">‹</button>
                                <button type="button" className="dpk-title" onClick={() => setMode('years')}>{viewDate.getFullYear()}</button>
                                <button type="button" className="dpk-nav" onClick={() => setViewDate(d => new Date(d.getFullYear() + 1, d.getMonth(), 1))} aria-label="Tahun berikutnya">›</button>
                            </div>
                            <div className="dpk-grid-3">
                                {BULAN.map((b, i) => (
                                    <button
                                        type="button"
                                        key={b}
                                        className={`dpk-cell${i === viewDate.getMonth() ? ' dpk-cell-selected' : ''}`}
                                        onClick={() => { setViewDate(d => new Date(d.getFullYear(), i, 1)); setMode('days'); }}
                                    >
                                        {b.slice(0, 3)}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {mode === 'years' && (
                        <>
                            <div className="dpk-header">
                                <button type="button" className="dpk-nav" onClick={() => setViewDate(d => new Date(d.getFullYear() - 12, d.getMonth(), 1))} aria-label="12 tahun sebelumnya">‹</button>
                                <span className="dpk-title dpk-title-static">{years[0]} – {years[years.length - 1]}</span>
                                <button type="button" className="dpk-nav" onClick={() => setViewDate(d => new Date(d.getFullYear() + 12, d.getMonth(), 1))} aria-label="12 tahun berikutnya">›</button>
                            </div>
                            <div className="dpk-grid-3">
                                {years.map(y => (
                                    <button
                                        type="button"
                                        key={y}
                                        className={`dpk-cell${y === viewDate.getFullYear() ? ' dpk-cell-selected' : ''}`}
                                        onClick={() => { setViewDate(d => new Date(y, d.getMonth(), 1)); setMode('months'); }}
                                    >
                                        {y}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}

export default DatePicker;
