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

    const releaseStream = useCallback(() => {
        sharingRef.current = false;
        for (const track of stream.current?.getTracks() || []) {
            track.onended = null; track.onmute = null; track.onunmute = null;
            track.stop();
        }
        stream.current = null;
        if (video.current) { video.current.pause(); video.current.srcObject = null; }
        video.current = null;
    }, []);
    const stop = useCallback(() => {
        requestGeneration.current++;
        requesting.current = false;
        releaseStream();
        if (mounted.current) {
            setSharing(false); setBusy(false); setError('');
        }
    }, [releaseStream]);
    useEffect(() => {
        mounted.current = true;
        stop();
        // Browser-only capability detection must follow hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSupported(Boolean(navigator.mediaDevices?.getDisplayMedia));
        count.current = 0; lastCapture.current = 0;
        return () => { mounted.current = false; stop(); };
    }, [examId, stop]);
    useEffect(() => { if (completed) stop(); }, [completed, stop]);

    const requestShare = useCallback(async () => {
        if (completed || !mounted.current || requesting.current || sharingRef.current) return;
        setError('');
        if (!navigator.mediaDevices?.getDisplayMedia) {
            setSupported(false);
            setError('Browser/perangkat ini tidak menyediakan berbagi layar. Untuk ujian ini, gunakan laptop atau komputer dengan browser desktop, atau hubungi pengawas sebelum ujian dimulai. Waktu ujian belum berjalan.');
            return;
        }
        requesting.current = true; setBusy(true);
        const generation = ++requestGeneration.current;
        const isCurrentRequest = () => mounted.current && requestGeneration.current === generation;
        let next: MediaStream | null = null;
        let preview: HTMLVideoElement | null = null;
        let adopted = false;
        try {
            const displayOptions = {
                video: { displaySurface: 'monitor' },
                audio: false,
                monitorTypeSurfaces: 'include',
            } as DisplayMediaStreamOptions & { monitorTypeSurfaces: 'include' };
            next = await navigator.mediaDevices.getDisplayMedia(displayOptions);
            if (!isCurrentRequest()) return;
            const track = next.getVideoTracks()[0];
            if (!track || track.readyState !== 'live') {
                throw new Error('Berbagi layar tidak menghasilkan gambar. Coba lagi dan pilih layar yang ingin dibagikan.');
            }
            const displaySurface = track.getSettings().displaySurface;
            if (!displaySurface) {
                throw new Error('Browser tidak dapat memverifikasi bahwa Seluruh Layar dibagikan. Gunakan browser terbaru atau hubungi pengawas untuk pengecualian, lalu muat ulang halaman.');
            }
            if (displaySurface !== 'monitor') {
                throw new Error('Pilih Seluruh Layar / Entire Screen, bukan tab atau jendela.');
            }
            preview = document.createElement('video');
            preview.muted = true; preview.playsInline = true; preview.srcObject = next;
            // Own the pending stream too, so finishing/unmounting can stop it
            // immediately even while the browser is still preparing playback.
            releaseStream();
            stream.current = next; video.current = preview;
            await preview.play();
            if (!isCurrentRequest()) return;
            if (track.readyState !== 'live') throw new Error('Berbagi layar tidak menghasilkan gambar. Coba lagi dan pilih layar yang ingin dibagikan.');
            adopted = true;
            sharingRef.current = !track.muted; setSharing(!track.muted);
            track.onended = () => {
                if (stream.current !== next) return;
                stop();
                if (mounted.current) setError('Berbagi layar terhenti. Bagikan kembali seluruh layar untuk melanjutkan.');
            };
            track.onmute = () => {
                if (stream.current !== next || !mounted.current) return;
                sharingRef.current = false; setSharing(false);
                setError('Gambar layar sementara tidak tersedia. Pulihkan berbagi layar untuk melanjutkan.');
            };
            track.onunmute = () => {
                if (stream.current !== next || !mounted.current || track.readyState !== 'live') return;
                sharingRef.current = true; setSharing(true); setError('');
            };
        } catch (error) {
            if (isCurrentRequest()) {
                const message = error instanceof Error ? error.message : '';
                setError(message.includes('Pilih Seluruh') || message.includes('tidak menghasilkan') || message.includes('Browser tidak dapat memverifikasi')
                    ? message
                    : 'Izin berbagi layar belum berhasil. Coba lagi dan pilih Seluruh Layar. Jika Safari di Mac tetap gagal, muat ulang halaman dan izinkan perekaman layar untuk Safari di System Settings → Privacy & Security → Screen & System Audio Recording.');
            }
        } finally {
            if (next && !adopted) {
                if (stream.current === next) releaseStream();
                else {
                    next.getTracks().forEach(track => track.stop());
                    if (preview) { preview.pause(); preview.srcObject = null; }
                }
            }
            if (isCurrentRequest()) { requesting.current = false; setBusy(false); }
        }
    }, [completed, releaseStream, stop]);

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
    return { sharing, sharingRef, busy, requesting, error, supported, requestShare, capture, upload, stop };
}
