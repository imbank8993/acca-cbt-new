'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeScreenFrame, SCREENSHOT_COOLDOWN_MS, SCREENSHOT_MAX_COUNT, screenshotBase64 } from '@/lib/exam-screenshots';
import { apiSend } from '@/lib/api/client';

export function useExamScreenshots(examId: string, completed: boolean) {
    const stream = useRef<MediaStream | null>(null);
    const video = useRef<HTMLVideoElement | null>(null);
    const sharingRef = useRef(false);
    const requesting = useRef(false);
    const mounted = useRef(true);
    const requestGeneration = useRef(0);
    const lastCapture = useRef(0);
    const count = useRef(0);
    const [sharing, setSharing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const stop = useCallback(() => {
        requestGeneration.current++;
        sharingRef.current = false;
        for (const track of stream.current?.getTracks() || []) { track.onended = null; track.stop(); }
        stream.current = null;
        if (video.current) { video.current.pause(); video.current.srcObject = null; }
        video.current = null;
    }, []);
    useEffect(() => {
        mounted.current = true;
        count.current = 0; lastCapture.current = 0;
        return () => { mounted.current = false; stop(); };
    }, [examId, stop]);
    useEffect(() => { if (completed) stop(); }, [completed, stop]);

    const requestShare = useCallback(async () => {
        if (requesting.current) return;
        setError('');
        if (!navigator.mediaDevices?.getDisplayMedia) {
            setError('Browser/perangkat ini belum mendukung berbagi seluruh layar. Gunakan browser desktop yang mendukung atau hubungi pengawas.');
            return;
        }
        requesting.current = true; setBusy(true);
        const generation = ++requestGeneration.current;
        try {
            const next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            if (!mounted.current || requestGeneration.current !== generation) { next.getTracks().forEach(track => track.stop()); return; }
            const track = next.getVideoTracks()[0];
            if (track?.getSettings().displaySurface !== 'monitor') {
                next.getTracks().forEach(track => track.stop());
                throw new Error('Pilih Seluruh Layar / Entire Screen, bukan tab atau jendela.');
            }
            const preview = document.createElement('video');
            preview.muted = true; preview.playsInline = true; preview.srcObject = next;
            try { await preview.play(); } catch (error) { next.getTracks().forEach(track => track.stop()); throw error; }
            if (!mounted.current || requestGeneration.current !== generation || track.readyState !== 'live') { next.getTracks().forEach(t => t.stop()); return; }
            stop();
            stream.current = next; video.current = preview;
            sharingRef.current = true; setSharing(true);
            track.onended = () => {
                stop();
                if (mounted.current) { setSharing(false); setError('Berbagi layar terhenti. Bagikan kembali seluruh layar untuk melanjutkan.'); }
            };
        } catch (error) {
            if (mounted.current) setError(error instanceof Error && error.message.includes('Pilih Seluruh') ? error.message : 'Izin berbagi layar belum diberikan. Klik Bagikan Layar dan pilih Seluruh Layar.');
        } finally { requesting.current = false; if (mounted.current) setBusy(false); }
    }, [stop]);

    const capture = useCallback(async (): Promise<Blob | null> => {
        if (!sharingRef.current || !video.current || count.current >= SCREENSHOT_MAX_COUNT || Date.now() - lastCapture.current < SCREENSHOT_COOLDOWN_MS) return null;
        lastCapture.current = Date.now();
        try { return await encodeScreenFrame(video.current); }
        catch { if (mounted.current) setError('Screenshot kejadian ini belum berhasil diambil. Catatan kejadian tetap disimpan.'); return null; }
    }, []);
    const upload = useCallback(async (attemptId: string, eventId: string, deviceId: string, blob: Blob | null) => {
        if (!blob) return;
        try {
            const result = await apiSend<{ saved: boolean; reason?: string }>(`/api/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`,
                { clientEventId: eventId, deviceId, imageBase64: await screenshotBase64(blob) }, 'POST', { timeoutMs: 20_000 });
            if (result.success && result.saved) count.current++;
            else if (result.success && result.reason === 'limit') count.current = SCREENSHOT_MAX_COUNT;
            else if (!result.success && mounted.current) setError('Screenshot kejadian ini belum berhasil dikirim. Catatan kejadian tetap disimpan.');
        } catch { if (mounted.current) setError('Screenshot belum berhasil dikirim. Catatan kejadian tetap disimpan.'); }
    }, []);
    return { sharing, sharingRef, busy, requesting, error, requestShare, capture, upload, stop };
}
