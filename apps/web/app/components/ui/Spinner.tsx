'use client';

import React from 'react';

export type SpinnerVariant = 'dots' | 'buble' | 'trace';

/** Ukuran baku loader 'trace' di seluruh app — khusus varian ini prop `size`
 * sengaja TIDAK dipakai, supaya semua pemakaian (shell dashboard, page loader,
 * loader tab, dll) konsisten satu ukuran tanpa perlu diseragamkan manual
 * per file.
 *
 * Nilainya = ukuran kecil yang sudah paling banyak dipakai di call site
 * (size={18}), dijadikan patokan tunggal. Varian lain ('buble'/'dots') tetap
 * menghormati `size` karena bentuknya memang dipakai di konteks yang beda
 * ukurannya (16px di dalam tombol s/d 32px di loader tabel). */
const TRACE_SIZE = 18;

interface SpinnerProps {
    /** Diabaikan untuk variant 'trace' (selalu TRACE_SIZE); dipakai untuk
     * 'buble' dan 'dots'. */
    size?: number;
    /** ring thickness (kept for backward compatibility) */
    thickness?: number;
    /** css color for dots; defaults to brand primary */
    color?: string;
    /** optional label text */
    label?: string;
    className?: string;
    /** true = loader data (dipakai utk loader baris tabel/section kecil). Alias lama utk variant="buble" */
    dotsOnly?: boolean;
    /** jenis loader: 'trace' (default, garis mengikuti outline logo ACCA), 'buble' (bola memantul, dipakai utk loader data), 'dots' (3 titik) */
    variant?: SpinnerVariant;
}

/**
 * Spinner — Loader dengan beberapa varian animasi (trace, buble, dots).
 */
