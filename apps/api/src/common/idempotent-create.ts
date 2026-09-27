import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DbService, DbSession } from '../prisma/prisma-db-adapter';

const UNIQUE_VIOLATION = '23505';

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

function payloadHash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

interface IdempotentInsertOptions {
    table: string;
    organizationId?: string;
    /** Lingkup kunci untuk tabel anak yang tidak memiliki organization_id. */
    scope?: { column: string; value: string };
    clientRequestId: string;
    payload: Record<string, unknown>;
    fingerprint: unknown;
    select?: string;
    mapError?: (error: { code?: string; message: string }) => Error;
}

/**
 * Membuat satu baris dengan jaminan retry-safe.
 *
 * Pemeriksaan awal mempercepat retry biasa. Indeks unik di database menutup
 * race ketika dua permintaan dengan kunci yang sama tiba bersamaan. Hash
 * mencegah satu kunci dipakai ulang untuk isi yang berbeda.
 */
type InsertDb = Pick<DbService, 'from'> | DbSession;

export async function insertIdempotently<T extends { id: string }>(
    db: InsertDb,
    options: IdempotentInsertOptions,
): Promise<T> {
    return (await insertIdempotentlyWithStatus<T>(db, options)).data;
}

export async function insertIdempotentlyWithStatus<T extends { id: string }>(
    db: InsertDb,
    options: IdempotentInsertOptions,
): Promise<{ data: T; replayed: boolean }> {
    const hash = payloadHash(options.fingerprint);
    const scope = options.scope || {
        column: 'organization_id',
        value: options.organizationId || '',
    };
    if (!scope.value) throw new Error('Lingkup idempotensi wajib diisi.');

    const findExisting = async (): Promise<T | null> => {
        const { data, error } = await db
            .from(options.table)
            .select(`${options.select || '*'}, client_request_hash`)
            .eq(scope.column, scope.value)
            .eq('client_request_id', options.clientRequestId)
            .maybeSingle();

        if (error) throw new BadRequestException(error.message);
        if (!data) return null;

        const row = data as T & { client_request_hash?: string | null };
        if (row.client_request_hash !== hash) {
            throw new ConflictException(
                'Permintaan pembuatan yang sama digunakan untuk data yang berbeda. Muat ulang halaman lalu coba lagi.',
            );
        }
        return row;
    };

    const existing = await findExisting();
    if (existing) return { data: existing, replayed: true };

    const { data, error } = await db
        .from(options.table)
        .insert({
            ...options.payload,
            client_request_id: options.clientRequestId,
            client_request_hash: hash,
        })
        .select(options.select || '*')
        .single();

    if (!error) return { data: data as T, replayed: false };

    // Permintaan paralel yang kalah race akan melihat baris pemenang.
    if (error.code === UNIQUE_VIOLATION) {
        const raced = await findExisting();
        if (raced) return { data: raced, replayed: true };
    }

    throw options.mapError?.(error) || new BadRequestException(error.message);
}

/** Turunkan UUID v4 stabil untuk satu baris di dalam request batch. */
export function deriveRequestUuid(requestId: string, index: number): string {
    const bytes = createHash('sha256').update(`${requestId}:${index}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
