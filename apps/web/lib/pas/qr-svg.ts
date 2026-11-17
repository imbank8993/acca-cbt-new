/**
 * Generator QR Code ISO/IEC 18004 (Byte Mode, Error Correction Level H)
 * tanpa ketergantungan paket eksternal maupun layanan internet pihak ketiga.
 *
 * Level H memulihkan hingga ~30% codeword, sehingga logo ACCA di tengah QR
 * (menutup ~6% modul) tetap terbaca. Versi dipilih otomatis (1–40) sesuai
 * panjang URL; URL tidak pernah dipotong.
 */

// Tabel ISO/IEC 18004 untuk level H, indeks = versi (1–40).
const ECC_CODEWORDS_PER_BLOCK_H = [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
const NUM_ERROR_CORRECTION_BLOCKS_H = [-1, 1, 2, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81];
/** Bit format untuk level H. */
const FORMAT_BITS_H = 2;
/** Mask tetap: semua mask sah menurut standar; logo sudah ditangani oleh level H. */
const MASK = 0;

function gfMul(x: number, y: number): number {
    let r = 0;
    let a = x;
    let b = y;
    for (let i = 0; i < 8; i++) {
        if (b & 1) r ^= a;
        const hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x11d;
        b >>= 1;
    }
    return r;
}

function reedSolomonGenerator(degree: number): number[] {
    let poly = [1];
    let root = 1;
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], root);
        }
        poly = next;
        root = gfMul(root, 0x02);
    }
    return poly;
}

function reedSolomonRemainder(data: number[], ecCount: number): number[] {
    const gen = reedSolomonGenerator(ecCount);
    const rem = new Array(ecCount).fill(0);
    for (const byte of data) {
        const factor = byte ^ rem[0];
        rem.shift();
        rem.push(0);
        for (let i = 0; i < ecCount; i++) {
            rem[i] ^= gfMul(gen[i + 1], factor);
        }
    }
    return rem;
}

/** Jumlah modul data (termasuk sisa) untuk satu versi. */
function rawDataModules(version: number): number {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const numAlign = Math.floor(version / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (version >= 7) result -= 36;
    }
    return result;
}

function dataCodewords(version: number): number {
    return Math.floor(rawDataModules(version) / 8)
        - ECC_CODEWORDS_PER_BLOCK_H[version] * NUM_ERROR_CORRECTION_BLOCKS_H[version];
}

function alignmentPositions(version: number): number[] {
    if (version === 1) return [];
    const size = version * 4 + 17;
    const numAlign = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
}

/** Data dibagi ke beberapa blok, tiap blok diberi koreksi galat, lalu disisipkan berselang. */
function addEccAndInterleave(data: number[], version: number): number[] {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_H[version];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK_H[version];
    const rawCodewords = Math.floor(rawDataModules(version) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks: number[][] = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
        k += dat.length;
        const ecc = reedSolomonRemainder(dat, blockEccLen);
        if (i < numShortBlocks) dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const result: number[] = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => {
            if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
        });
    }
    return result;
}

export function generateQrMatrix(text: string): boolean[][] {
    const bytes = Array.from(new TextEncoder().encode(text));
    let version = 1;
    for (; version <= 40; version++) {
        const countBits = version <= 9 ? 8 : 16;
        if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
    }
    if (version > 40) throw new Error('Teks terlalu panjang untuk QR code.');

    const capacityBits = dataCodewords(version) * 8;
    const bits: number[] = [];
    const pushBits = (val: number, len: number) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) pushBits(b, 8);
    pushBits(0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const data: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
        data.push(byte);
    }
    for (let pad = 0xec; data.length < capacityBits / 8; pad ^= 0xec ^ 0x11) data.push(pad);
    const codewords = addEccAndInterleave(data, version);

    const size = version * 4 + 17;
    const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
    // Koordinat (x = kolom, y = baris).
    const setFunction = (x: number, y: number, dark: boolean) => {
        modules[y][x] = dark;
        isFunction[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
        setFunction(6, i, i % 2 === 0);
        setFunction(i, 6, i % 2 === 0);
    }
    const drawFinder = (cx: number, cy: number) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || x >= size || y < 0 || y >= size) continue;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                setFunction(x, y, dist !== 2 && dist !== 4);
            }
        }
    };
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    const align = alignmentPositions(version);
    const last = align.length - 1;
    align.forEach((ax, i) => align.forEach((ay, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) setFunction(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }));

    const drawFormat = (mask: number) => {
        const value = (FORMAT_BITS_H << 3) | mask;
        let rem = value;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const formatBits = ((value << 10) | rem) ^ 0x5412;
        const bit = (i: number) => ((formatBits >>> i) & 1) !== 0;
        for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i));
        setFunction(8, 7, bit(6));
        setFunction(8, 8, bit(7));
        setFunction(7, 8, bit(8));
        for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i));
        setFunction(8, size - 8, true);
    };
    drawFormat(MASK);

    if (version >= 7) {
        let rem = version;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const versionBits = (version << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const dark = ((versionBits >>> i) & 1) !== 0;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            setFunction(a, b, dark);
            setFunction(b, a, dark);
        }
    }

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (isFunction[y][x]) continue;
                let dark = false;
                if (bitIndex < codewords.length * 8) {
                    dark = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
                    bitIndex++;
                }
                if ((x + y) % 2 === 0) dark = !dark; // Mask 0
                modules[y][x] = dark;
            }
        }
    }
    return modules;
}

