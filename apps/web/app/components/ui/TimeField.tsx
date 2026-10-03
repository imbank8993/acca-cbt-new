'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_SCHOOL_TIME_ZONE, getSchoolTimeZoneLabel, utcToSchoolLocalDateTime } from '@/lib/school-time';
import './time-field.css';

export interface TimeFieldProps {
    value: string; // 'HH:mm' or ''
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    timeZone?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES_STEP5 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function normalizeTimeString(val: string): string | null {
    if (!val) return null;
    const clean = val.trim().replace('.', ':');
    const match = clean.match(/^([01]?\d|2[0-3]):([0-5]?\d)$/);
    if (match) {
        const h = match[1].padStart(2, '0');
        const m = match[2].padStart(2, '0');
        return `${h}:${m}`;
    }
    // Check 3 or 4 digits without colon (e.g. 830 -> 08:30, 0830 -> 08:30)
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length === 3) {
        const h = digitsOnly.slice(0, 1).padStart(2, '0');
        const m = digitsOnly.slice(1, 3);
        if (Number(h) < 24 && Number(m) < 60) return `${h}:${m}`;
    } else if (digitsOnly.length === 4) {
        const h = digitsOnly.slice(0, 2);
        const m = digitsOnly.slice(2, 4);
        if (Number(h) < 24 && Number(m) < 60) return `${h}:${m}`;
    }
    return null;
}

