import DOMPurify from 'dompurify';

/** Opaque-origin iframe + restrictive CSP: uploaded scripts never receive the app origin. */
export function learningPreviewDocument(html: string, interactive = false, fullPage = false): string {
    const source = interactive ? html : DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true } });
    const document = new DOMParser().parseFromString(source, 'text/html');
    document.querySelectorAll('base, meta[http-equiv], iframe, object, embed').forEach(node => node.remove());
    // Do not allow a link, form, or meta refresh to replace the isolated document with a remote page.
    document.querySelectorAll('a').forEach(node => { if (!node.getAttribute('href')?.startsWith('#')) node.removeAttribute('href'); node.removeAttribute('target'); });
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 80);
    if (!interactive && headings.length > 1) {
        const nav = document.createElement('details'); nav.open = true;
        const summary = document.createElement('summary'); summary.textContent = 'Daftar isi'; nav.append(summary);
        const list = document.createElement('ol');
        headings.forEach((heading, index) => { heading.id = `materi-bagian-${index}`; const li = document.createElement('li'); const link = document.createElement('a'); link.href = `#${heading.id}`; link.textContent = heading.textContent; li.append(link); list.append(li); });
        nav.append(list); document.body.prepend(nav);
    }
    const csp = document.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
    csp.content = `default-src 'none'; script-src ${interactive ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    document.head.prepend(csp);
    const style = document.createElement('style');
    style.textContent = 'html{scroll-behavior:smooth;color-scheme:light}body{font:17px/1.8 system-ui,sans-serif;color:#172b3a;background:white;margin:0;padding:28px;overflow-wrap:anywhere}body>article{max-width:860px;margin:auto}h1,h2,h3{line-height:1.3;scroll-margin-top:20px}h1{font-size:2em}h2{margin-top:2em}img,video{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}td,th{border:1px solid #dce5ec;padding:10px}pre{white-space:pre-wrap;background:#f3f6f9;padding:16px;border-radius:12px}code{font-size:.9em}math[display=block]{overflow:auto;padding:12px}details{padding:16px 20px;background:#f1f7f7;border-radius:12px;margin-bottom:28px}summary{cursor:pointer;font-weight:600}a{color:#0f766e}blockquote{border-left:3px solid #0d9488;padding-left:20px;color:#526475}@media(max-width:600px){body{padding:18px;font-size:16px}}';
    if (interactive && fullPage) {
        // Let the uploaded activity own its layout; defaults precede author styles.
        style.textContent = 'html{min-height:100%;color-scheme:light}body{margin:0;min-height:100vh}';
        csp.after(style);
    } else document.head.append(style);
    return '<!doctype html>' + document.documentElement.outerHTML;
}
