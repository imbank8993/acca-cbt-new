'use client';

import { useId, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { MultiSelect } from '@/components/ui/MultiSelect';

interface MonitoringParticipantFiltersProps {
    search: string;
    onSearchChange: (value: string) => void;
    classOptions: string[];
    selectedClasses: string[];
    onClassesChange: (value: string[]) => void;
    status?: string;
    onStatusChange?: (value: string) => void;
    includeActiveStatus?: boolean;
    resetOnly?: boolean;
    attentionOnly?: boolean;
    onAttentionChange?: (value: boolean) => void;
    actions?: ReactNode;
}

export function MonitoringParticipantFilters({
    search, onSearchChange, classOptions, selectedClasses, onClassesChange,
    status = 'all', onStatusChange, includeActiveStatus = true, resetOnly = false, attentionOnly = false, onAttentionChange, actions,
}: MonitoringParticipantFiltersProps) {
    const searchId = useId();
    return (
        <div className="monitoring-participant-filters" role="group" aria-label="Filter peserta">
            <div className="monitoring-participant-filters__search">
                <label className="sr-only" htmlFor={searchId}>Cari peserta</label>
                <Search size={16} aria-hidden="true" />
                <input id={searchId} type="search" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Cari peserta…" />
            </div>
            <div className="monitoring-participant-filters__class" role="group" aria-label="Filter kelas">
                <MultiSelect
                    options={classOptions.map(kelas => ({ value: kelas, label: kelas }))}
                    value={selectedClasses} onChange={onClassesChange}
                    placeholder="Semua kelas" allSelectedText="Semua kelas" height="40px" minWidth="0" aria-label="Pilih kelas"
                />
                {selectedClasses.length > 0 && <button type="button" className="monitoring-class-clear" onClick={() => onClassesChange([])} aria-label="Hapus filter kelas" title="Hapus filter kelas"><X size={14} /></button>}
            </div>
            {onStatusChange && <InlineSelect value={status} onChange={onStatusChange} minWidth="0" height="40px"
                aria-label="Filter status peserta" className="monitoring-participant-filters__status"
                options={[
                    { value: 'all', label: 'Semua status' },
                    ...(includeActiveStatus && !resetOnly ? [{ value: 'in_progress', label: 'Mengerjakan' }] : []),
                    { value: 'submitted', label: 'Selesai' },
                    { value: 'auto_submitted', label: 'Ditutup otomatis' },
                    ...(!resetOnly ? [{ value: 'belum', label: 'Belum mulai' }] : []),
                ]}
            />}
            {onAttentionChange && <button type="button" className="monitoring-attention-filter"
                aria-pressed={attentionOnly} onClick={() => onAttentionChange(!attentionOnly)}>Perlu perhatian</button>}
            {actions && <div className="monitoring-participant-filters__actions">{actions}</div>}
        </div>
    );
}
