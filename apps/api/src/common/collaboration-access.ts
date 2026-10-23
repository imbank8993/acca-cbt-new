import { ServiceUnavailableException } from '@nestjs/common';
import type { DbService } from '../prisma/prisma-db-adapter';

export type CollaborativeResource = 'bank' | 'exam';
export interface CollaborationGrant {
    user_id: string;
    permission: 'viewer' | 'editor' | 'manager';
    can_reset?: boolean;
    expires_at?: string | null;
    revoked_at?: string | null;
    [key: string]: unknown;
}
export const collaborationTable = (type: CollaborativeResource) => type === 'bank' ? 'cbt_bank_collaborators' : 'cbt_exam_collaborators';
export const collaborationKey = (type: CollaborativeResource) => type === 'bank' ? 'bank_id' : 'exam_id';
export function activeCollaboration(grant: CollaborationGrant, now = Date.now()): boolean {
    return !grant.revoked_at && ['viewer', 'editor', 'manager'].includes(grant.permission) &&
        (!grant.expires_at || Date.parse(grant.expires_at) > now);
}
/** Never cache authorization: a revoked or expired grant must stop the next request. */
export async function collaborationGrant(db: Pick<DbService, 'from'>, type: CollaborativeResource, resourceId: string, userId: string): Promise<CollaborationGrant | null> {
    const { data, error } = await db.from(collaborationTable(type)).select('*')
        .eq(collaborationKey(type), resourceId).eq('user_id', userId).maybeSingle();
    if (error) throw new ServiceUnavailableException('Izin kolaborator belum dapat diperiksa.');
    return data && activeCollaboration(data) ? data : null;
}
/** All active grants of one user, keyed by resource ID: one query for a whole list page. */
export async function collaborationGrants(db: Pick<DbService, 'from'>, type: CollaborativeResource, userId: string): Promise<Map<string, CollaborationGrant>> {
    const { data, error } = await db.from(collaborationTable(type)).select('*').eq('user_id', userId);
    if (error) throw new ServiceUnavailableException('Daftar kolaborasi belum dapat diperiksa.');
    return new Map((data || []).filter((row: CollaborationGrant) => activeCollaboration(row))
        .map((row: CollaborationGrant) => [String(row[collaborationKey(type)]), row]));
}
export async function collaborativeIds(db: Pick<DbService, 'from'>, type: CollaborativeResource, userId: string): Promise<string[]> {
    return [...(await collaborationGrants(db, type, userId)).keys()];
}

/** Counts only; load a whole authorized resource list without exposing collaborator identities. */
export async function collaboratorCounts(db: Pick<DbService, 'from'>, type: CollaborativeResource, resourceIds: string[]): Promise<Map<string, number>> {
    const ids = [...new Set(resourceIds)];
    const counts = new Map<string, number>();
    const key = collaborationKey(type);
    const now = Date.now();
    for (let offset = 0; offset < ids.length; offset += 500) {
        const { data, error } = await db.from(collaborationTable(type))
            .select(`${key}, user_id, permission, expires_at, revoked_at`).in(key, ids.slice(offset, offset + 500));
        if (error) throw new ServiceUnavailableException('Jumlah kolaborator belum dapat diperiksa.');
        for (const grant of (data || []) as CollaborationGrant[]) {
            if (!activeCollaboration(grant, now)) continue;
            const id = String(grant[key]);
            counts.set(id, (counts.get(id) || 0) + 1);
        }
    }
    return counts;
}
