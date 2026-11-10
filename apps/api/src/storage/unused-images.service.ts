import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../prisma/prisma-db-adapter';
import { StorageService } from './storage.service';

/**
 * Pembersihan gambar soal yang tidak lagi dipakai.
 *
 * Menghapus bank soal atau soal tidak menghapus berkas gambarnya, karena satu
 * berkas bisa dipakai banyak tempat (bank hasil salin/impor ulang, salinan soal
 * ujian, materi). Layanan ini mencari gambar yang benar-benar yatim:
 *
 *  1. Hanya berkas gambar dari folder gambar soal yang dipertimbangkan:
 *     `users/<id>/questions/…`, `users/<id>/banks/…` (sampul bank), dan
 *     `banks/<id>/equations/…` (SVG persamaan). Avatar, logo, lampiran jawaban,
 *     bukti ujian, audio, dokumen, dan folder lama tanpa pemilik tidak disentuh.
 *  2. Nama berkasnya dicari di SELURUH kolom teks/JSON di semua tabel database.
 *     Satu kemunculan di mana pun sudah cukup untuk mempertahankannya.
 *  3. Berkas yang lebih muda dari `minAgeDays` dibiarkan: bisa jadi baru diunggah
 *     ke soal yang belum disimpan.
 *  4. Bila pemindaian database gagal di satu tabel saja, seluruh proses berhenti —
 *     tidak ada penghapusan berdasarkan data yang tidak lengkap.
 *
 * Penghapusan selalu memindai ulang dan hanya menghapus kunci yang masih yatim.
 */

export const DEFAULT_MIN_AGE_DAYS = 30;
export const MIN_ALLOWED_AGE_DAYS = 7;
export const MAX_CLEANUP_KEYS = 5000;
const IMAGE_EXTENSIONS = 'png|jpe?g|gif|webp|bmp|svg';
const QUESTION_IMAGE_KEY = new RegExp(
    `^(?:users/[^/]+/(?:questions|banks)(?:/[^/]+)*|banks/[^/]+/equations)/([^/]+\\.(?:${IMAGE_EXTENSIONS}))$`, 'i');
/** Nama berkas yang dapat muncul di URL (termasuk karakter yang di-encode). */
const FILE_NAME_IN_TEXT = `([A-Za-z0-9._%~+-]+\\.(?:${IMAGE_EXTENSIONS}))`;
const TEXT_TYPES = ['text', 'varchar', 'bpchar', 'json', 'jsonb', '_text', '_varchar', '_bpchar', '_json', '_jsonb'];

export interface StoredObject { key: string; size: number; lastModified: Date | null }
export interface UnusedImageAnalysis {
    scannedObjects: number;
    imageObjects: number;
    referencedCount: number;
    recentCount: number;
    unused: StoredObject[];
    listingTruncated: boolean;
    scannedTables: number;
}

