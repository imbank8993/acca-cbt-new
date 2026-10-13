type FullscreenDocument = Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
};

export type FullscreenElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
};

export function hasExamFullscreen(): boolean {
    const doc = document as FullscreenDocument;
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
}

export function supportsExamFullscreen(): boolean {
    const el = document.documentElement as FullscreenElement;
    return Boolean(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
}

/** Track browser state even while exam data is loading. */
export function subscribeExamFullscreen(changed: () => void): () => void {
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];
    events.forEach(event => document.addEventListener(event, changed));
    return () => events.forEach(event => document.removeEventListener(event, changed));
}

export async function exitExamFullscreen(): Promise<void> {
    if (!hasExamFullscreen()) return;
    const doc = document as FullscreenDocument;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
    if (!exit) throw new Error('Browser tidak menyediakan kontrol keluar layar penuh.');
    await exit.call(doc);
}
