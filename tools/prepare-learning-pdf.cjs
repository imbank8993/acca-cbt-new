// Keep the static worker identical to the PDF.js version actually installed by the lockfile.
try {
    require('../apps/web/scripts/prepare-learning-pdf.cjs');
} catch {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(__dirname, '..');
    const target = path.join(root, 'apps/web/public/pdfjs/lms.worker.min.mjs');
    try {
        const source = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs', { paths: [path.join(root, 'apps/web'), root] });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        console.log('LMS PDF worker ready.');
    } catch (err) {
        if (!fs.existsSync(target)) {
            console.warn('Warning: Could not prepare LMS PDF worker:', err.message);
        }
    }
}