// ── Logo ACCA di tengah QR ─────────────────────────────────────────────────
// Bentuk dari public/icon.svg (logo ACCA terbaru), warna biru utama aplikasi.
export const QR_LOGO_COLOR = '#3083FF';
export const QR_LOGO_VIEWBOX = { x: -3, y: -3, width: 212, height: 244 };
export const QR_LOGO_PATHS = [
    'M196.19 76.92c-27.11,-13.63 -58.96,-21.47 -93.14,-21.47 -34.19,0 -66.03,7.83 -93.14,21.47 -2.18,1.1 -4.58,0.99 -6.66,-0.29 -2.08,-1.28 -3.25,-3.38 -3.25,-5.82l0 -44.22c0,-2.78 1.56,-5.16 4.1,-6.27 29.83,-13 63.45,-20.33 98.95,-20.33 35.49,0 69.12,7.33 98.95,20.33 2.55,1.11 4.1,3.49 4.1,6.27l0 44.22c0,2.44 -1.17,4.54 -3.25,5.82 -2.08,1.28 -4.48,1.38 -6.66,0.29z',
    'M206.1 186.58l-0.3 -0.17 0 44.84c0,2.44 -1.17,4.54 -3.25,5.82 -2.08,1.28 -4.48,1.38 -6.66,0.28 -14.63,-7.39 -30.26,-13.08 -46.63,-16.82 -3.14,-0.72 -5.31,-3.44 -5.31,-6.66l0 -44.54c0,-3.38 -2.4,-6.2 -5.73,-6.75 -11.36,-1.86 -23.11,-2.83 -35.16,-2.83 -12.05,0 -23.8,0.97 -35.16,2.83 -3.33,0.55 -5.73,3.37 -5.73,6.75l0 44.54c0,3.23 -2.17,5.94 -5.31,6.66 -16.37,3.75 -32,9.44 -46.63,16.82 -2.18,1.1 -4.58,1 -6.66,-0.28 -2.08,-1.28 -3.25,-3.38 -3.25,-5.82l0 -44.84 -0.3 0.17 0 -55.69c0,-2.78 1.56,-5.16 4.1,-6.27 29.83,-13 63.45,-20.33 98.95,-20.33 35.49,0 69.12,7.33 98.95,20.33 2.55,1.11 4.1,3.49 4.1,6.27l0 55.69z',
];
/** Sisi kotak logo terhadap lebar QR. 0,24² ≈ 6% modul — jauh di bawah batas pemulihan level H. */
const LOGO_FRACTION = 0.24;

/** Kotak putih logo (dalam satuan modul, tanpa margin), selalu di tengah QR. */
export function qrLogoBox(size: number): { start: number; span: number } {
    let span = Math.round(size * LOGO_FRACTION);
    if (span % 2 !== size % 2) span -= 1; // simetris tepat di tengah; dibulatkan ke bawah agar lebih aman dipindai
    return { start: (size - span) / 2, span };
}

/** Logo diletakkan di dalam kotak putih dengan jarak 1 modul, rasio bentuk dipertahankan. */
function logoPlacement(box: { start: number; span: number }, margin: number) {
    const inner = box.span - 2;
    const scale = inner / Math.max(QR_LOGO_VIEWBOX.width, QR_LOGO_VIEWBOX.height);
    const width = QR_LOGO_VIEWBOX.width * scale;
    const height = QR_LOGO_VIEWBOX.height * scale;
    const left = margin + box.start + (box.span - width) / 2;
    const top = margin + box.start + (box.span - height) / 2;
    return { left, top, width, height, scale };
}

export function generateQrSvgDataUrl(text: string, margin = 2): string {
    const matrix = generateQrMatrix(text);
    const n = matrix.length;
    const viewSize = n + margin * 2;
    const box = qrLogoBox(n);
    const rects: string[] = [];

    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (matrix[r][c]) {
                rects.push(`<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="#0f172a"/>`);
            }
        }
    }

    const logo = logoPlacement(box, margin);
    const vb = QR_LOGO_VIEWBOX;
    const logoSvg = `<rect x="${box.start + margin}" y="${box.start + margin}" width="${box.span}" height="${box.span}" rx="0.8" fill="#ffffff"/>`
        + `<svg x="${logo.left}" y="${logo.top}" width="${logo.width}" height="${logo.height}" viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}" shape-rendering="geometricPrecision">`
        + QR_LOGO_PATHS.map(d => `<path fill="${QR_LOGO_COLOR}" fill-rule="evenodd" d="${d}"/>`).join('')
        + '</svg>';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/>${rects.join('')}${logoSvg}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** QR + logo sebagai PNG (untuk PDF). Hanya di browser. */
export function renderQrPngDataUrl(text: string, pixelSize = 240, margin = 2): string {
    const matrix = generateQrMatrix(text);
    const size = matrix.length;
    const totalModules = size + margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixelSize, pixelSize);
    ctx.fillStyle = '#0f172a';
    const scale = pixelSize / totalModules;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (matrix[r][c]) {
                ctx.fillRect(Math.floor((c + margin) * scale), Math.floor((r + margin) * scale), Math.ceil(scale), Math.ceil(scale));
            }
        }
    }
    const box = qrLogoBox(size);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.floor((box.start + margin) * scale), Math.floor((box.start + margin) * scale), Math.ceil(box.span * scale), Math.ceil(box.span * scale));
    const logo = logoPlacement(box, margin);
    ctx.save();
    ctx.translate(logo.left * scale, logo.top * scale);
    ctx.scale(logo.scale * scale, logo.scale * scale);
    ctx.translate(-QR_LOGO_VIEWBOX.x, -QR_LOGO_VIEWBOX.y);
    ctx.fillStyle = QR_LOGO_COLOR;
    for (const d of QR_LOGO_PATHS) ctx.fill(new Path2D(d), 'evenodd');
    ctx.restore();
    return canvas.toDataURL('image/png');
}
