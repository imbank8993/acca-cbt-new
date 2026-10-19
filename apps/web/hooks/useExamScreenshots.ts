'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeScreenFrame, SCREENSHOT_COOLDOWN_MS, SCREENSHOT_MAX_COUNT, screenshotBase64, sendScreenshotWithRetry } from '@/lib/exam-screenshots';
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
    const [supported, setSupported] = useState(true);
    const [surfaceUnverified, setSurfaceUnverified] = useState(false);

    const stop = useCallback(() => {
        requestGeneration.current++;
        sharingRef.current = false;
        if (mounted.current) setSurfaceUnverified(false);
        for (const track of stream.current?.getTracks() || []) { track.onended = null; track.stop(); }
        stream.current = null;
        if (video.current) { video.current.pause(); video.current.srcObject = null; }
        video.current = null;
    }, []);
    useEffect(() => {
        mounted.current = true;
        setSupported(Boolean(navigator.mediaDevices?.getDisplayMedia));
        count.current = 0; lastCapture.current = 0;
        return () => { mounted.current = false; stop(); };
    }, [examId, stop]);
    useEffect(() => { if (completed) stop(); }, [completed, stop]);

    const requestShare = useCallback(async () => {
        if (requesting.current) return;
        setError('');
        if (!navigator.mediaDevices?.getDisplayMedia) {
            setSupported(false);
            setError('Browser/perangkat ini tidak menyediakan berbagi layar. Untuk ujian ini, gunakan laptop atau komputer dengan browser desktop, atau hubungi pengawas sebelum ujian dimulai. Waktu ujian belum berjalan.');
            return;
        }
        requesting.current = true; setBusy(true);
        const generation = ++requestGeneration.current;
        try {
            const displayOptions = {
                video: { displaySurface: 'monitor' },
                audio: false,
                monitorTypeSurfaces: 'include',
            } as DisplayMediaStreamOptions & { monitorTypeSurfaces: 'include' };
            const next = await navigator.mediaDevices.getDisplayMedia(displayOptions);
            if (!mounted.current || requestGeneration.current !== generation) { next.getTracks().forEach(track => track.stop()); return; }
            const track = next.getVideoTracks()[0];
            if (!track || track.readyState !== 'live') {
                next.getTracks().forEach(track => track.stop());
                throw new Error('Berbagi layar tidak menghasilkan gambar. Coba lagi dan pilih layar yang ingin dibagikan.');
            }
            const displaySurface = track.getSettings().displaySurface;
            if (displaySurface && displaySurface !== 'monitor') {
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
            setSurfaceUnverified(!displaySurface);
            track.onended = () => {
                stop();
                if (mounted.current) { setSharing(false); setError('Berbagi layar terhenti. Bagikan kembali seluruh layar untuk melanjutkan.'); }
            };
        } catch (error) {
            if (mounted.current) {
                const message = error instanceof Error ? error.message : '';
                setError(message.includes('Pilih Seluruh') || message.includes('tidak menghasilkan')
                    ? message
                    : 'Izin berbagi layar belum berhasil. Coba lagi dan pilih Seluruh Layar. Jika Safari di Mac tetap gagal, muat ulang halaman dan izinkan perekaman layar untuk Safari di System Settings → Privacy & Security → Screen & System Audio Recording.');
            }
        } finally { requesting.current = false; if (mounted.current) setBusy(false); }
    }, [stop]);

    const capture = useCallback(async (): Promise<Blob | null> => {
        if (!sharingRef.current || !video.current || count.current >= SCREENSHOT_MAX_COUNT || Date.now() - lastCapture.current < SCREENSHOT_COOLDOWN_MS) return null;
        lastCapture.current = Date.now();
        try { return await encodeScreenFrame(video.current); }
        catch { if (mounted.current) setError('Screenshot kejadian ini belum berhasil diambil. Catatan kejadian tetap disimpan.'); return null; }
    }, []);
    const upload = useCallback(async (attemptId: string, eventId: string, deviceId: string, blobOrBase64: Blob | string | null): Promise<boolean> => {
        if (!blobOrBase64) return true;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
        try {
            const imageBase64 = typeof blobOrBase64 === 'string' ? blobOrBase64 : await screenshotBase64(blobOrBase64);
            const payload = { clientEventId: eventId, deviceId, imageBase64 };
            const result = await sendScreenshotWithRetry(() => apiSend<{ saved: boolean; reason?: string }>(`/api/proctoring/attempts/${encodeURIComponent(attemptId)}/screenshots`,
                payload, 'POST', { timeoutMs: 20_000 }));
            if (result.success) {
                if (result.saved) count.current++;
                else if (result.reason === 'limit') count.current = SCREENSHOT_MAX_COUNT;
                if (mounted.current) setError('');
                return true;
            }
            if (result.retryable === false) {
                if (mounted.current) setError('Screenshot kejadian ini belum berhasil dikirim. Catatan kejadian tetap disimpan.');
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }, []);
    return { sharing, sharingRef, busy, requesting, error, supported, surfaceUnverified, requestShare, capture, upload, stop };
}
