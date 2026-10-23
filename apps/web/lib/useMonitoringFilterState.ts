'use client';

import { useEffect, useState } from 'react';

/** Keep monitoring choices when returning from details or reloading this tab. */
export function useMonitoringFilterState<T>(key: string, initial: T, override?: T) {
    const [value, setValue] = useState(initial);
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => {
        try {
            const saved = sessionStorage.getItem(`monitoring:${window.location.pathname}:${key}`);
            if (override !== undefined) setValue(override);
            else if (saved !== null) {
                const parsed = JSON.parse(saved);
                const valid = Array.isArray(initial)
                    ? Array.isArray(parsed) && parsed.every(item => typeof item === 'string')
                    : typeof parsed === typeof initial;
                if (valid) setValue(parsed);
            }
        } catch { /* Storage may be unavailable; filters still work in memory. */ }
        setHydrated(true);
        }, 0);
        return () => window.clearTimeout(timer);
        // Initial values are intentionally read only when this page mounts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    useEffect(() => {
        if (!hydrated) return;
        try { sessionStorage.setItem(`monitoring:${window.location.pathname}:${key}`, JSON.stringify(value)); }
        catch { /* Ignore unavailable storage. */ }
    }, [hydrated, key, value]);
    return [value, setValue] as const;
}
