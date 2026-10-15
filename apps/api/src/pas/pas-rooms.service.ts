import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { insertIdempotently } from '../common/idempotent-create';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import type { CreatePASRoomDto } from './dto/pas.dto';

/**
 * Ruang ujian PAS beserta pengawas dan peserta yang ditugaskan padanya.
 *
 * Dipindahkan dari bagian "ROOM & INVIGILATOR MANAGEMENT" di
 * `apps/web/app/actions/pas.ts`.
 */
@Injectable()
export class PasRoomsService {
    private readonly logger = new Logger(PasRoomsService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    async listMasterRooms(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);
        // ACCA-new master data is shared by this single-school installation.
        const { data, error } = await this.db.from('master_ruangan')
            .select('id, kode, nama, lokasi, kapasitas')
            .eq('aktif', true).order('nama');
        if (error) throw new ServiceUnavailableException('Master ruang belum dapat dimuat. Anda tetap dapat mengisi ruang secara manual.');
        return (data || []).map((room: { id: string | number; kode: string | null; nama: string; lokasi: string | null; kapasitas: number | null }) => ({
            id: String(room.id), name: room.nama, code: room.kode,
            location: room.lokasi, capacity: room.kapasitas,
        }));
    }

    async listRooms(user: AuthUser, periodId: string) {
        await this.authz.assertStaffByRecord(user, 'cbt_pas_periods', periodId);

        const { data, error } = await this.db
            .from('cbt_pas_rooms')
            .select(
                `id, name, capacity,
                 pas_room_invigilators:cbt_pas_room_invigilators!pas_room_id(user_id, profiles:cbt_profiles!user_id(full_name)),
                 pas_room_students:cbt_pas_room_students!cbt_pas_room_students_pas_room_id_fkey(user_id, profiles:cbt_profiles!user_id(full_name))`,
            )
            .eq('pas_period_id', periodId)
            .order('name');

        if (error) {
            this.logger.error(`Gagal membaca daftar ruang: ${error.message}`);
            throw new ServiceUnavailableException('Daftar ruang ujian belum dapat dimuat. Silakan coba lagi.');
        }
        return (data as any[]) || [];
    }

    async createRoom(user: AuthUser, periodId: string, dto: CreatePASRoomDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);

        const data = await insertIdempotently<{ id: string }>(this.db, {
            table: 'cbt_pas_rooms',
            scope: { column: 'pas_period_id', value: periodId },
            clientRequestId: dto.clientRequestId,
            fingerprint: dto,
            select: 'id',
            payload: { pas_period_id: periodId, name: dto.name, capacity: dto.capacity },
        });

