'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, AlertCircle, Loader2 } from 'lucide-react';

interface CustomVideoPlayerProps {
    url: string;
    width?: string;
}

// Extract YouTube video ID from various YouTube URL formats
function extractYouTubeId(url: string): string | null {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([^&?/\s]+)/,
        /youtube\.com\/shorts\/([^&?/\s]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

declare global {
    interface Window {
        YT: {
            Player: new (el: HTMLElement, opts: object) => YTPlayer;
            PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number; CUED: number };
        };
        onYouTubeIframeAPIReady?: () => void;
        _ytApiCallbacks?: Array<() => void>;
    }
}

interface YTPlayer {
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    setVolume(volume: number): void;
    mute(): void;
    unMute(): void;
    getDuration(): number;
    getCurrentTime(): number;
    getPlayerState(): number;
    destroy(): void;
}

function loadYouTubeAPI(): Promise<void> {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            resolve();
            return;
        }
        if (!window._ytApiCallbacks) {
            window._ytApiCallbacks = [];
        }
        window._ytApiCallbacks.push(resolve);
        if (!document.getElementById('youtube-iframe-api')) {
            const script = document.createElement('script');
            script.id = 'youtube-iframe-api';
            script.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(script);
            const existingCallback = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (existingCallback) existingCallback();
                const cbs = window._ytApiCallbacks || [];
                cbs.forEach((cb) => cb());
                window._ytApiCallbacks = [];
            };
        }
    });
}

