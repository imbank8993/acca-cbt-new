/** Match backing pixels to display pixels, with bounded memory for very large pages. */
export function pdfRenderSize(pageWidth: number, pageHeight: number, displayWidth: number, pixelRatio: number) {
    const cssScale = Math.max(1, displayWidth) / pageWidth;
    const desired = cssScale * Math.max(1, pixelRatio || 1);
    const scale = Math.min(desired, 8192 / Math.max(pageWidth, pageHeight),
        Math.sqrt(24_000_000 / (pageWidth * pageHeight)));
    return { scale, width: Math.ceil(pageWidth * scale), height: Math.ceil(pageHeight * scale) };
}