export function Spinner({
    size = 32,
    color,
    label,
    className = '',
    variant = 'buble',
}: SpinnerProps) {
    const resolvedVariant: SpinnerVariant = variant ?? 'buble';
    const traceSize = TRACE_SIZE;

    return (
        <div className={`acca-loader-wrap ${className}`.trim()} role="status" aria-label={label || 'Loading'}>
            {resolvedVariant === 'trace' && (
                <div className="acca-loader-logo-box">
                    <svg
                        viewBox="0 0 206.1 238.12"
                        width={traceSize}
                        height={traceSize * (238.12 / 206.1)}
                        className="acca-loader-trace"
                        aria-hidden="true"
                    >
                        <path
                            className="acca-trace-path"
                            pathLength={100}
                            d="M196.19 76.92c-27.11,-13.63 -58.96,-21.47 -93.14,-21.47 -34.19,0 -66.03,7.83 -93.14,21.47 -2.18,1.1 -4.58,0.99 -6.66,-0.29 -2.08,-1.28 -3.25,-3.38 -3.25,-5.82l0 -44.22c0,-2.78 1.56,-5.16 4.1,-6.27 29.83,-13 63.45,-20.33 98.95,-20.33 35.49,0 69.12,7.33 98.95,20.33 2.55,1.11 4.1,3.49 4.1,6.27l0 44.22c0,2.44 -1.17,4.54 -3.25,5.82 -2.08,1.28 -4.48,1.38 -6.66,0.29z"
                        />
                        <path
                            className="acca-trace-path"
                            pathLength={100}
                            d="M206.1 186.58l-0.3 -0.17 0 44.84c0,2.44 -1.17,4.54 -3.25,5.82 -2.08,1.28 -4.48,1.38 -6.66,0.28 -14.63,-7.39 -30.26,-13.08 -46.63,-16.82 -3.14,-0.72 -5.31,-3.44 -5.31,-6.66l0 -44.54c0,-3.38 -2.4,-6.2 -5.73,-6.75 -11.36,-1.86 -23.11,-2.83 -35.16,-2.83 -12.05,0 -23.8,0.97 -35.16,2.83 -3.33,0.55 -5.73,3.37 -5.73,6.75l0 44.54c0,3.23 -2.17,5.94 -5.31,6.66 -16.37,3.75 -32,9.44 -46.63,16.82 -2.18,1.1 -4.58,1 -6.66,-0.28 -2.08,-1.28 -3.25,-3.38 -3.25,-5.82l0 -44.84 -0.3 0.17 0 -55.69c0,-2.78 1.56,-5.16 4.1,-6.27 29.83,-13 63.45,-20.33 98.95,-20.33 35.49,0 69.12,7.33 98.95,20.33 2.55,1.11 4.1,3.49 4.1,6.27l0 55.69z"
                        />
                    </svg>
                </div>
            )}

            {resolvedVariant === 'buble' && (
                <span
                    className="acca-loader-buble"
                    aria-hidden="true"
                    style={{ '--acca-size': `${size}px`, '--acca-color-1': color || 'var(--n-primary, #3083FF)' } as React.CSSProperties}
                />
            )}

            {/* Baris ini HANYA dirender utk varian 'dots'. Kalau ikut dirender
                kosong utk varian lain, ia tetap jadi flex item dan `gap: 10px`
                di .acca-loader-wrap menambah 10px ruang mati di bawah loader —
                efeknya loader terlihat naik ~5px dari titik tengah, paling
                kelihatan waktu Spinner dipakai di dalam tombol. */}
            {resolvedVariant === 'dots' && (
                <div className="acca-loader-status-row">
                    <div className="acca-loader-dots" aria-hidden="true">
                        <span className="acca-dot dot-1" />
                        <span className="acca-dot dot-2" />
                        <span className="acca-dot dot-3" />
                    </div>
                </div>
            )}

            <style jsx>{`
                .acca-loader-wrap {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    padding: 8px;
                    width: 100%;
                    user-select: none;
                }

                .acca-loader-logo-box {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .acca-loader-trace {
                    overflow: visible;
                }

                .acca-trace-path {
                    fill: none;
                    stroke: ${color || 'var(--n-primary, #1d6bf3)'};
                    stroke-width: 3;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                    stroke-dasharray: 100;
                    stroke-dashoffset: 100;
                    animation: accaLogoTrace 2.8s ease-in-out infinite;
                }

                .acca-trace-path:nth-child(2) {
                    animation-delay: 0.15s;
                }

                .acca-loader-status-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }

                .acca-loader-label {
                    font-size: 0.86rem;
                    font-weight: 600;
                    color: var(--n-muted, #64748b);
                    letter-spacing: 0.2px;
                }

                .acca-loader-dots {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                }

                .acca-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background-color: ${color || 'var(--n-primary, #3083FF)'};
                    display: inline-block;
                    animation: accaDotStep 1.2s infinite ease-in-out both;
                }

                :global(.dark) .acca-dot {
                    background-color: ${color || '#38bdf8'};
                }

                .dot-1 {
                    animation-delay: 0s;
                }
                .dot-2 {
                    animation-delay: 0.25s;
                }
                .dot-3 {
                    animation-delay: 0.5s;
                }

                .acca-loader-buble {
                    --_b: calc(var(--acca-size) * 0.28);
                    --_offset: calc(var(--acca-size) * 0.62);
                    position: relative;
                    display: inline-block;
                    width: calc(var(--_offset) + var(--_b));
                    height: var(--_b);
                }

                .acca-loader-buble::before,
                .acca-loader-buble::after {
                    content: '';
                    position: absolute;
                    width: var(--_b);
                    height: var(--_b);
                    border-radius: 50%;
                    background: var(--acca-color-1);
                    box-shadow: var(--_offset) 0 var(--acca-color-1);
                    left: 0;
                    top: 0;
                    animation: accaBubleSlide 0.8s ease-in-out infinite;
                }

                :global(.dark) .acca-loader-buble::before,
                :global(.dark) .acca-loader-buble::after {
                    background: ${color || '#38bdf8'};
                    box-shadow: var(--_offset) 0 ${color || '#38bdf8'};
                }

                .acca-loader-buble::after {
                    box-shadow: none;
                    animation: accaBubleSlideBack 0.8s ease-in-out infinite;
                }

                @keyframes accaBubleSlide {
                    0%, 100% {
                        transform: translateX(0);
                    }
                    50% {
                        transform: translateX(var(--_offset));
                    }
                }

                @keyframes accaBubleSlideBack {
                    0%, 100% {
                        transform: translateX(var(--_offset));
                    }
                    50% {
                        transform: translateX(0);
                    }
                }

                /* Sengaja TIDAK menganimasikan stroke di sini: warnanya cukup
                   dari .acca-trace-path supaya loader ini satu warna saja.
                   Sebelumnya fase menarik garis (52%-92%) di-set magenta
                   #d946ef secara hardcode, yang juga membuat prop color
                   diabaikan selama separuh siklus. */
                @keyframes accaLogoTrace {
                    0% {
                        stroke-dashoffset: 100;
                        opacity: 0;
                    }
                    5% {
                        opacity: 1;
                    }
                    48% {
                        stroke-dashoffset: 0;
                        opacity: 1;
                    }
                    52% {
                        stroke-dashoffset: 8;
                        opacity: 1;
                    }
                    92% {
                        stroke-dashoffset: 100;
                        opacity: 1;
                    }
                    97%, 100% {
                        stroke-dashoffset: 100;
                        opacity: 0;
                    }
                }

                @keyframes accaDotStep {
                    0%, 20% {
                        opacity: 0.12;
                        transform: scale(0.65);
                    }
                    40%, 80% {
                        opacity: 1;
                        transform: scale(1.25);
                    }
                    100% {
                        opacity: 0.12;
                        transform: scale(0.65);
                    }
                }
            `}</style>
        </div>
    );
}

/**
 * PageLoader — loader area/halaman penuh, default variant trace.
 */
export function PageLoader({ label, minHeight, dotsOnly = false, variant = 'buble', size = 32 }: { label?: string; minHeight?: string; dotsOnly?: boolean; variant?: SpinnerVariant; size?: number }) {
    return (
        <div className="app-page-loader" style={minHeight ? { minHeight } : undefined}>
            <Spinner size={size} label={label} dotsOnly={dotsOnly} variant={variant} />
            <style jsx>{`
                /* Default-nya mengisi tinggi area konten yang terlihat, BUKAN
                   60vh seperti sebelumnya. justify-content: center memusatkan
                   terhadap kotak loader ini sendiri — kalau kotaknya cuma 60vh
                   dan menempel di atas area konten, spinner mendarat di sekitar
                   35% tinggi layar, jadi terlihat "di atas", bukan di tengah.
                   Header & bottom nav dikurangkan supaya titik tengahnya adalah
                   tengah area yang benar-benar terlihat. Variabelnya tidak
                   terdefinisi di desktop, jadi fallback-nya 0px.
                   (Tanpa backtick: blok ini template literal styled-jsx.) */
                .app-page-loader {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    padding: 20px;
                    min-height: calc(
                        100dvh - var(--app-header-h, 0px) - var(--app-bottomnav-h, 0px)
                    );
                }
            `}</style>
        </div>
    );
}

export default Spinner;