export function CustomVideoPlayer({ url, width = '100%' }: CustomVideoPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerDivRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YTPlayer | null>(null);
    const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [volume, setVolume] = useState(100);
    const [played, setPlayed] = useState(0);
    const [duration, setDuration] = useState(0);
    const [ready, setReady] = useState(false);
    const [hasError, setHasError] = useState(false);

    const videoId = extractYouTubeId(url);

    const startProgress = useCallback(() => {
        if (progressRef.current) clearInterval(progressRef.current);
        progressRef.current = setInterval(() => {
            if (!playerRef.current) return;
            const current = playerRef.current.getCurrentTime();
            const total = playerRef.current.getDuration();
            if (total > 0) {
                setPlayed(current / total);
                setDuration(total);
            }
        }, 500);
    }, []);

    const stopProgress = useCallback(() => {
        if (progressRef.current) {
            clearInterval(progressRef.current);
            progressRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!videoId || !playerDivRef.current) return;

        let destroyed = false;
        let player: YTPlayer | null = null;

        loadYouTubeAPI().then(() => {
            if (destroyed || !playerDivRef.current) return;

            player = new window.YT.Player(playerDivRef.current, {
                videoId,
                playerVars: {
                    controls: 0,          // hide native controls
                    disablekb: 1,         // disable keyboard
                    rel: 0,               // no related videos
                    modestbranding: 1,    // minimal branding
                    fs: 0,                // hide native fullscreen
                    iv_load_policy: 3,    // no annotations
                    cc_load_policy: 0,
                    playsinline: 1,
                },
                events: {
                    onReady: () => {
                        if (destroyed) return;
                        playerRef.current = player;
                        setDuration(player!.getDuration());
                        setReady(true);
                    },
                    onStateChange: (event: { data: number }) => {
                        if (destroyed) return;
                        const state = window.YT.PlayerState;
                        if (event.data === state.PLAYING) {
                            setPlaying(true);
                            startProgress();
                        } else if (event.data === state.PAUSED || event.data === state.ENDED) {
                            setPlaying(false);
                            stopProgress();
                        }
                    },
                    onError: () => {
                        if (!destroyed) setHasError(true);
                    },
                },
            });
        });

        return () => {
            destroyed = true;
            stopProgress();
            if (player) {
                try { player.destroy(); } catch (e) {}
            }
            playerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoId]);

    const handlePlayPause = () => {
        if (!playerRef.current || !ready) return;
        const state = window.YT?.PlayerState;
        if (!state) return;
        const currentState = playerRef.current.getPlayerState();
        if (currentState === state.PLAYING) {
            playerRef.current.pauseVideo();
        } else {
            playerRef.current.playVideo();
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const ratio = parseFloat(e.target.value);
        setPlayed(ratio);
        if (playerRef.current && duration > 0) {
            playerRef.current.seekTo(ratio * duration, true);
        }
    };

    const toggleMute = () => {
        if (!playerRef.current) return;
        if (muted) {
            playerRef.current.unMute();
            playerRef.current.setVolume(volume);
            setMuted(false);
        } else {
            playerRef.current.mute();
            setMuted(true);
        }
    };

    const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setVolume(val);
        if (playerRef.current) {
            playerRef.current.setVolume(val);
            if (val === 0) setMuted(true);
            else setMuted(false);
        }
    };

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    };

    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    if (!videoId) {
        return (
            <div className="w-full rounded-xl bg-slate-900 flex items-center justify-center p-8 my-4 text-slate-400 text-sm">
                <AlertCircle size={18} className="mr-2 text-red-400" />
                URL YouTube tidak valid
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative group bg-black rounded-xl overflow-hidden shadow-lg my-4"
            style={{ aspectRatio: '16/9', maxWidth: width, width: '100%', margin: '1rem auto' }}
        >
            {/* YouTube iframe container — pointer-events: none so user can't click it */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ zIndex: 1 }}
            >
                <div ref={playerDivRef} style={{ width: '100%', height: '100%' }} />
            </div>

            {/* Loading overlay */}
            {!ready && !hasError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                    <Loader2 size={36} className="text-blue-400 animate-spin" />
                </div>
            )}

            {/* Error overlay */}
            {hasError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-10 gap-2">
                    <AlertCircle size={36} className="text-red-500" />
                    <span className="text-white text-sm font-medium">Video tidak dapat dimuat</span>
                </div>
            )}

            {/* Click shield + center play button */}
            {ready && !hasError && (
                <div
                    className="absolute inset-x-0 top-0 flex items-center justify-center cursor-pointer"
                    style={{ bottom: '52px', zIndex: 20 }}
                    onClick={handlePlayPause}
                >
                    {!playing && (
                        <div className="w-16 h-16 bg-blue-600/90 rounded-full flex items-center justify-center text-white shadow-xl backdrop-blur-sm hover:scale-110 transition-transform">
                            <Play size={32} fill="currentColor" className="ml-1" />
                        </div>
                    )}
                </div>
            )}

            {/* Controls bar */}
            {ready && !hasError && (
                <div
                    className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-4 pt-6 pb-3 flex flex-col gap-2 transition-opacity duration-300 z-30 ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
                >
                    {/* Seek bar */}
                    <div className="relative w-full h-1.5 bg-white/30 rounded-full">
                        <div
                            className="absolute left-0 top-0 h-full bg-blue-500 rounded-full pointer-events-none"
                            style={{ width: `${played * 100}%` }}
                        />
                        <input
                            type="range" min={0} max={0.9999} step="any"
                            value={played}
                            onChange={handleSeek}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button onClick={handlePlayPause} className="text-white hover:text-blue-400 transition-colors">
                                {playing
                                    ? <Pause size={20} fill="currentColor" />
                                    : <Play size={20} fill="currentColor" />}
                            </button>
                            <button onClick={toggleMute} className="text-white hover:text-blue-400 transition-colors">
                                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                            </button>
                            <input
                                type="range" min={0} max={100} step={1}
                                value={muted ? 0 : volume}
                                onChange={handleVolume}
                                className="w-16 accent-blue-500"
                            />
                            <span className="text-white text-xs font-mono">
                                {formatTime(played * duration)} / {formatTime(duration)}
                            </span>
                        </div>
                        <button onClick={toggleFullscreen} className="text-white hover:text-blue-400 transition-colors">
                            <Maximize size={18} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
