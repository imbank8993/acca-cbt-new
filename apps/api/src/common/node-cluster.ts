import type { Cluster } from 'node:cluster';

/**
 * Modul `cluster` milik Node. Sengaja tidak memakai `import cluster from`:
 * proyek ini tidak menyalakan `esModuleInterop`, sehingga impor default lolos
 * typecheck tetapi bernilai `undefined` saat dijalankan.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const cluster: Cluster = require('node:cluster');