/** Nama berkas (huruf kecil) bila kunci ini termasuk gambar soal; selain itu null. */
export function questionImageName(key: string): string | null {
    const match = QUESTION_IMAGE_KEY.exec(key || '');
    return match ? match[1].toLowerCase() : null;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** SQL yang mengambil semua nama berkas gambar dari kolom teks satu tabel. */
export function referencedNamesSql(schema: string, table: string, columns: string[]): string {
    const text = `concat_ws(' ', ${columns.map(column => `src.${ident(column)}::text`).join(', ')})`;
    return `SELECT DISTINCT lower(m[1]) AS name FROM ${ident(schema)}.${ident(table)} AS src, ` +
        `LATERAL regexp_matches(${text}, '${FILE_NAME_IN_TEXT}', 'gi') AS m ` +
        `WHERE ${text} ~* '\\.(?:${IMAGE_EXTENSIONS})'`;
}

function addName(names: Set<string>, raw: string) {
    const name = raw.toLowerCase();
    names.add(name);
    try { names.add(decodeURIComponent(name).toLowerCase()); } catch { /* biarkan bentuk mentah */ }
}

@Injectable()
export class UnusedImagesService {
    private readonly logger = new Logger(UnusedImagesService.name);
    private running = false;

    constructor(private readonly db: DbService, private readonly storage: StorageService) {}

    /** Nama berkas gambar yang muncul di kolom teks/JSON mana pun di database. */
    async referencedFileNames(): Promise<{ names: Set<string>; tables: number }> {
        const columns = await this.db.raw<Array<{ table_schema: string; table_name: string; column_name: string }>>(
            `SELECT c.table_schema, c.table_name, c.column_name
               FROM information_schema.columns c
               JOIN information_schema.tables t
                 ON t.table_schema = c.table_schema AND t.table_name = c.table_name
              WHERE t.table_type = 'BASE TABLE'
                AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
                AND c.table_schema NOT LIKE 'pg\\_%'
                AND c.udt_name = ANY($1::text[])
              ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
            TEXT_TYPES,
        );
        const tables = new Map<string, { schema: string; table: string; columns: string[] }>();
        for (const row of columns || []) {
            const id = `${row.table_schema}.${row.table_name}`;
            if (!tables.has(id)) tables.set(id, { schema: row.table_schema, table: row.table_name, columns: [] });
            tables.get(id)!.columns.push(row.column_name);
        }
        if (tables.size === 0) throw new ServiceUnavailableException('Struktur database tidak terbaca; pembersihan dibatalkan.');

        const names = new Set<string>();
        for (const { schema, table, columns: tableColumns } of tables.values()) {
            try {
                const rows = await this.db.raw<Array<{ name: string }>>(referencedNamesSql(schema, table, tableColumns));
                for (const row of rows || []) if (row?.name) addName(names, row.name);
            } catch (error) {
                this.logger.error(`Pemindaian ${schema}.${table} gagal: ${(error as Error).message}`);
                throw new ServiceUnavailableException(
                    `Tabel ${schema}.${table} gagal diperiksa, jadi pembersihan dibatalkan agar tidak ada gambar terpakai yang terhapus.`);
            }
        }
        return { names, tables: tables.size };
    }

    async analyze(minAgeDays = DEFAULT_MIN_AGE_DAYS, now = new Date()): Promise<UnusedImageAnalysis> {
        if (!this.storage.isConfigured()) throw new ServiceUnavailableException('Penyimpanan belum dikonfigurasi.');
        // Daftar berkas diambil LEBIH DULU, baru database dipindai: berkas yang
        // dipakai selama proses berlangsung pasti sudah terlihat dipakai.
        const listings = await Promise.all(['users/', 'banks/'].map(prefix => this.storage.listObjects(prefix)));
        const objects = listings.flatMap(listing => listing.objects);
        const { names, tables } = await this.referencedFileNames();
        const cutoff = now.getTime() - minAgeDays * 86_400_000;

        let imageObjects = 0;
        let referencedCount = 0;
        let recentCount = 0;
        const unused: StoredObject[] = [];
        for (const object of objects) {
            const name = questionImageName(object.key);
            if (!name) continue;
            imageObjects++;
            if (names.has(name)) referencedCount++;
            else if (!object.lastModified || object.lastModified.getTime() > cutoff) recentCount++;
            else unused.push(object);
        }
        unused.sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
        return {
            scannedObjects: objects.length,
            imageObjects,
            referencedCount,
            recentCount,
            unused,
            listingTruncated: listings.some(listing => listing.truncated),
            scannedTables: tables,
        };
    }

    private async exclusive<T>(work: () => Promise<T>): Promise<T> {
        if (this.running) throw new ConflictException('Pemindaian gambar sedang berjalan. Tunggu hingga selesai.');
        this.running = true;
        try {
            return await work();
        } finally {
            this.running = false;
        }
    }

    preview(minAgeDays?: number) {
        const age = normalizeAge(minAgeDays);
        return this.exclusive(async () => {
            const analysis = await this.analyze(age);
            return {
                minAgeDays: age,
                scannedObjects: analysis.scannedObjects,
                imageObjects: analysis.imageObjects,
                referencedCount: analysis.referencedCount,
                recentCount: analysis.recentCount,
                scannedTables: analysis.scannedTables,
                unusedCount: analysis.unused.length,
                unusedBytes: analysis.unused.reduce((sum, object) => sum + object.size, 0),
                listingTruncated: analysis.listingTruncated,
                truncated: analysis.unused.length > MAX_CLEANUP_KEYS,
                items: analysis.unused.slice(0, MAX_CLEANUP_KEYS).map(object => ({
                    key: object.key,
                    size: object.size,
                    lastModified: object.lastModified?.toISOString() ?? null,
                })),
            };
        });
    }

    cleanup(actorId: string, keys: unknown, minAgeDays?: number) {
        const age = normalizeAge(minAgeDays);
        if (!Array.isArray(keys) || keys.length === 0) throw new BadRequestException('Tidak ada gambar yang dipilih.');
        if (keys.length > MAX_CLEANUP_KEYS) throw new BadRequestException(`Maksimal ${MAX_CLEANUP_KEYS} gambar per pembersihan.`);
        const requested = [...new Set(keys.filter((key): key is string => typeof key === 'string' && questionImageName(key) !== null))];
        return this.exclusive(async () => {
            // Pindai ulang: hanya kunci yang SAAT INI masih yatim yang dihapus.
            const analysis = await this.analyze(age);
            const stillUnused = new Map(analysis.unused.map(object => [object.key, object]));
            const targets = requested.filter(key => stillUnused.has(key));
            const result = await this.storage.deleteObjects(targets);
            const deleted = new Set(result.deleted);
            const freedBytes = targets.filter(key => deleted.has(key)).reduce((sum, key) => sum + stillUnused.get(key)!.size, 0);
            this.logger.log(`Pembersihan gambar oleh ${actorId}: ${result.deleted.length} dihapus, ` +
                `${keys.length - targets.length} dilewati, ${result.failed.length} gagal, ${freedBytes} byte.`);
            return {
                requested: keys.length,
                deleted: result.deleted.length,
                skipped: keys.length - targets.length,
                failed: result.failed.length,
                failedKeys: result.failed.slice(0, 50),
                freedBytes,
            };
        });
    }
}

export function normalizeAge(value: unknown): number {
    if (value === undefined || value === null || value === '') return DEFAULT_MIN_AGE_DAYS;
    const age = Math.floor(Number(value));
    if (!Number.isFinite(age) || age < MIN_ALLOWED_AGE_DAYS) {
        throw new BadRequestException(`Umur minimum gambar paling sedikit ${MIN_ALLOWED_AGE_DAYS} hari.`);
    }
    return Math.min(age, 3650);
}
