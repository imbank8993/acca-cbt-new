'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SCHOOL_TIME_ZONE, getSchoolTimeZone } from '@/lib/school-time';

export function useSchoolTimeZone() {
    const [timeZone, setTimeZone] = useState(DEFAULT_SCHOOL_TIME_ZONE);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        void getSchoolTimeZone()
            .then((zone) => {
                if (active) setTimeZone(zone);
            })
            .catch((loadError: unknown) => {
                if (active) {
                    setError(loadError instanceof Error ? loadError.message : 'Zona waktu sekolah gagal dimuat.');
                }
            });
        return () => { active = false; };
    }, []);

    return { timeZone, error };
}
