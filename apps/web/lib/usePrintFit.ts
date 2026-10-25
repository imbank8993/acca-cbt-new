"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Mesin tata letak cetak A4.
 *
 * Setelah lembar ujian selesai dirender (rumus, font, gambar), mesin ini:
 *  1. menurunkan jumlah kolom opsi bila ada opsi yang tidak muat;
 *  2. memperkecil rumus, tabel, atau gambar yang lebih lebar dari area cetak
 *     sehingga tidak ada isi yang terpotong tepi kertas;
 *  3. menandai blok soal yang muat satu halaman agar tidak terbelah, lalu
 *     memperkirakan jumlah halaman;
 *  4. melaporkan gambar yang gagal dimuat dan elemen yang diperkecil.
 *
 * Lebar area isi di layar dan di kertas sama persis (180 mm), sehingga hasil
 * pengukuran di pratinjau berlaku langsung untuk cetakan.
 */

const MM = 96 / 25.4;
/** Tinggi area isi per halaman: A4 297 mm dikurangi spasi atas/bawah 12 mm. */
export const PRINT_PAGE_CONTENT_MM = 297 - 24;
const MIN_ZOOM = 0.45;
const READY_TIMEOUT_MS = 15000;

export interface PrintFitReport {
    status: 'preparing' | 'ready';
    pages: number;
    scaled: { number: number; percent: number }[];
    brokenImages: number[];
    stillOverflowing: number[];
    timedOut: boolean;
}

const INITIAL: PrintFitReport = { status: 'preparing', pages: 0, scaled: [], brokenImages: [], stillOverflowing: [], timedOut: false };

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
const frame = () => new Promise(resolve => window.requestAnimationFrame(() => resolve(null)));

function questionNumber(el: Element): number | null {
    const owner = el.closest<HTMLElement>('[data-question-number]');
    const value = owner ? Number(owner.dataset.questionNumber) : NaN;
    return Number.isFinite(value) ? value : null;
}

async function waitForContent(root: HTMLElement): Promise<boolean> {
    const started = Date.now();
    // LatexRenderer menampilkan placeholder berdenyut sampai HTML-nya siap.
    while (root.querySelector('.animate-pulse')) {
        if (Date.now() - started > READY_TIMEOUT_MS) return false;
        await wait(60);
    }
    // Font rumus (KaTeX) baru diminta browser setelah tata letak pertama,
    // jadi paksa tata letak dulu lalu tunggu sampai tidak ada font yang dimuat.
    for (let i = 0; i < 6; i++) {
        root.getBoundingClientRect();
        await frame();
        try {
            await Promise.race([document.fonts?.ready, wait(3000)]);
        } catch { /* font gagal dimuat tidak menghentikan pencetakan */ }
        await frame();
        if (!document.fonts || document.fonts.status === 'loaded') break;
    }
    const images = Array.from(root.querySelectorAll('img'));
    await Promise.race([
        Promise.all(images.map(img => img.complete ? null : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        }))),
        wait(Math.max(0, READY_TIMEOUT_MS - (Date.now() - started))),
    ]);
    await frame();
    await frame();
    return Date.now() - started <= READY_TIMEOUT_MS;
}

function contentBox(root: HTMLElement) {
    const rect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    return {
        left: rect.left + parseFloat(style.paddingLeft || '0'),
        right: rect.right - parseFloat(style.paddingRight || '0'),
    };
}

function resetFit(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-fit-zoom]').forEach(el => {
        el.style.removeProperty('zoom');
        delete el.dataset.fitZoom;
    });
    root.querySelectorAll<HTMLElement>('[data-fit-wrap]').forEach(el => { delete el.dataset.fitWrap; });
    root.querySelectorAll<HTMLElement>('[data-columns-initial]').forEach(el => {
        el.dataset.columns = el.dataset.columnsInitial;
        el.style.setProperty('--eqc-cols', el.dataset.columnsInitial || '1');
    });
    root.querySelectorAll<HTMLElement>('.eqc-keep, .eqc-split').forEach(el => el.classList.remove('eqc-keep', 'eqc-split'));
}

/** Kurangi kolom opsi sampai setiap opsi muat di selnya. */
function fitOptionGrids(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('.eqc-options[data-columns-initial]').forEach(grid => {
        const steps = [Number(grid.dataset.columnsInitial), 2, 1].filter((value, index, all) =>
            value >= 1 && all.indexOf(value) === index && value <= Number(grid.dataset.columnsInitial));
        for (const columns of steps) {
            grid.dataset.columns = String(columns);
            grid.style.setProperty('--eqc-cols', String(columns));
            if (columns === 1) break;
            const tooWide = Array.from(grid.querySelectorAll<HTMLElement>('.eqc-opt-content')).some(cell =>
                cell.scrollWidth > cell.clientWidth + 1);
            if (!tooWide) break;
        }
    });
}

