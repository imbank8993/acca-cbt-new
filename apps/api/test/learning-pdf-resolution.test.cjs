const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { pdfRenderSize } = require('../../web/lib/pdf-render-size.ts');
for (const ratio of [1, 1.5, 2, 3]) {
    test(`PDF backing resolution matches display width at DPR ${ratio}`, () => {
        const result = pdfRenderSize(595, 842, 1200, ratio);
        assert.ok(Math.abs(result.width - 1200 * ratio) <= 1);
        assert.ok(Math.abs(result.width / result.height - 595 / 842) < 0.002);
    });
}
test('PDF rerender grows with the available width after closing sidebar', () => {
    assert.ok(pdfRenderSize(595, 842, 1800, 2).width > pdfRenderSize(595, 842, 1200, 2).width);
});
test('large PDF rendering stays within the resource limit', () => {
    const size = pdfRenderSize(595, 842, 10000, 4);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width * size.height < 24_020_000);
});
