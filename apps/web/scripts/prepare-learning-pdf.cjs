// Keep the static worker identical to the PDF.js version actually installed by the lockfile.
const fs = require('node:fs');
const path = require('node:path');
const webDir = path.resolve(__dirname, '..');
const target = path.join(webDir, 'public/pdfjs/lms.worker.min.mjs');

try {
    const source = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs', { paths: [webDir, path.resolve(webDir, '../..')] });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    console.log('LMS PDF worker ready.');
} catch (err) {
    if (fs.existsSync(target)) {
        console.log('LMS PDF worker already exists, continuing...');
    } else {
        console.warn('Warning: Could not prepare LMS PDF worker:', err.message);
    }
}
