import DOMPurify from 'dompurify';

// Exact URLs only: never allow an entire CDN origin for executable content.
const TAILWIND = 'https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js';
const ICON_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
const ICON_FONTS = ['fa-solid-900.woff2', 'fa-regular-400.woff2', 'fa-brands-400.woff2']
    .map(name => `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/${name}`).join(' ');

/** Author scripts execute only in an opaque-origin sandbox, never in the app. */
export function learningPreviewDocument(html: string, interactive = false, bridge?: string): string {
    const source = interactive ? html : DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, USE_PROFILES: { html: true, mathMl: true, svg: true } });
    const document = new DOMParser().parseFromString(source, 'text/html');
    document.querySelectorAll('base, meta[http-equiv], iframe, frame, frameset, object, embed').forEach(node => node.remove());
    if (interactive) {
        document.querySelectorAll('script').forEach(node => {
            const src = node.getAttribute('src');
            if (src && src !== TAILWIND) { node.remove(); return; }
            node.removeAttribute('nonce');
        });
        document.querySelectorAll('link').forEach(node => {
            if (node.getAttribute('rel') !== 'stylesheet' || node.getAttribute('href') !== ICON_CSS) node.remove();
        });
    }
    // Safe external links open in a new tab; hash links remain within the document
    document.querySelectorAll('a').forEach(node => {
        const href = node.getAttribute('href');
        if (interactive && href && !href.startsWith('#')) { node.removeAttribute('href'); return; }
        if (href && !href.startsWith('#')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
    });
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 80);
    if (!interactive && headings.length > 1) {
        const nav = document.createElement('details'); nav.open = true;
        const summary = document.createElement('summary'); summary.textContent = 'Daftar isi'; nav.append(summary);
        const list = document.createElement('ol');
        headings.forEach((heading, index) => { heading.id = `materi-bagian-${index}`; const li = document.createElement('li'); const link = document.createElement('a'); link.href = `#${heading.id}`; link.textContent = heading.textContent; li.append(link); list.append(li); });
        nav.append(list); document.body.prepend(nav);
    }
    const csp = document.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
    csp.content = interactive
        ? `default-src 'none'; script-src 'unsafe-inline' ${TAILWIND}; style-src 'unsafe-inline' ${ICON_CSS}; font-src data: ${ICON_FONTS}; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`
        : "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https:; font-src data: https:; img-src data: blob: https: http:; media-src data: blob: https: http:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";
    document.head.prepend(csp);

    if (!document.querySelector('meta[name="viewport"]')) {
        const vp = document.createElement('meta');
        vp.name = 'viewport';
        vp.content = 'width=device-width, initial-scale=1.0';
        document.head.prepend(vp);
    }
    if (!document.querySelector('meta[charset]')) {
        const cs = document.createElement('meta');
        cs.setAttribute('charset', 'utf-8');
        document.head.prepend(cs);
    }

    const style = document.createElement('style');
    style.textContent = 'html{scroll-behavior:smooth;color-scheme:light}body{font:17px/1.8 system-ui,sans-serif;color:#172b3a;background:white;margin:0;padding:28px;overflow-wrap:anywhere}body>article{max-width:860px;margin:auto}h1,h2,h3{line-height:1.3;scroll-margin-top:20px}h1{font-size:2em}h2{margin-top:2em}img,video{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}td,th{border:1px solid #dce5ec;padding:10px}pre{white-space:pre-wrap;background:#f3f6f9;padding:16px;border-radius:12px}code{font-size:.9em}math[display=block]{overflow:auto;padding:12px}details{padding:16px 20px;background:#f1f7f7;border-radius:12px;margin-bottom:28px}summary{cursor:pointer;font-weight:600}a{color:#0f766e}blockquote{border-left:3px solid #0d9488;padding-left:20px;color:#526475}@media(max-width:600px){body{padding:18px;font-size:16px}}';
    if (interactive) {
        // Let the uploaded activity own its layout; defaults precede author styles.
        style.textContent = 'html{min-height:100%;color-scheme:light;scroll-behavior:smooth}body{margin:0;min-height:100vh}';
        csp.after(style);
    } else document.head.append(style);
    if (interactive && bridge) {
        const script = document.createElement('script'); script.textContent = bridge;
        csp.after(script);
    }
    return '<!doctype html>' + document.documentElement.outerHTML;
}
