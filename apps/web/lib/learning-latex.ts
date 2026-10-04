import { renderToString } from 'katex';

export const escapeLearningHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** A bounded document reader, never a TeX executable. Unknown commands stay visible with warnings. */
export function convertLearningLatex(source: string): { html: string; notes: string[] } {
    if (source.length > 500_000) throw new Error('LaTeX terlalu panjang. Maksimum 500.000 karakter.');
    const notes = new Set<string>();
    const title = source.match(/\\title\{([^}]*)\}/)?.[1];
    if (/\\(?:newcommand|renewcommand|def|input|include|usepackage)\b/.test(source)) notes.add('Paket, makro khusus, dan berkas tambahan tidak dijalankan. Periksa hasil konversi.');
    const body = source.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
    if (body) source = body[1];
    let index = 0;
    const group = () => {
        while (/\s/.test(source[index] || '') && index < source.length) index++;
        if (source[index] !== '{') return '';
        const start = ++index; let depth = 1;
        while (index < source.length && depth) {
            if (source[index] === '\\') { index += 2; continue; }
            if (source[index] === '{') depth++;
            if (source[index] === '}') depth--;
            index++;
        }
        return source.slice(start, depth ? index : index - 1);
    };
    const math = (text: string, display: boolean) => {
        try { return renderToString(text, { displayMode: display, output: 'mathml', throwOnError: true, trust: false, maxExpand: 200, maxSize: 20, strict: 'ignore' }); }
        catch { notes.add('Ada rumus yang belum didukung; sumber rumus ditampilkan agar tidak hilang.'); return `<code>${escapeLearningHtml(text)}</code>`; }
    };
    const inline = (text: string, depth = 0): string => {
        if (depth > 20) return escapeLearningHtml(text);
        return escapeLearningHtml(text).replace(/\\(textbf|emph|textit|texttt)\{([^{}]*)\}/g, (_, cmd: string, inner: string) => {
            const tag = cmd === 'textbf' ? 'strong' : cmd === 'texttt' ? 'code' : 'em'; return `<${tag}>${inner}</${tag}>`;
        });
    };
    let html = ''; const lists: { tag: string; open: boolean }[] = [];
    while (index < source.length) {
        if (source[index] === '%') { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue; }
        if (source[index] === '$' || source.startsWith('\\[', index) || source.startsWith('\\(', index)) {
            const delimiter = source.startsWith('$$', index) ? '$$' : source[index] === '$' ? '$' : source.slice(index, index + 2);
            const closing = delimiter === '\\[' ? '\\]' : delimiter === '\\(' ? '\\)' : delimiter;
            const start = index + delimiter.length, end = source.indexOf(closing, start);
            if (end < 0) { html += escapeLearningHtml(source.slice(index)); notes.add('Pembatas rumus tidak lengkap.'); break; }
            html += math(source.slice(start, end), delimiter === '$$' || delimiter === '\\['); index = end + closing.length; continue;
        }
        if (source[index] !== '\\') {
            if (source.startsWith('\n\n', index)) { html += '<br><br>'; index += 2; }
            else { html += escapeLearningHtml(source[index] === '~' ? '\u00a0' : source[index]); index++; }
            continue;
        }
        index++;
        const special = source[index];
        if (special && '%$&#_{}\\'.includes(special)) { html += special === '\\' ? '<br>' : escapeLearningHtml(special); index++; continue; }
        const command = source.slice(index).match(/^[a-zA-Z]+\*?/)?.[0] || '';
        if (!command) { html += '\\'; continue; }
        index += command.length;
        const base = command.replace(/\*$/, '');
        if (['section', 'subsection', 'subsubsection', 'chapter', 'paragraph'].includes(base)) {
            const level = base === 'chapter' ? 1 : base === 'section' ? 2 : base === 'subsection' ? 3 : 4;
            html += `<h${level}>${inline(group())}</h${level}>`;
        } else if (['textbf', 'textit', 'emph', 'texttt', 'underline'].includes(base)) {
            const tag = base === 'textbf' ? 'strong' : base === 'texttt' ? 'code' : base === 'underline' ? 'u' : 'em';
            html += `<${tag}>${inline(group())}</${tag}>`;
        } else if (base === 'begin') {
            const environment = group();
            if (['itemize', 'enumerate'].includes(environment)) { const tag = environment === 'itemize' ? 'ul' : 'ol'; lists.push({ tag, open: false }); html += `<${tag}>`; }
            else if (['equation', 'equation*', 'align', 'align*', 'displaymath'].includes(environment)) {
                const endTag = `\\end{${environment}}`, end = source.indexOf(endTag, index);
                if (end < 0) { notes.add(`Lingkungan ${environment} belum ditutup.`); continue; }
                const content = source.slice(index, end);
                html += math(environment.startsWith('align') ? `\\begin{aligned}${content}\\end{aligned}` : content, true); index = end + endTag.length;
            } else if (environment === 'verbatim') {
                const end = source.indexOf('\\end{verbatim}', index);
                html += `<pre>${escapeLearningHtml(source.slice(index, end < 0 ? source.length : end))}</pre>`; index = end < 0 ? source.length : end + 14;
            } else if (environment === 'tabular') {
                group(); const end = source.indexOf('\\end{tabular}', index);
                if (end >= 0) {
                    html += '<table><tbody>' + source.slice(index, end).replace(/\\hline/g, '').split('\\\\').filter(row => row.trim()).map(row => '<tr>' + row.split('&').map(cell => `<td>${inline(cell.trim())}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
                    index = end + 13;
                }
            } else { notes.add(`Lingkungan ${environment} ditampilkan sebagai teks; tata letak mungkin berbeda.`); }
        } else if (base === 'end') {
            const environment = group();
            if (['itemize', 'enumerate'].includes(environment)) { const list = lists.pop(); if (list) html += `${list.open ? '</li>' : ''}</${list.tag}>`; }
        } else if (base === 'item') {
            const list = lists[lists.length - 1];
            if (list) { html += `${list.open ? '</li>' : ''}<li>`; list.open = true; } else html += '<br>• ';
        } else if (base === 'maketitle') { if (title) html += `<h1>${inline(title)}</h1>`; }
        else if (['par', 'newline', 'newpage', 'clearpage'].includes(base)) html += '<br><br>';
        else if (['label', 'title', 'author', 'date'].includes(base)) group();
        else if (base === 'tableofcontents') { /* The viewer creates the actual navigation. */ }
        else { notes.add(`Perintah \\${base} belum dikonversi sepenuhnya.`); html += `<code>${escapeLearningHtml('\\' + command)}</code>`; }
    }
    while (lists.length) { const list = lists.pop()!; html += `${list.open ? '</li>' : ''}</${list.tag}>`; }
    return { html: `<article>${html}</article>`, notes: Array.from(notes).slice(0, 30) };
}
