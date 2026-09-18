/**
 * linkifyText — escape plain text lalu ubah URL menjadi anchor yang aman.
 *
 * Konten pengumuman adalah plain text (dirender dengan whitespace-pre-wrap).
 * Sebelumnya konten dimasukkan mentah ke dangerouslySetInnerHTML hanya dengan
 * regex linkify — HTML apa pun di dalamnya (mis. <img onerror=...>) ikut
 * tereksekusi (stored XSS di dashboard semua role). Escape SEMUA karakter HTML
 * terlebih dahulu, baru bungkus URL dengan <a>, sehingga satu-satunya markup
 * pada output adalah anchor buatan fungsi ini.
 */
export function linkifyText(
    text: string,
    linkClass: string = 'underline font-semibold hover:text-blue-900'
): string {
    if (!text) return '';
    const escaped = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    return escaped.replace(
        /(https?:\/\/[^\s]+)/g,
        (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${url}</a>`
    );
}