/** Batas kanan yang tersedia bagi sebuah elemen: sel tabel / kolom opsi / area isi. */
function availableRight(el: HTMLElement, pageRight: number): number {
    const cell = el.parentElement?.closest<HTMLElement>('td, th, .eqc-opt-content');
    if (!cell) return pageRight;
    const rect = cell.getBoundingClientRect();
    const style = getComputedStyle(cell);
    return Math.min(pageRight, rect.right - parseFloat(style.paddingRight || '0') - parseFloat(style.borderRightWidth || '0'));
}

function applyZoom(el: HTMLElement, factor: number, scaled: Map<number, number>) {
    const current = Number(el.dataset.fitZoom || '1');
    const next = Math.max(MIN_ZOOM, Math.floor(current * factor * 100) / 100);
    el.style.setProperty('zoom', String(next));
    el.dataset.fitZoom = String(next);
    const number = questionNumber(el);
    if (number !== null) scaled.set(number, Math.min(scaled.get(number) ?? 100, Math.round(next * 100)));
}

const FIT_TARGETS = [
    '.katex-block', '.katex-display', '.katex-inline',
    '.latex-renderer table', '.latex-renderer pre', '.latex-renderer svg',
    '.eqc-table', '.eqc-matching', '.eqc-likert',
].join(',');

const TABLE_WRAP_BELOW = 0.7;
const CLIPPING = new Set(['hidden', 'clip', 'auto', 'scroll']);

/**
 * Tepi kanan yang benar-benar terlihat: isi yang sudah dipotong oleh leluhur
 * ber-overflow tersembunyi (mis. ekor akar KaTeX) tidak dihitung melebar.
 */
function visibleRight(el: Element, stopAt: Element): number {
    let right = el.getBoundingClientRect().right;
    for (let node = el.parentElement; node && node !== stopAt; node = node.parentElement) {
        if (CLIPPING.has(getComputedStyle(node).overflowX)) right = Math.min(right, node.getBoundingClientRect().right);
    }
    return right;
}

/** Lebar nyata sebuah rumus KaTeX = tepi kanan terjauh dari potongan dasarnya. */
function formulaRight(el: HTMLElement): number {
    const bases = el.querySelectorAll('.katex-html > .base, .katex-html > .tag');
    if (bases.length === 0) return el.getBoundingClientRect().right;
    let right = -Infinity;
    bases.forEach(base => { right = Math.max(right, base.getBoundingClientRect().right); });
    return right;
}

/** Perkecil elemen yang melebihi lebar area cetak. */
function fitWideElements(root: HTMLElement, scaled: Map<number, number>) {
    const page = contentBox(root);
    const targets = Array.from(root.querySelectorAll<HTMLElement>(FIT_TARGETS));
    for (const el of targets) {
        if (el.parentElement?.closest('[data-fit-zoom], .katex')) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width) continue;
        const isMath = el.matches('.katex-block, .katex-display, .katex-inline');
        const measure = () => (isMath
            ? formulaRight(el)
            : Math.max(el.getBoundingClientRect().right, rect.left + el.scrollWidth * Number(el.dataset.fitZoom || '1'))) - rect.left;
        const available = availableRight(el, page.right) - rect.left;
        let needed = measure();
        if (available <= 0 || needed <= available + 1) continue;
        // Tabel yang harus diperkecil terlalu jauh: izinkan kata panjang di
        // selnya terlipat dulu agar huruf tetap terbaca, baru perkecil sisanya.
        if (el.tagName === 'TABLE' && available / needed < TABLE_WRAP_BELOW) {
            el.dataset.fitWrap = '1';
            needed = measure();
            if (needed <= available + 1) continue;
        }
        applyZoom(el, available / needed, scaled);
    }
}

/** Elemen yang tepi kanannya (yang terlihat) melewati area cetak. */
function overflowingElements(scope: Element, root: HTMLElement, limit: number): HTMLElement[] {
    const out: HTMLElement[] = [];
    scope.querySelectorAll<HTMLElement>('*').forEach(el => {
        // Isi rumus diukur lewat wadahnya; bagian SVG di dalamnya sering sengaja terpotong.
        if (el.closest('.katex') && !el.matches('.katex-html > .base')) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= limit + 1) return;
        if (visibleRight(el, root) > limit + 1) out.push(el);
    });
    return out;
}

/**
 * Jaring pengaman terakhir: elemen apa pun yang masih melewati tepi kanan
 * membuat seluruh blok kontennya diperkecil.
 */