        return { id: data.id };
    }

    async removeRoom(user: AuthUser, roomId: string) {
        await this.assertRoomAccess(user, roomId);

        const { error } = await this.db.from('cbt_pas_rooms').delete().eq('id', roomId);
        if (error) throw new BadRequestException(error.message);

        return { id: roomId };
    }

    /**
     * Ganti seluruh daftar pengawas satu ruang.
     *
     * Bersifat mengganti, bukan menambah: layar penugasan mengirim keadaan akhir
     * yang diinginkan, jadi daftar lama dikosongkan lebih dulu. Daftar kosong
     * berarti ruang itu memang tidak punya pengawas.
     */
    async assignInvigilators(user: AuthUser, roomId: string, userIds: string[]) {
        await this.assertRoomAccess(user, roomId);
        const uniqueUserIds = [...new Set(userIds)];

        return this.db.transaction(async (db) => {
            await advisoryTransactionLock(db, `pas-room-invigilators:${roomId}`);

            const { data: room } = await db
                .from('cbt_pas_rooms')
                .select('pas_period_id')
                .eq('id', roomId)
                .maybeSingle();
            if (!room) throw new NotFoundException('Ruang ujian tidak ditemukan.');

            const { data: period } = await db
                .from('cbt_pas_periods')
                .select('organization_id')
                .eq('id', (room as { pas_period_id: string }).pas_period_id)
                .maybeSingle();
            if (!period) throw new NotFoundException('Periode ujian tidak ditemukan.');

            await this.assertOrganizationUsers(
                db,
                (period as { organization_id: string }).organization_id,
                uniqueUserIds,
                ['Guru', 'Pengawas', 'Proktor', 'Admin'],
                'Pengawas',
            );

            const { error: deleteError } = await db
                .from('cbt_pas_room_invigilators')
                .delete()
                .eq('pas_room_id', roomId);
            if (deleteError) {
                throw new BadRequestException(`Gagal mengganti pengawas: ${deleteError.message}`);
            }

            if (uniqueUserIds.length > 0) {
                const { error } = await db.from('cbt_pas_room_invigilators').insert(
                    uniqueUserIds.map((userId) => ({ pas_room_id: roomId, user_id: userId })),
                );
                if (error) throw new BadRequestException(`Gagal menyimpan pengawas: ${error.message}`);
            }

            return { roomId, assigned: uniqueUserIds.length };
        });
    }

    /**
     * Tugaskan peserta ke sebuah ruang.
     *
     * Seorang siswa hanya boleh menempati satu ruang per periode (ada batasan
     * unik untuk itu), jadi penugasan lamanya di periode yang sama dihapus lebih
     * dulu — termasuk bila ruang lamanya berbeda.
     */
    async assignStudents(user: AuthUser, periodId: string, roomId: string, userIds: string[]) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);
        const uniqueUserIds = [...new Set(userIds)];
        if (uniqueUserIds.length === 0) return { roomId, assigned: 0 };

        return this.db.transaction(async (db) => {
            // Semua pemindahan siswa dalam satu periode berbagi lock agar dua
            // admin tidak sama-sama melihat sisa kapasitas yang sama.
            await advisoryTransactionLock(db, `pas-room-students:${periodId}`);

            const [{ data: period }, { data: room }] = await Promise.all([
                db.from('cbt_pas_periods').select('organization_id').eq('id', periodId).maybeSingle(),
                db.from('cbt_pas_rooms').select('pas_period_id, capacity').eq('id', roomId)
                    .eq('pas_period_id', periodId).maybeSingle(),
            ]);
            if (!period) throw new NotFoundException('Periode ujian tidak ditemukan.');
            if (!room) throw new NotFoundException('Ruang tidak berada pada periode yang dipilih.');

            await this.assertOrganizationUsers(
                db,
                (period as { organization_id: string }).organization_id,
                uniqueUserIds,
                ['Siswa'],
                'Siswa',
            );

            const { data: currentRows, error: currentError } = await db
                .from('cbt_pas_room_students')
                .select('user_id')
                .eq('pas_room_id', roomId);
            if (currentError) {
                throw new BadRequestException(`Gagal membaca isi ruang: ${currentError.message}`);
            }

            const currentIds = new Set(
                ((currentRows as Array<{ user_id: string }>) || []).map((row) => row.user_id),
            );
            const movingIds = uniqueUserIds.filter((id) => !currentIds.has(id));
            const capacity = Number((room as { capacity: number | null }).capacity) || 0;
            if (currentIds.size + movingIds.length > capacity) {
                throw new ConflictException(
                    `Kapasitas ruang tidak cukup. Tersedia ${Math.max(0, capacity - currentIds.size)} tempat.`,
                );
            }

            if (movingIds.length > 0) {
                const { error: deleteError } = await db
                    .from('cbt_pas_room_students')
                    .delete()
                    .eq('pas_period_id', periodId)
                    .in('user_id', movingIds);
                if (deleteError) {
                    throw new BadRequestException(`Gagal memindahkan siswa: ${deleteError.message}`);
                }

                const { error: insertError } = await db.from('cbt_pas_room_students').insert(
                    movingIds.map((userId) => ({
                        pas_period_id: periodId,
                        pas_room_id: roomId,
                        user_id: userId,
                    })),
                );
                if (insertError) {
                    throw new BadRequestException(`Gagal menempatkan siswa: ${insertError.message}`);
                }
            }

            return { roomId, assigned: uniqueUserIds.length };
        });
    }

    async removeStudent(user: AuthUser, periodId: string, userId: string) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);

        const { error } = await this.db
            .from('cbt_pas_room_students')
            .delete()
            .eq('pas_period_id', periodId)
            .eq('user_id', userId);

        if (error) throw new BadRequestException(error.message);

        return { periodId, userId };
    }

    private assertRoomAccess(user: AuthUser, roomId: string): Promise<void> {
        return this.authz.assertProktorByParent(
            user,
            'cbt_pas_rooms',
            roomId,
            'pas_period_id',
            'cbt_pas_periods',
        );
    }

    /** Pastikan seluruh ID adalah anggota aktif organisasi dengan peran yang diizinkan. */
    private async assertOrganizationUsers(
        db: DbSession,
        organizationId: string,
        userIds: string[],
        allowedRoles: string[],
        label: string,
    ): Promise<void> {
        if (userIds.length === 0) return;

        const { data, error } = await db
            .from('cbt_organization_members')
            .select('user_id, member_roles:cbt_member_roles(roles:cbt_roles(name))')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .in('user_id', userIds);
        if (error) throw new BadRequestException(`Gagal memvalidasi ${label.toLowerCase()}: ${error.message}`);

        const allowed = new Set(allowedRoles.map((role) => role.toLowerCase()));
        const validIds = new Set(
            ((data as Array<{ user_id: string; member_roles?: Array<{ roles?: { name?: string } }> }>) || [])
                .filter((member) => (member.member_roles || []).some(
                    (entry) => allowed.has(String(entry.roles?.name || '').toLowerCase()),
                ))
                .map((member) => member.user_id),
        );

        if (validIds.size !== userIds.length) {
            throw new BadRequestException(
                `${label} yang dipilih harus merupakan anggota aktif sekolah dengan peran yang sesuai.`,
            );
        }
    }
}
