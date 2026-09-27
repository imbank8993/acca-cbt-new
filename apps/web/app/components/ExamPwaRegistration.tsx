'use client';

import { useEffect } from 'react';
import { registerExamServiceWorker } from '@/lib/exam-pwa';

/** Registrasi global; caching tetap dibatasi service worker ke route ujian. */
export function ExamPwaRegistration() {
    useEffect(() => {
        void registerExamServiceWorker();
    }, []);
    return null;
}
