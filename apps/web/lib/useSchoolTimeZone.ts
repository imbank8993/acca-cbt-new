'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SCHOOL_TIME_ZONE, getSchoolTimeZone } from '@/lib/school-time';

export function useSchoolTimeZone() {
    const [timeZone, setTimeZone] = useState(DEFAULT_SCHOOL_TIME_ZONE);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        const refresh = () => { void getSchoolTimeZone()
            .then((zone) => {
                if (active) { setTimeZone(zone); setError(''); }
            })
            .catch((loadError: unknown) => {
                if (active) {
                    setError(loadError instanceof Error ? loadError.message : 'Zona waktu sekolah gagal dimuat.');
                }
            }); };
        refresh();
        const interval = window.setInterval(refresh, 60000);
        window.addEventListener('focus', refresh);
        return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh); };
    }, []);

    return { timeZone, error };
}
