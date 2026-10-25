'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
    FilterToolbar,
    FilterSearch,
    FilterSelect,
    FilterToggle,
    FilterActions,
} from '@/app/components/ui/filtertoolbar';

interface MonitoringParticipantFiltersProps {
    search: string;
    onSearchChange: (value: string) => void;
    classOptions: string[];
    selectedClasses: string[];
    onClassesChange: (value: string[]) => void;
    /** Ruang ujian folder ASAS/AM; filter ruang hanya tampil bila ada pilihan. */
    roomOptions?: Array<{ value: string; label: string; count?: number }>;
    selectedRoom?: string;
    onRoomChange?: (value: string) => void;
    status?: string;
    onStatusChange?: (value: string) => void;
    includeActiveStatus?: boolean;
    resetOnly?: boolean;
    attentionOnly?: boolean;
    onAttentionChange?: (value: boolean) => void;
    actions?: ReactNode;
}

export function MonitoringParticipantFilters({
    search,
    onSearchChange,
    classOptions,
    selectedClasses,
    onClassesChange,
    roomOptions = [],
    selectedRoom = '',
    onRoomChange,
    status = 'all',
    onStatusChange,
    includeActiveStatus = true,
    resetOnly = false,
    attentionOnly = false,
    onAttentionChange,
    actions,
}: MonitoringParticipantFiltersProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const handlePointerDown = (e: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                if ((e.target as HTMLElement)?.closest?.('.mdl-overlay, .mdl-panel')) {
                    return;
                }
                setMenuOpen(false);
            }
        };
        window.addEventListener('pointerdown', handlePointerDown);
        return () => window.removeEventListener('pointerdown', handlePointerDown);
    }, [menuOpen]);

    const selectedClass = selectedClasses[0] || '';

    return (
        <div className="monitoring-participant-filters mb-4">
            <FilterToolbar actionsInline className="monitoring-results-toolbar">
                <FilterSearch
                    value={search}
                    onChange={onSearchChange}
                    placeholder="Cari peserta…"
                    label="Cari peserta"
                />

                <FilterSelect
                    label="Kelas"
                    value={selectedClass}
                    onChange={value => onClassesChange(value ? [value] : [])}
                    options={[
                        { value: '', label: 'Semua kelas' },
                        ...classOptions.map(c => ({ value: c, label: c })),
                    ]}
                />

                {onRoomChange && roomOptions.length > 0 && (
                    <FilterSelect
                        label="Ruang"
                        value={selectedRoom}
                        onChange={onRoomChange}
                        options={[
                            { value: '', label: 'Semua ruang' },
                            ...roomOptions.map(room => ({ value: room.value, label: room.count !== undefined ? `${room.label} (${room.count})` : room.label })),
                        ]}
                    />
                )}

                {onStatusChange && (
                    <FilterSelect
                        label="Status"
                        value={status}
                        onChange={onStatusChange}
                        options={[
                            { value: 'all', label: 'Semua status' },
                            ...(includeActiveStatus && !resetOnly ? [{ value: 'in_progress', label: 'Mengerjakan' }] : []),
                            { value: 'submitted', label: 'Selesai' },
                            { value: 'auto_submitted', label: 'Ditutup otomatis' },
                            ...(!resetOnly ? [{ value: 'belum', label: 'Belum mulai' }] : []),
                        ]}
                    />
                )}

                {onAttentionChange && (
                    <FilterToggle
                        label="Perhatian"
                        text="Perlu perhatian"
                        checked={attentionOnly}
                        onChange={onAttentionChange}
                    />
                )}

                {actions && (
                    <FilterActions>
                        {/* Desktop view: normal action buttons */}
                        <div className="sk__btnDesktopOnly hidden sm:flex sm:items-center sm:gap-2">
                            {actions}
                        </div>

                        {/* Mobile view: 3-dots action menu button placed next to search */}
                        <div className="sk__menuWrap sm:hidden relative" ref={menuRef}>
                            <button
                                type="button"
                                className={`sk__btnActionMenu ${menuOpen ? 'isOpen' : ''}`}
                                onClick={() => setMenuOpen(!menuOpen)}
                                aria-label="Aksi lainnya"
                                aria-haspopup="true"
                                aria-expanded={menuOpen}
                                title="Aksi lainnya"
                            >
                                <MoreHorizontal size={18} />
                            </button>
                            {menuOpen && (
                                <>
                                    {/* Transparent backdrop to close menu on click outside */}
                                    <div
                                        className="fixed inset-0 z-40 bg-transparent"
                                        onClick={() => setMenuOpen(false)}
                                        aria-hidden="true"
                                    />
                                    <div
                                        className="sk__menu z-50"
                                        role="menu"
                                        onClick={(e) => {
                                            const target = e.target as HTMLElement;
                                            if (target.closest('button')) {
                                                setMenuOpen(false);
                                            }
                                        }}
                                    >
                                        {actions}
                                    </div>
                                </>
                            )}
                        </div>
                    </FilterActions>
                )}
            </FilterToolbar>
        </div>
    );
}
