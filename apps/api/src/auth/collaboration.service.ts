import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';
import { AuthorizationService } from './authorization.service';
import { activeCollaboration, collaborationKey, collaborationTable, type CollaborationGrant, type CollaborativeResource } from '../common/collaboration-access';
import { advisoryTransactionLock } from '../common/transaction-lock';

@Injectable()
export class CollaborationService {
    constructor(private readonly db: DbService, private readonly authz: AuthorizationService) {}

    private async context(user: AuthUser, type: CollaborativeResource, id: string, manage = false) {
        const context = await this.authz.collaborationPermissions(user, type, id);
        if (manage && !context.canShare) throw new ForbiddenException('Hanya pembuat, Admin, atau pengelola kolaborator yang dapat mengubah akses.');
        if (!manage && !context.canShare && !context.grant) throw new ForbiddenException('Anda tidak memiliki akses kolaborasi ini.');
        return context;
    }

    async list(user: AuthUser, type: CollaborativeResource, id: string) {
        const context = await this.context(user, type, id);
        const { data, error } = await this.db.from(collaborationTable(type)).select('*').eq(collaborationKey(type), id);
        if (error) throw new ServiceUnavailableException('Daftar kolaborator belum dapat dibaca.');
        const rows = data || [];
        const activeCount = rows.filter((row: CollaborationGrant) => activeCollaboration(row)).length;
        const userIds = [...new Set([context.resource.created_by, ...rows.map((row: { user_id: string }) => row.user_id)].filter(Boolean))];
        const profiles = userIds.length ? await this.db.from('cbt_profiles').select('id, full_name').in('id', userIds) : { data: [], error: null };
        if (profiles.error) throw new ServiceUnavailableException('Nama kolaborator belum dapat dibaca.');
        const names = new Map((profiles.data || []).map((row: { id: string; full_name: string }) => [row.id, row.full_name]));
        // Pembaca/editor hanya melihat aksesnya sendiri; daftar lengkap untuk yang dapat mengatur akses.
        const visible = context.canShare ? rows : rows.filter((row: { user_id: string }) => row.user_id === user.id);
        return { canShare: context.canShare, canGrantPrivileged: context.owner || context.admin, activeCount, ownerId: context.resource.created_by,
            ownerName: names.get(context.resource.created_by) || 'Pembuat',
            collaborators: visible.map((row: { user_id: string }) => ({ ...row, name: names.get(row.user_id) || 'Tanpa nama' })) };
    }

