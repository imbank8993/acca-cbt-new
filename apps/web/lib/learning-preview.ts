import DOMPurify from 'dompurify';
import * as katexModule from 'katex';

// Exact URLs only: never allow an entire CDN origin for executable content.
const TAILWIND = 'https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js';
const ICON_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
const ICON_FONTS = ['fa-solid-900.woff2', 'fa-regular-400.woff2', 'fa-brands-400.woff2']
    .map(name => `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/${name}`).join(' ');
const KATEX_ASSET = '/learning/katex.min.js';

const MATH_REGEX = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{(?:equation|aligned|array|pmatrix|bmatrix|cases)\}[\s\S]*?\\end\{(?:equation|aligned|array|pmatrix|bmatrix|cases)\}|\\\(.*?\\\)|\[%.*?%\]|\$(?:[^$\\]|\\.)+\$)/g;
const MATH_BOUNDARIES = new Set([
    'BODY', 'A', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BUTTON', 'DIV', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'FORM', 'HEADER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
    'IMG', 'LABEL', 'LI', 'MAIN', 'OL', 'P', 'SECTION', 'SUMMARY', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'BR',
]);
const MATH_EXCLUDED = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA', 'NOSCRIPT', 'MATH', 'SVG']);

function getKatexRenderer(): ((text: string, options?: unknown) => string) | null {
    if (typeof (katexModule as Record<string, unknown>)?.renderToString === 'function') {
        return (katexModule as Record<string, unknown>).renderToString as (text: string, options?: unknown) => string;
    }
    const def = (katexModule as Record<string, unknown>)?.default as Record<string, unknown> | undefined;
    if (typeof def?.renderToString === 'function') {
        return def.renderToString as (text: string, options?: unknown) => string;
    }
    return null;
}

function renderLearningMath(doc: Document): void {
    const render = getKatexRenderer();
    if (!render || !doc.body) return;

    let run: Text[] = [];
    const flush = () => {
        if (!run.length) return;
        const spans = run.map(node => ({ node, value: node.nodeValue || '', start: 0 }));
        let text = '';
        for (const span of spans) { span.start = text.length; text += span.value; }
        run = [];
        if (!text.includes('$') && !text.includes('\\') && !text.includes('[%')) return;

        MATH_REGEX.lastIndex = 0;
        const matches = Array.from(text.matchAll(MATH_REGEX));
        // Replace from the end so earlier offsets still point to the original text nodes.
        for (const match of matches.reverse()) {
            const raw = match[0];
            const isBlock = raw.startsWith('$$') || raw.startsWith('\\[') || raw.startsWith('\\begin{');
            let expr = raw;
            if (raw.startsWith('$$') && raw.endsWith('$$')) expr = raw.slice(2, -2);
            else if (raw.startsWith('\\[') && raw.endsWith('\\]')) expr = raw.slice(2, -2);
            else if (raw.startsWith('\\(') && raw.endsWith('\\)')) expr = raw.slice(2, -2);
            else if (raw.startsWith('[%') && raw.endsWith('%]')) expr = raw.slice(2, -2);
            else if (raw.startsWith('$') && raw.endsWith('$')) expr = raw.slice(1, -1);

            try {
                const rendered = render(expr.trim(), {
                    displayMode: isBlock,
                    output: 'mathml',
                    throwOnError: false,
                    strict: 'ignore',
                });
                const start = match.index ?? 0;
                const end = start + raw.length;
                const first = spans.find(span => start < span.start + span.value.length);
                const last = spans.find(span => end <= span.start + span.value.length && end > span.start);
                if (!first || !last || !first.node.parentNode) continue;
                const temp = doc.createElement('div');
                temp.innerHTML = rendered;
                const fragment = doc.createDocumentFragment();
                while (temp.firstChild) fragment.appendChild(temp.firstChild);
                const prefix = first.node.nodeValue?.slice(0, start - first.start) || '';
                const suffix = last.node.nodeValue?.slice(end - last.start) || '';
                const parent = first.node.parentNode;
                if (first === last) {
                    first.node.nodeValue = prefix;
                    const after = doc.createTextNode(suffix);
                    parent.insertBefore(after, first.node.nextSibling);
                    parent.insertBefore(fragment, after);
                } else {
                    first.node.nodeValue = prefix;
                    for (const span of spans.slice(spans.indexOf(first) + 1, spans.indexOf(last))) span.node.nodeValue = '';
                    last.node.nodeValue = suffix;
                    parent.insertBefore(fragment, first.node.nextSibling);
                }
            } catch { /* Keep the original expression when it cannot be rendered. */ }
        }
    };

    const visit = (node: Node) => {
        if (node.nodeType === 3) { run.push(node as Text); return; }
        if (node.nodeType !== 1) return;
        const tag = node.nodeName.toUpperCase();
        if (MATH_EXCLUDED.has(tag)) { flush(); return; }
        const boundary = MATH_BOUNDARIES.has(tag);
        if (boundary) flush();
        // Keep inline formatting within a single math run, while block elements
        // and code form separate runs. Word conversion often splits $...$ into spans.
        for (const child of Array.from(node.childNodes)) visit(child);
        if (boundary) flush();
    };
    visit(doc.body);
    flush();
}

