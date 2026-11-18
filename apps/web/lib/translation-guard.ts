/**
 * Mendeteksi halaman ujian yang diterjemahkan otomatis.
 *
 * Root layout sudah memasang `translate="no"`, kelas `notranslate`, dan
 * `<meta name="google" content="notranslate">`, sehingga terjemahan bawaan
 * Chrome, Edge, Safari, dan Firefox tidak ditawarkan. Detektor ini menangkap
 * yang tetap lolos: ekstensi penerjemah atau terjemahan yang dipaksa pengguna.
 * Semua tanda di bawah ini hanya muncul bila penerjemah benar-benar mengubah
 * DOM, jadi tidak ada salah deteksi dari soal yang memang berbahasa asing.
 */

// Tanda di dalam <body> sengaja dibatasi pada elemen buatan penerjemah sendiri.
// <font style="vertical-align: inherit"> milik Google TIDAK dipakai: guru bisa
// menyalin soal dari halaman yang sudah diterjemahkan, dan sisa tag itu akan
// membuat semua siswa tercatat melanggar.
const GOOGLE_SELECTOR = '.goog-te-banner-frame, #goog-gt-tt, body > .skiptranslate';
const EXTENSION_SELECTOR = [
    // Immersive Translate
    'immersive-translate-modal', '#immersive-translate-popup',
    'html[data-immersive-translate-page-theme]',
    // TWP, Mate, Saladict, XTranslate
    '#twp-popup', 'mate-translate-popup', '.saladict-panel', 'xtranslate-pop',
].join(',');

/** Nama penerjemah bila halaman sedang diterjemahkan, selain itu null. */
export function detectPageTranslation(doc: Document = document): string | null {
    const html = doc.documentElement;
    // Chrome/Google Translate memberi kelas ini pada <html> selama terjemahan aktif.
    if (html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl')) return 'google';
    // Penerjemah browser (Chrome, Edge, Safari, Firefox) mengganti lang <html>
    // ke bahasa tujuan; aplikasi ini sendiri tidak pernah mengubahnya.
    const lang = (html.getAttribute('lang') || '').toLowerCase();
    if (lang && !lang.startsWith('id')) return `lang:${lang.slice(0, 16)}`;
    // Microsoft Translator (Edge) menandai <title> yang ikut diterjemahkan.
    if (doc.querySelector('head [_msttexthash], head [_msthash], html[_msthash]')) return 'microsoft';
    if (doc.querySelector(GOOGLE_SELECTOR)) return 'google';
    if (doc.querySelector(EXTENSION_SELECTOR)) return 'extension';
    return null;
}

/**
 * Memanggil `onChange` setiap kali status terjemahan berubah. Pemeriksaan
 * dibatasi sekali per 500 ms supaya ketikan jawaban tidak membebani halaman.
 */
export function watchPageTranslation(onChange: (translator: string | null) => void): () => void {
    let current: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
        timer = undefined;
        const next = detectPageTranslation();
        if (next === current) return;
        current = next;
        onChange(next);
    };
    const schedule = () => { if (!timer) timer = setTimeout(check, 500); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'lang', '_msttexthash', '_msthash', 'data-immersive-translate-page-theme'],
        childList: true, subtree: true,
    });
    check();
    return () => {
        observer.disconnect();
        if (timer) clearTimeout(timer);
    };
}
