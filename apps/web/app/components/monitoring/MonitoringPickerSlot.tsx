'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tempat di baris pemilih ujian (sebelah select Asesmen) untuk pemilih tambahan dari bagian
 * di bawahnya, mis. select "Ruang · Sesi" pada tampilan Per ruang. Di luar kepala monitoring,
 * pemilih tetap dirender di tempatnya.
 */
export const MonitoringPickerSlotContext = createContext<HTMLElement | null>(null);

export function useMonitoringPickerSlot(): HTMLElement | null {
    return useContext(MonitoringPickerSlotContext);
}

export function MonitoringPickerSlot({ children, fallback = true }: { children: ReactNode; fallback?: boolean }) {
    const slot = useMonitoringPickerSlot();
    if (slot) return createPortal(children, slot);
    return fallback ? <>{children}</> : null;
}
