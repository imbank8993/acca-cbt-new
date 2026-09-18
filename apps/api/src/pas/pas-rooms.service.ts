import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
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

    async listRooms(user: AuthUser, periodId: string) {
        await this.authz.assertStaffByRecord(user, 'cbt_pas_periods', periodId);

        const { data, error } = await this.db
            .from('cbt_pas_rooms')
            .select(
                `id, name, capacity,
                 pas_room_invigilators:cbt_pas_room_invigilators(user_id, profiles:cbt_profiles(full_name)),
                 pas_room_students:cbt_pas_room_students(user_id, profiles:cbt_profiles(full_name))`,
            )
            .eq('pas_period_id', periodId)
            .order('name');

        if (error) {
            this.logger.error(`Gagal membaca daftar ruang: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    async createRoom(user: AuthUser, periodId: string, dto: CreatePASRoomDto) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);

        const { data, error } = await this.db
            .from('cbt_pas_rooms')
            .insert({ pas_period_id: periodId, name: dto.name, capacity: dto.capacity })
            .select('id')
            .single();

        if (error) throw new BadRequestException(error.message);

        return { id: (data as { id: string }).id };
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

        await this.db.from('cbt_pas_room_invigilators').delete().eq('pas_room_id', roomId);

        if (userIds.length > 0) {
            const { error } = await this.db.from('cbt_pas_room_invigilators').insert(
                userIds.map((userId) => ({ pas_room_id: roomId, user_id: userId })),
            );
            if (error) throw new BadRequestException(error.message);
        }

        return { roomId, assigned: userIds.length };
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
        if (userIds.length === 0) return { roomId, assigned: 0 };

        await this.db
            .from('cbt_pas_room_students')
            .delete()
            .eq('pas_period_id', periodId)
            .in('user_id', userIds);

        const { error } = await this.db.from('cbt_pas_room_students').insert(
            userIds.map((userId) => ({
                pas_period_id: periodId,
                pas_room_id: roomId,
                user_id: userId,
            })),
        );

        if (error) throw new BadRequestException(error.message);

        return { roomId, assigned: userIds.length };
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
}
