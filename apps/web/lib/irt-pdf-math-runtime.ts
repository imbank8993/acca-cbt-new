import { version } from 'mathjax-full/package.json';

// MathJax's browser modules expect the package version supplied by its build.
// Set it before loading them to avoid their fallback to Node's require/path.
const runtime = globalThis as typeof globalThis & { PACKAGE_VERSION?: string };
runtime.PACKAGE_VERSION ??= version;