function fitRemainingOverflow(root: HTMLElement, scaled: Map<number, number>): number[] {
    for (let pass = 0; pass < 3; pass++) {
        const page = contentBox(root);
        const offenders = new Map<HTMLElement, number>();
        overflowingElements(root, root, page.right).forEach(el => {
            if (!el.closest('[data-question-number]')) return;
            const block = el.closest<HTMLElement>('.latex-renderer, .eqc-table, .eqc-options, .eqc-matching') || el;
            const needed = visibleRight(el, root) - block.getBoundingClientRect().left;
            offenders.set(block, Math.max(offenders.get(block) ?? 0, needed));
        });
        if (offenders.size === 0) break;
        offenders.forEach((needed, block) => {
            const available = page.right - block.getBoundingClientRect().left;
            if (available > 0 && needed > available) applyZoom(block, available / needed, scaled);
        });
    }
    const page = contentBox(root);
    const numbers = new Set<number>();
    overflowingElements(root, root, page.right).forEach(el => {
        const number = questionNumber(el);
        if (number !== null) numbers.add(number);
    });
    return [...numbers].sort((x, y) => x - y);
}

/** Tandai blok yang muat satu halaman agar tidak terbelah, lalu hitung halaman. */
function paginate(root: HTMLElement): number {
    const pageHeight = PRINT_PAGE_CONTENT_MM * MM;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-print-block]'));
    if (blocks.length === 0) return 1;
    const origin = blocks[0].getBoundingClientRect().top;
    let pages = 1;
    let used = 0;
    let previousBottom = origin;
    for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        const gap = Math.max(0, rect.top - previousBottom);
        previousBottom = rect.bottom;
        const keep = rect.height <= pageHeight * 0.92;
        block.classList.add(keep ? 'eqc-keep' : 'eqc-split');
        if (keep) {
            if (used > 0 && used + gap + rect.height > pageHeight) {
                pages++;
                used = rect.height;
            } else {
                used += gap + rect.height;
            }
        } else {
            used += gap + rect.height;
            while (used > pageHeight) {
                pages++;
                used -= pageHeight;
            }
        }
    }
    return pages;
}

function brokenImageNumbers(root: HTMLElement): number[] {
    const numbers = new Set<number>();
    root.querySelectorAll('img').forEach(img => {
        if (img.complete && img.naturalWidth === 0) {
            const number = questionNumber(img);
            if (number !== null) numbers.add(number);
        }
    });
    return [...numbers].sort((a, b) => a - b);
}

function runLayout(root: HTMLElement, timedOut: boolean): PrintFitReport {
    resetFit(root);
    fitOptionGrids(root);
    const scaled = new Map<number, number>();
    fitWideElements(root, scaled);
    const stillOverflowing = fitRemainingOverflow(root, scaled);
    const pages = paginate(root);
    return {
        status: 'ready',
        pages,
        scaled: [...scaled.entries()].sort((a, b) => a[0] - b[0]).map(([number, percent]) => ({ number, percent })),
        brokenImages: brokenImageNumbers(root),
        stillOverflowing,
        timedOut,
    };
}

export function usePrintFit(rootRef: RefObject<HTMLElement | null>, contentKey: string) {
    const [report, setReport] = useState<PrintFitReport>(INITIAL);
    const timedOutRef = useRef(false);
    const runIdRef = useRef(0);

    /** Jalankan ulang tata letak secara sinkron (dipakai tepat sebelum mencetak). */
    const relayout = useCallback(() => {
        const root = rootRef.current;
        if (!root) return null;
        const next = runLayout(root, timedOutRef.current);
        setReport(next);
        return next;
    }, [rootRef]);

    useEffect(() => {
        const runId = ++runIdRef.current;
        let cancelled = false;
        const start = async () => {
            await frame();
            if (cancelled) return;
            setReport(INITIAL);
            // Lembar dimuat secara dinamis; tunggu sampai elemennya ada.
            const waitStart = Date.now();
            while (!rootRef.current && !cancelled && Date.now() - waitStart < READY_TIMEOUT_MS) await wait(50);
            const root = rootRef.current;
            if (!root || cancelled) return;
            const ready = await waitForContent(root);
            if (cancelled || runId !== runIdRef.current) return;
            timedOutRef.current = !ready;
            setReport(runLayout(root, !ready));
        };
        void start();
        return () => { cancelled = true; };
    }, [contentKey, rootRef]);

    // Font atau gambar yang terlambat dimuat mengubah ukuran isi: hitung ulang.
    useEffect(() => {
        if (report.status !== 'ready') return;
        const root = rootRef.current;
        if (!root) return;
        let timer = 0;
        const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => relayout(), 200);
        };
        document.fonts?.addEventListener('loadingdone', schedule);
        root.addEventListener('load', schedule, true);
        root.addEventListener('error', schedule, true);
        return () => {
            window.clearTimeout(timer);
            document.fonts?.removeEventListener('loadingdone', schedule);
            root.removeEventListener('load', schedule, true);
            root.removeEventListener('error', schedule, true);
        };
    }, [relayout, report.status, rootRef]);

    // Ctrl+P / menu browser juga melewati mesin tata letak.
    useEffect(() => {
        const beforePrint = () => { relayout(); };
        window.addEventListener('beforeprint', beforePrint);
        return () => window.removeEventListener('beforeprint', beforePrint);
    }, [relayout]);

    return { report, relayout };
}
