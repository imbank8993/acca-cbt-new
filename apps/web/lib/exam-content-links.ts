/**
 * Link di isi soal/stimulus (mis. "Sumber bacaan: https://…") tidak boleh
 * membawa siswa keluar dari halaman ujian. Membuka link berarti tab ujian
 * tersembunyi atau ditinggalkan, lalu tercatat sebagai pelanggaran tab_switch,
 * padahal siswa hanya mengklik isi soal.
 */
const CONTENT_LINK_SELECTOR = '.question-content a[href], .latex-renderer a[href]';

/** Link isi soal yang menjadi target event, atau null. */
export function contentLinkFromEvent(event: Event): HTMLAnchorElement | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const link = target.closest<HTMLAnchorElement>(CONTENT_LINK_SELECTOR);
    if (!link) return null;
    // Lompatan dalam halaman (#catatan-kaki) tidak meninggalkan ujian.
    const href = link.getAttribute('href') || '';
    return href.startsWith('#') ? null : link;
}

/**
 * Tahan klik (termasuk klik tengah, Ctrl/Shift+klik) dan seret pada link isi
 * soal selama ujian. Fase capture dipakai agar berlaku sebelum handler lain.
 */
export function installExamContentLinkGuard(onBlocked: (link: HTMLAnchorElement) => void): () => void {
    const block = (event: Event) => {
        const link = contentLinkFromEvent(event);
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'click' || event.type === 'auxclick') onBlocked(link);
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter') block(event);
    };
    const types = ['click', 'auxclick', 'dragstart'] as const;
    types.forEach(type => document.addEventListener(type, block, true));
    document.addEventListener('keydown', onKeyDown, true);
    document.body.classList.add('exam-content-links-locked');
    return () => {
        types.forEach(type => document.removeEventListener(type, block, true));
        document.removeEventListener('keydown', onKeyDown, true);
        document.body.classList.remove('exam-content-links-locked');
    };
}

/** Alamat link eksternal pada HTML isi soal (untuk peringatan di editor). */
export function findContentLinks(...htmlParts: Array<string | null | undefined>): string[] {
    const found = new Set<string>();
    const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
    for (const html of htmlParts) {
        if (!html) continue;
        for (const match of html.matchAll(pattern)) {
            const href = match[2].trim();
            if (href && !href.startsWith('#')) found.add(href);
        }
    }
    return [...found];
}
