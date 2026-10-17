/**
 * Generator QR Code ISO/IEC 18004 (Byte Mode, Error Correction Level L, Mask 0)
 * tanpa ketergantungan paket eksternal maupun layanan internet pihak ketiga.
 * Mendukung hingga 106 byte (Version 4-L / Version 5-L) untuk URL verifikasi dokumen.
 */

interface QrSpec {
    version: number;
    size: number;
    dataCodewords: number;
    ecCodewords: number;
    alignment: number[];
}

const SPECS: QrSpec[] = [
    { version: 2, size: 25, dataCodewords: 34, ecCodewords: 10, alignment: [6, 18] },
    { version: 3, size: 29, dataCodewords: 55, ecCodewords: 15, alignment: [6, 22] },
    { version: 4, size: 33, dataCodewords: 80, ecCodewords: 20, alignment: [6, 26] },
    { version: 5, size: 37, dataCodewords: 108, ecCodewords: 26, alignment: [6, 30] },
    { version: 6, size: 41, dataCodewords: 68, ecCodewords: 18, alignment: [6, 34] }, // 2 blocks if needed, fallback to v5
];

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

export function generateQrMatrix(text: string): boolean[][] {
    const utf8 = Array.from(new TextEncoder().encode(text)).slice(0, 106);
    const spec =
        SPECS.find((s) => s.version <= 5 && utf8.length + 2 <= s.dataCodewords) || SPECS[3];

    const bits: number[] = [];
    const pushBits = (val: number, len: number) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    // Byte mode indicator (0100) + 8-bit length
    pushBits(0b0100, 4);
    pushBits(utf8.length, 8);
    for (const b of utf8) pushBits(b, 8);

    const maxBits = spec.dataCodewords * 8;
    pushBits(0, Math.min(4, maxBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const dataBytes: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
        dataBytes.push(byte);
    }

    const pads = [0xec, 0x11];
    let padIdx = 0;
    while (dataBytes.length < spec.dataCodewords) {
        dataBytes.push(pads[padIdx % 2]);
        padIdx++;
    }

    const ecBytes = reedSolomonRemainder(dataBytes, spec.ecCodewords);
    const allCodewords = [...dataBytes, ...ecBytes];

    const size = spec.size;
    const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

    const setFunctionModule = (r: number, c: number, dark: boolean) => {
        if (r < 0 || r >= size || c < 0 || c >= size) return;
        modules[r][c] = dark;
        isFunction[r][c] = true;
    };

    const drawFinder = (topR: number, leftC: number) => {
        for (let dr = -1; dr <= 7; dr++) {
            for (let dc = -1; dc <= 7; dc++) {
                const r = topR + dr;
                const c = leftC + dc;
                const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
                const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
                const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
                setFunctionModule(r, c, inOuter && (onBorder || inInner));
            }
        }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
        setFunctionModule(6, i, i % 2 === 0);
        setFunctionModule(i, 6, i % 2 === 0);
    }

    // Alignment pattern
    if (spec.alignment.length >= 2) {
        const center = spec.alignment[1];
        for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
                const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
                setFunctionModule(center + dr, center + dc, dark);
            }
        }
    }

    // Reserve format information areas + dark module
    for (let i = 0; i <= 8; i++) {
        if (!isFunction[8][i]) setFunctionModule(8, i, false);
        if (!isFunction[i][8]) setFunctionModule(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
        setFunctionModule(8, size - 1 - i, false);
        setFunctionModule(size - 1 - i, 8, false);
    }
    setFunctionModule(size - 8, 8, true);

    // Place data bits in zigzag
    let bitIndex = 0;
    const totalBits = allCodewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const c = right - j;
                const upward = ((right + 1) & 2) === 0;
                const r = upward ? size - 1 - vert : vert;
                if (!isFunction[r][c]) {
                    let dark = false;
                    if (bitIndex < totalBits) {
                        const byte = allCodewords[bitIndex >>> 3];
                        dark = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
                        bitIndex++;
                    }
                    // Mask 0: (r + c) % 2 === 0
                    if ((r + c) % 2 === 0) dark = !dark;
                    modules[r][c] = dark;
                }
            }
        }
    }

    // Format info for Level L (01) and Mask 0 (000) -> 0x77c4
    const formatBits = 0x77c4;
    const getFormatBit = (idx: number) => ((formatBits >>> idx) & 1) === 1;

    for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getFormatBit(14 - i));
    setFunctionModule(8, 7, getFormatBit(8));
    setFunctionModule(8, 8, getFormatBit(7));
    setFunctionModule(7, 8, getFormatBit(6));
    for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getFormatBit(14 - i));

    for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, getFormatBit(i));
    for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, getFormatBit(i));

    return modules;
}

export function generateQrSvgDataUrl(text: string, margin = 2): string {
    const matrix = generateQrMatrix(text);
    const n = matrix.length;
    const viewSize = n + margin * 2;
    const rects: string[] = [];

    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (matrix[r][c]) {
                rects.push(`<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="#0f172a"/>`);
            }
        }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/>${rects.join('')}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
