/**
 * Apakah perangkat ini bisa membagikan seluruh layar dari browser?
 *
 * Browser tablet/HP (Chrome & Firefox Android, Samsung Internet, semua browser
 * iPhone/iPad) tidak mendukung getDisplayMedia. Sebagian versi lama Android
 * (mis. Chrome Android 72–88, Firefox Android 66–79) tetap MENAMPILKAN fungsinya
 * tetapi selalu menolak dengan NotAllowedError, sehingga deteksi fitur saja
 * membuat siswa terus diminta "coba lagi". Karena itu perangkat sentuh dikenali
 * lebih dulu.
 */

export type ScreenShareSupport = 'supported' | 'unsupported-device' | 'unsupported-browser';

export interface ScreenShareEnvironment {
    hasGetDisplayMedia: boolean;
    userAgent: string;
    /** navigator.userAgentData?.mobile, bila tersedia (Chromium). */
    userAgentDataMobile?: boolean;
    platform?: string;
    maxTouchPoints?: number;
    /** matchMedia('(any-pointer: fine)').matches — ada mouse/trackpad. */
    finePointer?: boolean;
}

/** Tablet atau HP (termasuk iPad yang menyamar sebagai Mac). */
export function isMobileOrTablet(env: ScreenShareEnvironment): boolean {
    if (env.userAgentDataMobile === true) return true;
    const ua = env.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|HarmonyOS/i.test(ua)) return true;
    // iPadOS 13+ melaporkan dirinya sebagai Macintosh; Mac sungguhan tidak punya layar sentuh.
    const touch = (env.maxTouchPoints ?? 0) > 1;
    if (touch && (/Macintosh/i.test(ua) || env.platform === 'MacIntel')) return true;
    // Layar sentuh tanpa mouse/trackpad sama sekali: tablet dengan mode "situs desktop".
    if (touch && env.finePointer === false && !/Windows NT|CrOS/i.test(ua)) return true;
    return false;
}

export function screenShareSupport(env: ScreenShareEnvironment): ScreenShareSupport {
    if (isMobileOrTablet(env)) return 'unsupported-device';
    if (!env.hasGetDisplayMedia) return 'unsupported-browser';
    return 'supported';
}

/** Penolakan instan dari browser yang tidak benar-benar mendukung (bukan siswa menekan Batal). */
export function isUnsupportedRejection(error: unknown, env: ScreenShareEnvironment): boolean {
    const name = (error as { name?: string } | null)?.name || '';
    if (name === 'NotSupportedError' || name === 'InvalidStateError') return true;
    return name === 'NotAllowedError' && isMobileOrTablet(env);
}

export function currentScreenShareEnvironment(): ScreenShareEnvironment {
    if (typeof navigator === 'undefined') return { hasGetDisplayMedia: false, userAgent: '' };
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    let finePointer: boolean | undefined;
    try { finePointer = window.matchMedia?.('(any-pointer: fine)').matches; } catch { finePointer = undefined; }
    return {
        hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
        userAgent: navigator.userAgent || '',
        userAgentDataMobile: uaData?.mobile,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        finePointer,
    };
}

export const SCREEN_SHARE_UNSUPPORTED_DEVICE_MESSAGE =
    'Tablet dan HP tidak dapat membagikan layar dari browser. Gunakan laptop atau komputer, atau minta pengawas memberi ' +
    'pengecualian berbagi layar untuk Anda. Halaman ini akan terbuka sendiri setelah pengecualian diberikan. Waktu ujian belum berjalan.';

export const SCREEN_SHARE_UNSUPPORTED_BROWSER_MESSAGE =
    'Browser ini tidak menyediakan berbagi layar. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru di laptop/komputer, ' +
    'atau minta pengawas memberi pengecualian. Halaman ini akan terbuka sendiri setelah pengecualian diberikan. Waktu ujian belum berjalan.';
