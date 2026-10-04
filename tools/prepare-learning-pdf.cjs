// Keep the static worker identical to the PDF.js version actually installed by the lockfile.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'apps/web/public/pdfjs/lms.worker.min.mjs');
const source = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs', { paths: [path.join(root, 'apps/web')] });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log('LMS PDF worker ready.');
