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
const PRESETS = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '11:00', '13:00', '14:00'];

export function TimeField({
    value,
    onChange,
    label = 'Waktu',
    placeholder = '--:--',
    disabled = false,
    className = '',
    timeZone = DEFAULT_SCHOOL_TIME_ZONE,
}: TimeFieldProps) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Current hour and minute parsed from value
    const [selectedHour, setSelectedHour] = useState<string>('08');
    const [selectedMinute, setSelectedMinute] = useState<string>('00');

    // Parse value on open or when value changes
    useEffect(() => {
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
        const panelWidth = 290;
        const panelHeight = 340;
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
            return () => {
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

    const handleSelectHour = (h: string) => {
        setSelectedHour(h);
        const nextTime = `${h}:${selectedMinute || '00'}`;
        onChange(nextTime);
    };

    const handleSelectMinute = (m: string) => {
        setSelectedMinute(m);
        const nextTime = `${selectedHour || '08'}:${m}`;
        onChange(nextTime);
    };

    const handleSelectPreset = (timeStr: string) => {
        const [h, m] = timeStr.split(':');
        setSelectedHour(h || '08');
        setSelectedMinute(m || '00');
        onChange(timeStr);
        setOpen(false);
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
        onChange(`${h}:${m}`);
        setOpen(false);
    };

    const handleClear = () => {
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
        onChange(`${formatted}:${selectedMinute || '00'}`);
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
        onChange(`${selectedHour || '08'}:${formatted}`);
    };

    const displayTime = value ? value.slice(0, 5) : '';

    return (
        <div className={`tfd-root ${className}`.trim()} ref={rootRef}>
            <button
                type="button"
                className={`tfd-trigger${disabled ? ' tfd-disabled' : ''}${open ? ' tfd-open' : ''}`}
                onClick={toggleOpen}
                disabled={disabled}
                aria-label={`Pilih ${label}`}
                title={`Pilih ${label}`}
            >
                <span className="tfd-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M12 7.5V12L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
                {displayTime ? (
                    <span className="tfd-value">{displayTime}</span>
                ) : (
                    <span className="tfd-placeholder">{placeholder}</span>
                )}
                <span className="tfd-chevron">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                </span>
            </button>

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
                >
                    <div className="tfd-header">
                        <span className="tfd-title">Pilih Jam & Menit</span>
                        <span className="tfd-badge">{getSchoolTimeZoneLabel(timeZone)}</span>
                    </div>

                    {/* Manual Direct Input */}
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

                    {/* Quick presets */}
                    <div className="tfd-presets">
                        {PRESETS.map((p) => (
                            <button
                                type="button"
                                key={p}
                                className={`tfd-preset-chip${displayTime === p ? ' active' : ''}`}
                                onClick={() => handleSelectPreset(p)}
                            >
                                {p}
                            </button>
                        ))}
                    </div>

                    {/* Columns: Jam & Menit */}
                    <div className="tfd-columns">
                        <div className="tfd-col">
                            <span className="tfd-col-title">Jam</span>
                            <div className="tfd-col-list">
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
                            <div className="tfd-col-list">
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
                            {displayTime && (
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
