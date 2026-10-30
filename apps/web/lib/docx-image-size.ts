const WORD_DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

/** Carry Word's display dimensions through Mammoth's image alt text. */
export function preserveWordImageSizes(doc: Document): void {
    for (const kind of ['inline', 'anchor']) {
        for (const drawing of Array.from(doc.getElementsByTagNameNS(WORD_DRAWING_NS, kind))) {
            const extent = drawing.getElementsByTagNameNS(WORD_DRAWING_NS, 'extent')[0];
            const props = drawing.getElementsByTagNameNS(WORD_DRAWING_NS, 'docPr')[0];
            if (!extent || !props) continue;
            const width = Number(extent.getAttribute('cx')) / 9525;
            const height = Number(extent.getAttribute('cy')) / 9525;
            if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) continue;
            const alt = props.getAttribute('descr') || props.getAttribute('title') || '';
            props.setAttribute('descr', `[CBT_IMG_SIZE:${width.toFixed(2)}:${height.toFixed(2)}]${alt}`);
        }
    }
}

export function restoreWordImageSizes(html: string): string {
    return html.replace(/<img\b[^>]*>/gi, tag => {
        const dimensions = tag.match(/\[CBT_IMG_SIZE:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)\]/);
        if (!dimensions) return tag;
        const [, width, height] = dimensions;
        return tag.replace(dimensions[0], '').replace(/\s*\/?>(?=$)/,
            ` width="${width}" height="${height}" style="width:${width}px;max-width:100%;height:auto" />`);
    });
}