    async candidates(user: AuthUser, type: CollaborativeResource, id: string) {
        const context = await this.context(user, type, id, true);
        const { data, error } = await this.db.from('cbt_organization_members')
            .select('user_id, profiles:cbt_profiles(full_name, identity_number), member_roles:cbt_member_roles(roles:cbt_roles(name))')
            .eq('organization_id', context.resource.organization_id).eq('is_active', true);
        if (error) throw new ServiceUnavailableException('Daftar guru belum dapat dibaca.');
        return (data || []).filter((member: any) => member.user_id !== context.resource.created_by &&
            (member.member_roles || []).some((role: any) => ['GURU', 'PROKTOR', 'ADMIN'].includes(String(role.roles?.name).toUpperCase())))
            .map((member: any) => ({ id: member.user_id, name: member.profiles?.full_name || 'Tanpa nama', nip: member.profiles?.identity_number || '' }))
            .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'id'));
    }

    async save(user: AuthUser, type: CollaborativeResource, id: string, targetId: string, input: {
        permission: 'viewer' | 'editor' | 'manager'; can_reset?: boolean; expires_at?: string | null;
    }) {
        if (type === 'bank' && input.can_reset) throw new BadRequestException('Izin reset hanya tersedia untuk ujian.');
        if (input.permission === 'viewer' && input.can_reset) throw new BadRequestException('Pembaca tidak dapat diberi izin reset.');
        const expires = input.expires_at ? Date.parse(input.expires_at) : null;
        if (expires !== null && (!Number.isFinite(expires) || expires <= Date.now())) throw new BadRequestException('Batas akses harus berupa waktu mendatang yang valid.');
        return this.db.transaction(async db => {
            await advisoryTransactionLock(db, `collaborators:${type}:${id}`);
            const context = await this.context(user, type, id, true);
            if (targetId === context.resource.created_by) throw new BadRequestException('Akses pembuat asli tidak dapat diubah melalui kolaborator.');
            const privileged = context.owner || context.admin;
            if (!privileged && input.permission === 'manager') {
                throw new ForbiddenException('Hanya pembuat atau Admin yang dapat memberikan hak pengelola atau reset.');
            }
            const candidates = await this.candidates(user, type, id);
            if (!candidates.some((candidate: { id: string }) => candidate.id === targetId)) throw new BadRequestException('Kolaborator harus merupakan Guru, Proktor, atau Admin aktif sekolah ini.');
            const table = collaborationTable(type), key = collaborationKey(type);
            const previous = await db.from(table).select('*').eq(key, id).eq('user_id', targetId).maybeSingle();
            if (previous.error) throw new ServiceUnavailableException('Akses sebelumnya belum dapat dibaca.');
            if (!privileged && previous.data?.permission === 'manager') throw new ForbiddenException('Pengelola tidak dapat mengubah akses pengelola lain.');
            // Hak reset hanya diberikan pembuat/Admin. Saat pengelola mengubah akses lain,
            // hak reset yang sudah ada dipertahankan, bukan terhapus diam-diam.
            const previousReset = previous.data?.can_reset === true && activeCollaboration(previous.data);
            if (!privileged && input.can_reset && !previousReset) {
                throw new ForbiddenException('Hanya pembuat atau Admin yang dapat memberikan hak pengelola atau reset.');
            }
            const canReset = input.permission !== 'viewer' && (privileged ? input.can_reset === true : previousReset);
            const resetExpiry = previousReset && previous.data?.expires_at ? Date.parse(String(previous.data.expires_at)) : null;
            if (!privileged && canReset && resetExpiry !== null && (expires === null || expires > resetExpiry)) {
                throw new ForbiddenException('Hanya pembuat atau Admin yang dapat memperpanjang batas hak reset.');
            }
            // Pengelola tidak dapat memberi akses yang bertahan lebih lama dari aksesnya sendiri.
            const ownExpiry = !privileged && context.grant?.expires_at ? Date.parse(String(context.grant.expires_at)) : null;
            if (ownExpiry !== null && (expires === null || expires > ownExpiry)) {
                throw new BadRequestException(`Batas akses tidak boleh melewati batas akses Anda sendiri (${new Date(ownExpiry).toISOString().slice(0, 10)}).`);
            }
            const next = { [key]: id, user_id: targetId, permission: input.permission,
                ...(type === 'exam' ? { can_reset: canReset } : {}),
                expires_at: expires === null ? null : new Date(expires).toISOString(), revoked_at: null,
                granted_by: user.id, updated_at: new Date().toISOString() };
            const result = await db.from(table).upsert(next, { onConflict: `${key},user_id` });
            if (result.error) throw new BadRequestException('Akses kolaborator belum berhasil disimpan.');
            const audit = await db.from('cbt_collaboration_events').insert({ resource_type: type, resource_id: id,
                actor_id: user.id, user_id: targetId, action: 'grant', previous_access: previous.data, new_access: next });
            if (audit.error) throw new BadRequestException('Riwayat perubahan akses belum berhasil disimpan.');
            return { userId: targetId };
        });
    }

    async revoke(user: AuthUser, type: CollaborativeResource, id: string, targetId: string) {
        return this.db.transaction(async db => {
            await advisoryTransactionLock(db, `collaborators:${type}:${id}`);
            const context = await this.context(user, type, id, true);
            if (targetId === context.resource.created_by) throw new BadRequestException('Akses pembuat asli tidak dapat dicabut.');
            const table = collaborationTable(type), key = collaborationKey(type);
            const previous = await db.from(table).select('*').eq(key, id).eq('user_id', targetId).maybeSingle();
            if (previous.error) throw new ServiceUnavailableException('Akses sebelumnya belum dapat dibaca.');
            if (!previous.data || previous.data.revoked_at) return { userId: targetId };
            if (!context.owner && !context.admin && previous.data.permission === 'manager') throw new ForbiddenException('Hanya pembuat atau Admin yang dapat mencabut pengelola.');
            const next = { revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            const result = await db.from(table).update(next).eq(key, id).eq('user_id', targetId);
            if (result.error) throw new BadRequestException('Akses belum berhasil dicabut.');
            const audit = await db.from('cbt_collaboration_events').insert({ resource_type: type, resource_id: id,
                actor_id: user.id, user_id: targetId, action: 'revoke', previous_access: previous.data, new_access: next });
            if (audit.error) throw new BadRequestException('Riwayat pencabutan akses belum berhasil disimpan.');
            return { userId: targetId };
        });
    }
}
