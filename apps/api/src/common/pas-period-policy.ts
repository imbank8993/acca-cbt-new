import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DbSession } from '../prisma/prisma-db-adapter';
import { advisoryTransactionLock } from './transaction-lock';

export async function writablePasPeriod(db: DbSession, periodId: string) {
    await advisoryTransactionLock(db, `pas-period:${periodId}`);
    const { data, error } = await db.from('cbt_pas_periods').select('*').eq('id', periodId).maybeSingle();
    if (error) throw new BadRequestException('Periode ujian belum dapat diperiksa.');
    if (!data) throw new NotFoundException('Periode ujian tidak ditemukan.');
    if (data.is_locked) throw new ConflictException('Periode sudah dikunci. Buka kunci sebelum mengubah data.');
    return data as Record<string, any>;
}

export function pasDate(value: unknown): string {
    const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
        throw new BadRequestException('Tanggal harus berupa tanggal kalender YYYY-MM-DD yang valid.');
    }
    return date;
}

export function pasDateRange(start: unknown, end: unknown) {
    const first = pasDate(start), last = pasDate(end);
    if (first > last) throw new BadRequestException('Tanggal mulai harus sebelum atau sama dengan tanggal selesai.');
    return { start: first, end: last };
}

/** SQL DATE values are serialized as UTC midnight by the database adapter. */
export function storedPasDate(value: unknown): string {
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value)
        ? value.slice(0, 10) : value;
    return pasDate(date);
}
