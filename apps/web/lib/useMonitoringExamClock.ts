"use client";

import { useEffect, useState } from 'react';

/** Keep schedule badges and ordering current while the monitoring page stays open. */
export function useMonitoringExamClock(): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 10_000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}