// Interactive materials often insert quiz questions after the initial HTML has
// been parsed. Keep the renderer inside the opaque iframe and touch only text
// nodes, so event handlers and answer state owned by the activity survive.
const INTERACTIVE_MATH_SCRIPT = String.raw`(() => {
    const regex = ${MATH_REGEX.toString()};
    const excluded = 'script,style,pre,code,textarea,noscript,math,svg';
    const renderNode = node => {
        const original = node.nodeValue || '';
        if (!original.includes('$') && !original.includes('\\') && !original.includes('[%')) return;
        regex.lastIndex = 0;
        const matches = Array.from(original.matchAll(regex));
        if (!matches.length || !node.parentNode) return;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
            const raw = match[0], start = match.index;
            fragment.appendChild(document.createTextNode(original.slice(cursor, start)));
            let expression = raw;
            if (raw.startsWith('$$')) expression = raw.slice(2, -2);
            else if (raw.startsWith('\\[') || raw.startsWith('\\(') || raw.startsWith('[%')) expression = raw.slice(2, -2);
            else if (raw.startsWith('$')) expression = raw.slice(1, -1);
            try {
                const html = window.katex.renderToString(expression.trim(), {
                    displayMode: raw.startsWith('$$') || raw.startsWith('\\[') || raw.startsWith('\\begin{'),
                    output: 'mathml', throwOnError: false, trust: false, strict: 'ignore',
                });
                const holder = document.createElement('span');
                holder.innerHTML = html;
                while (holder.firstChild) fragment.appendChild(holder.firstChild);
            } catch { fragment.appendChild(document.createTextNode(raw)); }
            cursor = start + raw.length;
        }
        fragment.appendChild(document.createTextNode(original.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
    };
    const scan = () => {
        if (!window.katex || !document.body) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            if (!node.parentElement || node.parentElement.closest(excluded)) continue;
            nodes.push(node);
        }
        for (const text of nodes) renderNode(text);
    };
    const start = () => {
        scan();
        let timer = null;
        const observer = new MutationObserver(() => {
            if (timer !== null) return;
            timer = setTimeout(() => { timer = null; scan(); }, 0);
        });
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();`;

/** Author scripts execute only in an opaque-origin sandbox, never in the app. */
export function learningPreviewDocument(html: string, interactive = false, bridge?: string): string {
    const source = interactive ? html : DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, USE_PROFILES: { html: true, mathMl: true, svg: true } });
    const document = new DOMParser().parseFromString(source, 'text/html');
    renderLearningMath(document);
    const mathAssetUrl = interactive && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
        ? new URL(KATEX_ASSET, location.origin).href : null;
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
        ? `default-src 'none'; script-src 'unsafe-inline' ${TAILWIND}${mathAssetUrl ? ` ${mathAssetUrl}` : ''}; style-src 'unsafe-inline' ${ICON_CSS}; font-src data: ${ICON_FONTS}; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`
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
    style.textContent = 'html{scroll-behavior:smooth;color-scheme:light}body{font:17px/1.8 system-ui,sans-serif;color:#172b3a;background:white;margin:0;padding:28px;overflow-wrap:anywhere}body>article{max-width:860px;margin:auto}h1,h2,h3{line-height:1.3;scroll-margin-top:20px}h1{font-size:2em}h2{margin-top:2em}img,video{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}td,th{border:1px solid #dce5ec;padding:10px}pre{white-space:pre-wrap;background:#f3f6f9;padding:16px;border-radius:12px}code{font-size:.9em}math[display=block]{overflow-x:auto;overflow-y:hidden;padding:12px;max-width:100%}.katex{font-size:1.05em}details{padding:16px 20px;background:#f1f7f7;border-radius:12px;margin-bottom:28px}summary{cursor:pointer;font-weight:600}a{color:#0f766e}blockquote{border-left:3px solid #0d9488;padding-left:20px;color:#526475}@media(max-width:600px){body{padding:18px;font-size:16px}}';
    if (interactive) {
        // Let the uploaded activity own its layout; defaults precede author styles.
        style.textContent = 'html{min-height:100%;color-scheme:light;scroll-behavior:smooth}body{margin:0;min-height:100vh}math[display=block]{overflow-x:auto;overflow-y:hidden;padding:8px 0;margin:8px 0;max-width:100%}.katex{font-size:1.05em}';
        csp.after(style);
    } else document.head.append(style);
    if (interactive && bridge) {
        const script = document.createElement('script'); script.textContent = bridge;
        csp.after(script);
    }
    if (mathAssetUrl) {
        const library = document.createElement('script'); library.src = mathAssetUrl;
        const runtime = document.createElement('script'); runtime.textContent = INTERACTIVE_MATH_SCRIPT;
        csp.after(library);
        library.after(runtime);
    }
    return '<!doctype html>' + document.documentElement.outerHTML;
}
