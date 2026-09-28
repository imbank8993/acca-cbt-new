'use client';

import { registerExamServiceWorker } from '@/lib/exam-pwa';
import { useEffect } from 'react';

/** Registrasi global; caching tetap dibatasi service worker ke route ujian. */
export function ExamPwaRegistration() {
    useEffect(() => {
        void registerExamServiceWorker();
    }, []);
    return null;
}
