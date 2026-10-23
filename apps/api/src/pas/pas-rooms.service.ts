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
import { pasDate, writablePasPeriod } from '../common/pas-period-policy';
import { assertExamsHaveNoHistory, lockExamsForDeletion } from '../common/exam-deletion';
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
                 pas_room_invigilators:cbt_pas_room_invigilators!pas_room_id(user_id, session_id, exam_date, profiles:cbt_profiles!user_id(full_name)),
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

        return this.db.transaction(async db => {
            await writablePasPeriod(db, periodId);
            const data = await insertIdempotently<{ id: string }>(db, {
                table: 'cbt_pas_rooms',
                scope: { column: 'pas_period_id', value: periodId },
                clientRequestId: dto.clientRequestId,
                fingerprint: dto,
                select: 'id',
                payload: { pas_period_id: periodId, name: dto.name, capacity: dto.capacity },
        });

        return { id: data.id };
        });
    }

    async removeRoom(user: AuthUser, roomId: string) {
        await this.assertRoomAccess(user, roomId);

        return this.db.transaction(async db => {
            const { data: room } = await db.from('cbt_pas_rooms').select('pas_period_id').eq('id', roomId).maybeSingle();
            if (!room) throw new NotFoundException('Ruang ujian tidak ditemukan.');
            await writablePasPeriod(db, room.pas_period_id);
            await advisoryTransactionLock(db, 'pas-room-students:' + room.pas_period_id);
            const { data: reports, error: reportError } = await db.from('cbt_pas_administration_reports').select('id').eq('pas_room_id', roomId).limit(1);
            if (reportError) throw new BadRequestException('Riwayat ruang belum dapat diperiksa.');
            if (reports?.length) throw new ConflictException('Ruang memiliki riwayat administrasi dan tidak dapat dihapus.');
            const { data: schedules, error: scheduleError } = await db.from('cbt_pas_class_schedules').select('exam_id').eq('pas_period_id', room.pas_period_id);
            if (scheduleError) throw new BadRequestException('Riwayat ujian belum dapat diperiksa.');
            const examIds = (schedules || []).map((row: { exam_id?: string }) => row.exam_id).filter(Boolean);
            await lockExamsForDeletion(db, examIds);
            await assertExamsHaveNoHistory(db, examIds);
            const { error } = await db.from('cbt_pas_rooms').delete().eq('id', roomId);
            if (error) throw new BadRequestException('Ruang belum berhasil dihapus.');
            return { id: roomId };
        });
    }

    /**
     * Ganti seluruh daftar pengawas satu ruang pada satu sesi dan TANGGAL.
     *
     * Pengawas bergilir setiap hari, jadi penugasan disimpan per ruang × sesi ×
     * tanggal (sama dengan berita acara). Bersifat mengganti: layar penugasan
     * mengirim keadaan akhir yang diinginkan. Daftar kosong berarti ruang itu
     * memang tidak punya pengawas pada slot tersebut. Satu orang tidak boleh
     * bertugas di dua ruang pada tanggal & sesi yang sama.
     */
    async assignInvigilators(user: AuthUser, roomId: string, userIds: string[], sessionId: string, examDate: string) {
        await this.assertRoomAccess(user, roomId);
        if (!sessionId) throw new BadRequestException('Pilih sesi ujian terlebih dahulu.');
        const date = pasDate(examDate);
        const uniqueUserIds = [...new Set(userIds)];

        return this.db.transaction(async (db) => {
            const { data: room } = await db
                .from('cbt_pas_rooms')
                .select('pas_period_id')
                .eq('id', roomId)
                .maybeSingle();
            if (!room) throw new NotFoundException('Ruang ujian tidak ditemukan.');
            const periodId = (room as { pas_period_id: string }).pas_period_id;
            const period = await writablePasPeriod(db, periodId);
            this.assertDateInPeriod(period, date);
            // Kunci seluruh slot tanggal+sesi agar cek bentrok antar-ruang konsisten;
            // kunci per ruang tetap dipakai aktivasi jadwal.
            await advisoryTransactionLock(db, `pas-invigilator-slot:${periodId}:${sessionId}:${date}`);
            await advisoryTransactionLock(db, `pas-room-invigilators:${roomId}:${sessionId}`);

            const { data: session, error: sessionError } = await db.from('cbt_pas_sessions')
                .select('id').eq('id', sessionId).eq('pas_period_id', periodId).maybeSingle();
            if (sessionError) throw new BadRequestException('Sesi ujian belum dapat diperiksa.');
            if (!session) throw new BadRequestException('Sesi ujian harus berasal dari periode ruang yang sama.');

            await this.assertOrganizationUsers(
                db,
                period.organization_id as string,
                uniqueUserIds,
                ['Guru', 'Pengawas', 'Proktor', 'Admin'],
                'Pengawas',
            );
            await this.assertNoInvigilatorClash(db, periodId, roomId, sessionId, date, uniqueUserIds);

            const { error: deleteError } = await db
                .from('cbt_pas_room_invigilators')
                .delete()
                .eq('pas_room_id', roomId).eq('session_id', sessionId).eq('exam_date', date);
            if (deleteError) {
                this.logger.error(`Gagal mengganti pengawas ruang ${roomId}: ${deleteError.message}`);
                throw new BadRequestException('Gagal mengganti pengawas. Silakan coba lagi.');
            }

            if (uniqueUserIds.length > 0) {
                const { error } = await db.from('cbt_pas_room_invigilators').insert(
                    uniqueUserIds.map((userId) => ({ pas_room_id: roomId, session_id: sessionId, exam_date: date, user_id: userId })),
                );
                if (error) {
                    this.logger.error(`Gagal menyimpan pengawas ruang ${roomId}: ${error.message}`);
                    throw new BadRequestException('Gagal menyimpan pengawas. Silakan coba lagi.');
                }
            }

            return { roomId, sessionId, examDate: date, assigned: uniqueUserIds.length };
        });
    }

    /**
     * Salin seluruh penugasan pengawas (semua ruang & sesi) dari satu tanggal ke
     * tanggal lain dalam folder yang sama. Penugasan tanggal tujuan diganti
     * seluruhnya; setelah itu proktor tinggal menukar orang yang bergilir.
     */
    async copyInvigilators(user: AuthUser, periodId: string, fromDate: string, toDate: string) {
        await this.authz.assertProktorByRecord(user, 'cbt_pas_periods', periodId);
        const source = pasDate(fromDate);
        const target = pasDate(toDate);
        if (source === target) throw new BadRequestException('Tanggal sumber dan tujuan tidak boleh sama.');

        return this.db.transaction(async (db) => {
            const period = await writablePasPeriod(db, periodId);
            this.assertDateInPeriod(period, source);
            this.assertDateInPeriod(period, target);

            const { data: rooms, error: roomError } = await db.from('cbt_pas_rooms').select('id').eq('pas_period_id', periodId);
            if (roomError) throw new BadRequestException('Daftar ruang belum dapat diperiksa.');
            const roomIds = ((rooms as Array<{ id: string }>) || []).map(room => room.id).sort();
            if (!roomIds.length) return { fromDate: source, toDate: target, copied: 0 };

            const { data: sessions, error: sessionError } = await db.from('cbt_pas_sessions').select('id').eq('pas_period_id', periodId);
            if (sessionError) throw new BadRequestException('Daftar sesi belum dapat diperiksa.');
            for (const sessionId of ((sessions as Array<{ id: string }>) || []).map(row => row.id).sort()) {
                await advisoryTransactionLock(db, `pas-invigilator-slot:${periodId}:${sessionId}:${target}`);
            }
            for (const roomId of roomIds) {
                for (const sessionId of ((sessions as Array<{ id: string }>) || []).map(row => row.id).sort()) {
                    await advisoryTransactionLock(db, `pas-room-invigilators:${roomId}:${sessionId}`);
                }
            }

            const { data: sourceRows, error: readError } = await db.from('cbt_pas_room_invigilators')
                .select('pas_room_id, session_id, user_id').in('pas_room_id', roomIds).eq('exam_date', source);
            if (readError) throw new BadRequestException('Pengawas tanggal sumber belum dapat dibaca.');
            const rows = ((sourceRows as Array<{ pas_room_id: string; session_id: string | null; user_id: string }>) || [])
                .filter(row => row.session_id);

            const { error: deleteError } = await db.from('cbt_pas_room_invigilators')
                .delete().in('pas_room_id', roomIds).eq('exam_date', target);
            if (deleteError) {
                this.logger.error(`Gagal mengosongkan pengawas ${target}: ${deleteError.message}`);
                throw new BadRequestException('Gagal menyalin pengawas. Silakan coba lagi.');
            }
            if (rows.length) {
                const { error } = await db.from('cbt_pas_room_invigilators').insert(
                    rows.map(row => ({ pas_room_id: row.pas_room_id, session_id: row.session_id, exam_date: target, user_id: row.user_id })),
                );
                if (error) {
                    this.logger.error(`Gagal menyalin pengawas ke ${target}: ${error.message}`);
                    throw new BadRequestException('Gagal menyalin pengawas. Silakan coba lagi.');
                }
            }
            return { fromDate: source, toDate: target, copied: rows.length };
        });
    }

    /** Tanggal tugas harus berada di dalam rentang folder (bila rentangnya diisi). */
    private assertDateInPeriod(period: Record<string, any>, date: string) {
        if (!period.start_date || !period.end_date) return;
        const start = pasDate(period.start_date), end = pasDate(period.end_date);
        if (date < start || date > end) {
            throw new BadRequestException(`Tanggal bertugas harus di antara ${start} dan ${end}.`);
        }
    }

    /** Satu orang hanya boleh mengawasi satu ruang pada tanggal & sesi yang sama. */
    private async assertNoInvigilatorClash(
        db: DbSession, periodId: string, roomId: string, sessionId: string, date: string, userIds: string[],
    ) {
        if (!userIds.length) return;
        const { data: rooms, error: roomError } = await db.from('cbt_pas_rooms').select('id, name').eq('pas_period_id', periodId);
        if (roomError) throw new BadRequestException('Daftar ruang belum dapat diperiksa.');
        const otherRooms = ((rooms as Array<{ id: string; name: string }>) || []).filter(room => room.id !== roomId);
        if (!otherRooms.length) return;
        const { data: clashes, error } = await db.from('cbt_pas_room_invigilators')
            .select('pas_room_id, user_id')
            .in('pas_room_id', otherRooms.map(room => room.id))
            .eq('session_id', sessionId).eq('exam_date', date)
            .in('user_id', userIds);
        if (error) throw new BadRequestException('Jadwal pengawas belum dapat diperiksa.');
        const clash = ((clashes as Array<{ pas_room_id: string; user_id: string }>) || [])[0];
        if (!clash) return;
        const { data: profile } = await db.from('cbt_profiles').select('full_name').eq('id', clash.user_id).maybeSingle();
        const roomName = otherRooms.find(room => room.id === clash.pas_room_id)?.name || 'ruang lain';
        const name = (profile as { full_name?: string } | null)?.full_name || 'Pengawas yang dipilih';
        throw new ConflictException(`${name} sudah bertugas di ${roomName} pada tanggal dan sesi yang sama.`);
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
            await writablePasPeriod(db, periodId);
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

        return this.db.transaction(async db => {
            await writablePasPeriod(db, periodId);
            await advisoryTransactionLock(db, 'pas-room-students:' + periodId);
            const { error } = await db.from('cbt_pas_room_students').delete().eq('pas_period_id', periodId).eq('user_id', userId);
            if (error) throw new BadRequestException('Peserta belum berhasil dikeluarkan dari ruang.');
            return { periodId, userId };
        });
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