export function TimeField({
    value,
    onChange,
    label = 'Waktu',
    placeholder = 'HH:mm',
    disabled = false,
    className = '',
    timeZone = DEFAULT_SCHOOL_TIME_ZONE,
}: TimeFieldProps) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const hourListRef = useRef<HTMLDivElement>(null);
    const minuteListRef = useRef<HTMLDivElement>(null);

    // Controlled display for main input
    const [inputValue, setInputValue] = useState(value || '');

    // Current hour and minute for dropdown
    const [selectedHour, setSelectedHour] = useState<string>('08');
    const [selectedMinute, setSelectedMinute] = useState<string>('00');

    // Sync state when external value changes
    useEffect(() => {
        setInputValue(value || '');
        if (value && value.includes(':')) {
            const [h, m] = value.split(':');
            setSelectedHour(h ? h.padStart(2, '0').slice(0, 2) : '08');
            setSelectedMinute(m ? m.padStart(2, '0').slice(0, 2) : '00');
        } else {
            setSelectedHour('08');
            setSelectedMinute('00');
        }
    }, [value]);

    const updateCoords = useCallback(() => {
        if (!rootRef.current) return;
        const rect = rootRef.current.getBoundingClientRect();
        const panelWidth = 250;
        const panelHeight = 280;
        const spaceBelow = window.innerHeight - rect.bottom;
        const placeTop = spaceBelow < panelHeight && rect.top > panelHeight;

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
    }, []);

    const toggleOpen = () => {
        if (disabled) return;
        if (!open) {
            updateCoords();
            setOpen(true);
        } else {
            setOpen(false);
        }
    };

    useEffect(() => {
        if (open) {
            updateCoords();
            const handleScrollOrResize = () => updateCoords();
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);

            // Auto-scroll selected hour & minute into view
            const scrollTimer = window.setTimeout(() => {
                const hourEl = hourListRef.current?.querySelector('.tfd-cell.selected') as HTMLElement | null;
                if (hourEl && hourListRef.current) {
                    hourListRef.current.scrollTop = hourEl.offsetTop - hourListRef.current.offsetTop - 40;
                }
                const minEl = minuteListRef.current?.querySelector('.tfd-cell.selected') as HTMLElement | null;
                if (minEl && minuteListRef.current) {
                    minuteListRef.current.scrollTop = minEl.offsetTop - minuteListRef.current.offsetTop - 40;
                }
            }, 20);

            return () => {
                window.clearTimeout(scrollTimer);
                window.removeEventListener('scroll', handleScrollOrResize, true);
                window.removeEventListener('resize', handleScrollOrResize);
            };
        }
    }, [open, updateCoords]);

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

    // Handle typing directly in the trigger input
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let text = e.target.value;
        // Allow user to clear
        if (text === '') {
            setInputValue('');
            onChange('');
            return;
        }

        // Keep digits, colon, dot
        text = text.replace(/[^0-9:.]/g, '').replace('.', ':');
        if (text.length > 5) text = text.slice(0, 5);

        // Auto-insert colon after 2 digits if typing forward
        if (text.length === 2 && !text.includes(':') && inputValue.length === 1) {
            text = `${text}:`;
        }

        setInputValue(text);

        // If it's a complete valid time (e.g. 08:30)
        const normalized = normalizeTimeString(text);
        if (normalized) {
            const [h, m] = normalized.split(':');
            setSelectedHour(h);
            setSelectedMinute(m);
            onChange(normalized);
        }
    };

    const handleInputBlur = () => {
        if (!inputValue) {
            onChange('');
            return;
        }
        const normalized = normalizeTimeString(inputValue);
        if (normalized) {
            setInputValue(normalized);
            const [h, m] = normalized.split(':');
            setSelectedHour(h);
            setSelectedMinute(m);
            onChange(normalized);
        } else {
            // Revert back to previous valid prop value
            setInputValue(value || '');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleInputBlur();
            setOpen(false);
        } else if (e.key === 'ArrowDown' && !open) {
            toggleOpen();
        }
    };

    const handleSelectHour = (h: string) => {
        setSelectedHour(h);
        const m = selectedMinute || '00';
        const formatted = `${h}:${m}`;
        setInputValue(formatted);
        onChange(formatted);
    };

    const handleSelectMinute = (m: string) => {
        setSelectedMinute(m);
        const h = selectedHour || '08';
        const formatted = `${h}:${m}`;
        setInputValue(formatted);
        onChange(formatted);
    };

    const handleNow = () => {
        try {
            const nowIso = new Date().toISOString();
            const local = utcToSchoolLocalDateTime(nowIso, timeZone);
            if (local && local.includes('T')) {
                const time = local.split('T')[1].slice(0, 5);
                const [h, m] = time.split(':');
                setSelectedHour(h || '08');
                setSelectedMinute(m || '00');
                setInputValue(time);
                onChange(time);
                setOpen(false);
                return;
            }
        } catch {
            // fallback
        }
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        setSelectedHour(h);
        setSelectedMinute(m);
        setInputValue(`${h}:${m}`);
        onChange(`${h}:${m}`);
        setOpen(false);
    };

    const handleClear = () => {
        setInputValue('');
        onChange('');
        setOpen(false);
    };

    const handleManualHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
        if (raw === '') {
            setSelectedHour('');
            return;
        }
        const num = Math.min(23, Math.max(0, parseInt(raw, 10)));
        const formatted = String(num).padStart(2, '0');
        setSelectedHour(formatted);
        const time = `${formatted}:${selectedMinute || '00'}`;
        setInputValue(time);
        onChange(time);
    };

    const handleManualMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
        if (raw === '') {
            setSelectedMinute('');
            return;
        }
        const num = Math.min(59, Math.max(0, parseInt(raw, 10)));
        const formatted = String(num).padStart(2, '0');
        setSelectedMinute(formatted);
        const time = `${selectedHour || '08'}:${formatted}`;
        setInputValue(time);
        onChange(time);
    };

    return (
        <div className={`tfd-root ${className}`.trim()} ref={rootRef}>
            <div className={`tfd-trigger${disabled ? ' tfd-disabled' : ''}${open ? ' tfd-open' : ''}`}>
                <button
                    type="button"
                    className="tfd-icon-btn"
                    onClick={toggleOpen}
                    disabled={disabled}
                    tabIndex={-1}
                    title={`Pilih ${label}`}
                    aria-label={`Buka dialog ${label}`}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M12 7.5V12L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>

                {/* Direct typeable time input */}
                <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    className="tfd-input"
                    value={inputValue}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={handleInputChange}
                    onBlur={handleInputBlur}
                    onKeyDown={handleKeyDown}
                    maxLength={5}
                    aria-label={label}
                />

                <button
                    type="button"
                    className="tfd-chevron-btn"
                    onClick={toggleOpen}
                    disabled={disabled}
                    tabIndex={-1}
                    aria-label="Toggle time picker"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                </button>
            </div>

            {open && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="tfd-panel"
                    style={{
                        position: 'fixed',
                        top: `${coords.top}px`,
                        left: `${coords.left}px`,
                        zIndex: 999999,
                    }}
                    role="dialog"
                    aria-label="Pilih Jam dan Menit"
                >
                    <div className="tfd-header">
                        <span className="tfd-title">Pilih Jam & Menit</span>
                        <span className="tfd-badge">{getSchoolTimeZoneLabel(timeZone)}</span>
                    </div>

                    {/* Manual Direct Input inside modal */}
                    <div className="tfd-manual-inputs">
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            value={selectedHour}
                            onChange={handleManualHourChange}
                            placeholder="08"
                            className="tfd-manual-field"
                            aria-label="Jam"
                        />
                        <span className="tfd-colon">:</span>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            value={selectedMinute}
                            onChange={handleManualMinuteChange}
                            placeholder="00"
                            className="tfd-manual-field"
                            aria-label="Menit"
                        />
                    </div>

                    {/* Columns: Jam & Menit */}
                    <div className="tfd-columns">
                        <div className="tfd-col">
                            <span className="tfd-col-title">Jam</span>
                            <div className="tfd-col-list" ref={hourListRef}>
                                {HOURS.map((h) => (
                                    <button
                                        type="button"
                                        key={h}
                                        className={`tfd-cell${selectedHour === h ? ' selected' : ''}`}
                                        onClick={() => handleSelectHour(h)}
                                    >
                                        {h}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="tfd-col">
                            <span className="tfd-col-title">Menit</span>
                            <div className="tfd-col-list" ref={minuteListRef}>
                                {MINUTES_STEP5.map((m) => (
                                    <button
                                        type="button"
                                        key={m}
                                        className={`tfd-cell${selectedMinute === m ? ' selected' : ''}`}
                                        onClick={() => handleSelectMinute(m)}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="tfd-footer">
                        <div className="flex items-center gap-1.5">
                            <button type="button" className="tfd-link" onClick={handleNow}>
                                Sekarang
                            </button>
                            {inputValue && (
                                <button type="button" className="tfd-link text-slate-400 hover:text-slate-600" onClick={handleClear}>
                                    Bersihkan
                                </button>
                            )}
                        </div>
                        <button type="button" className="tfd-btn-apply" onClick={() => setOpen(false)}>
                            Selesai
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

export default TimeField;
