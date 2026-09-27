import { ServiceUnavailableException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';

export interface OperationalSubject {
    id: string;
    organization_id: string;
    master_mapel_id: string;
    name: string;
    code: string | null;
    color: string;
    kelompok: string | null;
    aktif: boolean;
}

const SUBJECT_COLORS = [
    '#4f46e5', '#0284c7', '#0891b2', '#059669', '#65a30d',
    '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea',
];

function colorFor(masterId: string): string {
    if (/^-?\d+$/.test(masterId)) {
        const numeric = BigInt(masterId);
        const positive = numeric < 0n ? -numeric : numeric;
        return SUBJECT_COLORS[Number(positive % BigInt(SUBJECT_COLORS.length))];
    }
    let hash = 0;
    for (const char of masterId) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

/**
 * Sinkronkan master_mapel ke katalog UUID yang direferensikan tabel CBT.
 * Master tetap menjadi sumber nama/status; UUID operasional dipertahankan oleh
 * unique key (organization_id, master_mapel_id).
 */
export async function listOperationalSubjects(
    db: DbService,
    organizationId: string,
): Promise<OperationalSubject[]> {
    const { data: masterData, error: masterError } = await db
        .from('master_mapel')
        .select('id, kode, nama, kelompok, aktif')
        .order('nama', { ascending: true });
    if (masterError) {
        throw new ServiceUnavailableException(
            `Katalog mata pelajaran belum dapat dibaca: ${masterError.message}`,
        );
    }

    const masterRows = (masterData as Array<{
        id: string | number;
        kode: string | null;
        nama: string;
        kelompok: string | null;
        aktif: boolean | null;
    }>) || [];
    if (masterRows.length === 0) return [];

    const payload = masterRows.map((subject) => {
        const masterId = String(subject.id);
        return {
            organization_id: organizationId,
            master_mapel_id: masterId,
            name: subject.nama,
            code: subject.kode || null,
            color: colorFor(masterId),
            is_active: subject.aktif !== false,
        };
    });
    const { data: synced, error: syncError } = await db
        .from('cbt_subjects')
        .upsert(payload, { onConflict: 'organization_id,master_mapel_id' })
        .select('id, organization_id, master_mapel_id, name, code, color, is_active');
    if (syncError) {
        throw new ServiceUnavailableException(
            `Katalog mata pelajaran belum dapat diselaraskan: ${syncError.message}`,
        );
    }

    const byMasterId = new Map(
        ((synced as Array<{
            id: string;
            organization_id: string;
            master_mapel_id: string | number;
            name: string;
            code: string | null;
            color: string | null;
            is_active: boolean;
        }>) || []).map((row) => [String(row.master_mapel_id), row]),
    );

    return masterRows
        .filter((subject) => subject.aktif !== false)
        .map((subject) => {
            const masterId = String(subject.id);
            const row = byMasterId.get(masterId);
            if (!row?.id) {
                throw new ServiceUnavailableException(
                    `Mata pelajaran ${masterId} gagal memperoleh identitas operasional.`,
                );
            }
            return {
                id: row.id,
                organization_id: organizationId,
                master_mapel_id: masterId,
                name: subject.nama,
                code: subject.kode || null,
                color: row.color || colorFor(masterId),
                kelompok: subject.kelompok || null,
                aktif: true,
            };
        });
}
