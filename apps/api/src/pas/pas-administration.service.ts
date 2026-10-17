import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import { normalizeSqlTime } from '../common/school-time';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { DbService } from '../prisma/prisma-db-adapter';
import {
    ApprovePASAdministrationDto,
    RejectPASAdministrationDto,
    SavePASAdministrationDto,
} from './dto/pas.dto';
import { EXAM_ADMINISTRATION_SETTING_KEY, normalizeExamAdministrationSettings } from '../common/exam-administration-settings';

export type AttendanceStatus = 'hadir' | 'sakit' | 'izin' | 'alpha';

const VALID_ATTENDANCE_STATUSES = new Set<AttendanceStatus>(['hadir', 'sakit', 'izin', 'alpha']);

function cleanDateString(raw: unknown): string {
    if (!raw) return '';
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return raw.toISOString().slice(0, 10);
    }
    const text = String(raw).trim();
    return text.includes('T') ? text.split('T')[0] : text.slice(0, 10);
}

export function buildVerificationCodePair(
    periodId: string,
    roomId: string,
    sessionId: string,
    examDate: string,
): { beritaAcaraCode: string; daftarHadirCode: string } {
    const cleanDate = cleanDateString(examDate).replace(/-/g, '');
    const digest = createHash('sha256')
        .update(`${periodId}:${roomId}:${sessionId}:${cleanDate}`)
        .digest('hex')
        .toUpperCase();
    const tokenA = `${digest.slice(0, 4)}-${digest.slice(4, 8)}`;
    const tokenB = `${digest.slice(8, 12)}-${digest.slice(12, 16)}`;
    return {
        beritaAcaraCode: `BA-PAS-${cleanDate}-${tokenA}`,
        daftarHadirCode: `DH-PAS-${cleanDate}-${tokenB}`,
    };
}

export function computeAdministrationSignatureHash(payload: {
    organizationId: string;
    periodId: string;
    roomId: string;
    sessionId: string;
    examDate: string;
    invigilatorName: string;
    proctorName: string;
    signatureVersion?: number;
    committeeChairName?: string;
    committeeChairNip?: string;
    proctorNip?: string;
    beritaAcaraCode: string;
    daftarHadirCode: string;
    counts: { total: number; hadir: number; sakit: number; izin: number; alpha: number };
}): string {
    const canonical = JSON.stringify({
        org: payload.organizationId,
        period: payload.periodId,
        room: payload.roomId,
        session: payload.sessionId,
        date: cleanDateString(payload.examDate),
        invigilator: payload.invigilatorName.trim(),
        proctor: payload.proctorName.trim(),
        baCode: payload.beritaAcaraCode,
        dhCode: payload.daftarHadirCode,
        counts: payload.counts,
        ...(payload.signatureVersion === 2 ? {
            version: 2,
            committeeChair: (payload.committeeChairName || '').trim(),
            committeeChairNip: (payload.committeeChairNip || '').trim(),
            proctorNip: (payload.proctorNip || '').trim(),
        } : {}),
    });
    return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class PasAdministrationService {
    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
    ) {}

    private async committeeChair(db: Pick<DbService, 'from'> = this.db, period?: Record<string, any>) {
        if (period?.committee_chair_name && typeof period.committee_chair_name === 'string' && period.committee_chair_name.trim()) {
            return {
                committee_chair_name: period.committee_chair_name.trim(),
                committee_chair_nip: typeof period.committee_chair_nip === 'string' ? period.committee_chair_nip.trim() : '',
            };
        }
        const { data, error } = await db.from('acca_settings').select('value')
            .eq('key', EXAM_ADMINISTRATION_SETTING_KEY).maybeSingle();
        if (error) throw new BadRequestException('Pengaturan Ketua Panitia belum dapat dibaca.');
        return normalizeExamAdministrationSettings(data?.value || {}, false);
    }

    private async isProktorOrAdmin(user: AuthUser, organizationId: string): Promise<boolean> {
        try {
            await this.authz.assertProktor(user, organizationId);
            return true;
        } catch {
            return false;
        }
    }

    private async assertSlotAccess(
        user: AuthUser,
        periodId: string,
        roomId: string,
        sessionId: string,
    ) {
        const [{ data: period }, { data: room }, { data: session }] = await Promise.all([
            this.db.from('cbt_pas_periods').select('*').eq('id', periodId).maybeSingle(),
            this.db.from('cbt_pas_rooms').select('*').eq('id', roomId).maybeSingle(),
            this.db.from('cbt_pas_sessions').select('*').eq('id', sessionId).maybeSingle(),
        ]);

        if (!period) throw new NotFoundException('Periode ujian tidak ditemukan.');
        if (!room || (room as any).pas_period_id !== periodId) {
            throw new NotFoundException('Ruang ujian tidak ditemukan pada periode ini.');
        }
        if (!session || (session as any).pas_period_id !== periodId) {
            throw new NotFoundException('Sesi ujian tidak ditemukan pada periode ini.');
        }

        const organizationId = (period as any).organization_id as string;
        await this.authz.assertOrgStaff(user, organizationId);

        const isManager = await this.isProktorOrAdmin(user, organizationId);
        if (!isManager) {
            const { data: assignment } = await this.db
                .from('cbt_pas_room_invigilators')
                .select('id')
                .eq('pas_room_id', roomId)
                .eq('session_id', sessionId)
                .eq('user_id', user.id)
                .maybeSingle();

            if (!assignment) {
                throw new ForbiddenException(
                    'Anda tidak ditugaskan sebagai pengawas pada ruang dan sesi ujian ini.',
                );
            }
        }

        return {
            period: period as Record<string, any>,
            room: room as Record<string, any>,
            session: {
                ...(session as Record<string, any>),
                start_time: normalizeSqlTime((session as any).start_time) || '07:30:00',
                end_time: normalizeSqlTime((session as any).end_time) || '09:30:00',
            } as Record<string, any>,
            organizationId,
            isManager,
        };
    }

    async listMyAssignments(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);
        const isManager = await this.isProktorOrAdmin(user, organizationId);

        const { data: periods } = await this.db
            .from('cbt_pas_periods')
            .select('id, name, type, school_year, semester, start_date, end_date, is_locked, created_by, committee_chair_name, committee_chair_nip')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        const periodList = ((periods as any[]) || []);
        if (periodList.length === 0) return [];

        const periodIds = periodList.map((p) => p.id);
        const [
            { data: rooms },
            { data: sessions },
            { data: schedules },
            { data: reports },
        ] = await Promise.all([
            this.db
                .from('cbt_pas_rooms')
                .select(
                    `id, pas_period_id, name, capacity,
                     pas_room_invigilators:cbt_pas_room_invigilators!pas_room_id(user_id, session_id, profiles:cbt_profiles!user_id(full_name)),
                     pas_room_students:cbt_pas_room_students!cbt_pas_room_students_pas_room_id_fkey(user_id)`,
                )
                .in('pas_period_id', periodIds)
                .order('name'),
            this.db
                .from('cbt_pas_sessions')
                .select('id, pas_period_id, name, start_time, end_time')
                .in('pas_period_id', periodIds)
                .order('start_time'),
            this.db
                .from('cbt_pas_class_schedules')
                .select('id, pas_period_id, session_id, scheduled_date, room, question_banks:cbt_question_banks(title), classes:cbt_classes(name)')
                .in('pas_period_id', periodIds),
            this.db
                .from('cbt_pas_administration_reports')
                .select('id, pas_period_id, pas_room_id, session_id, exam_date, verification_code, attendance_verification_code, signed_at')
                .in('pas_period_id', periodIds),
        ]);

        const roomList = ((rooms as any[]) || []);
        const sessionList = ((sessions as any[]) || []).map((s) => ({
            ...s,
            start_time: normalizeSqlTime(s.start_time) || '07:30:00',
            end_time: normalizeSqlTime(s.end_time) || '09:30:00',
        }));
        const scheduleList = ((schedules as any[]) || []);
        const reportList = ((reports as any[]) || []);

        const assignments: Array<Record<string, any>> = [];

        for (const period of periodList) {
            const pRooms = roomList.filter((r) => r.pas_period_id === period.id);
            const pSessions = sessionList.filter((s) => s.pas_period_id === period.id);

            for (const room of pRooms) {
                for (const session of pSessions) {
                    const invigilators = ((room.pas_room_invigilators as any[]) || []).filter(
                        (inv) => inv.session_id === session.id,
                    );
                    const isAssignedToMe = invigilators.some((inv) => inv.user_id === user.id);

                    if (!isManager && !isAssignedToMe) continue;

                    const sessionSchedules = scheduleList.filter(
                        (sc) => sc.pas_period_id === period.id && sc.session_id === session.id,
                    );
                    const scheduledDates = [
                        ...new Set(
                            sessionSchedules
                                .map((sc) => cleanDateString(sc.scheduled_date))
                                .filter(Boolean),
                        ),
                    ].sort();

                    const slotReports = reportList.filter(
                        (rep) =>
                            rep.pas_period_id === period.id &&
                            rep.pas_room_id === room.id &&
                            rep.session_id === session.id,
                    );

                    assignments.push({
                        period: {
                            id: period.id,
                            name: period.name,
                            type: period.type || 'pas',
                            school_year: period.school_year,
                            semester: period.semester,
                            start_date: cleanDateString(period.start_date),
                            end_date: cleanDateString(period.end_date),
                            is_locked: Boolean(period.is_locked),
                            committee_chair_name: period.committee_chair_name || null,
                            committee_chair_nip: period.committee_chair_nip || null,
                        },
                        room: {
                            id: room.id,
                            name: room.name,
                            capacity: room.capacity,
                            student_count: ((room.pas_room_students as any[]) || []).length,
                        },
                        session: {
                            id: session.id,
                            name: session.name,
                            start_time: session.start_time,
                            end_time: session.end_time,
                        },
                        invigilators: invigilators.map((inv) => ({
                            user_id: inv.user_id,
                            full_name: inv.profiles?.full_name || 'Pengawas',
                        })),
                        is_assigned_to_me: isAssignedToMe,
                        scheduled_dates: scheduledDates,
                        saved_reports: slotReports.map((r) => ({
                            id: r.id,
                            exam_date: cleanDateString(r.exam_date),
                            verification_code: r.verification_code,
                            attendance_verification_code: r.attendance_verification_code,
                            signed_at: r.signed_at,
                        })),
                    });
                }
            }
        }

        return assignments.sort((a, b) => {
            if (a.is_assigned_to_me !== b.is_assigned_to_me) {
                return a.is_assigned_to_me ? -1 : 1;
            }
            return String(a.room.name).localeCompare(String(b.room.name), 'id-ID', { numeric: true });
        });
    }

    async getAdministrationSlot(
        user: AuthUser,
        params: { periodId: string; roomId: string; sessionId: string; examDate?: string },
    ) {
        const { period, room, session, organizationId } = await this.assertSlotAccess(
            user,
            params.periodId,
            params.roomId,
            params.sessionId,
        );

        const [
            { data: organization },
            { data: profilSekolahRow },
            { data: creatorProfile },
            { data: invigilatorRows },
            { data: roomStudentRows },
            { data: roomScheduleLinks },
            { data: sessionSchedules },
        ] = await Promise.all([
            this.db
                .from('cbt_organizations')
                .select('id, name, logo_url')
                .eq('id', organizationId)
                .maybeSingle(),
            this.db
                .from('profil_sekolah')
                .select(
                    'nama, jenjang, jenis, alamat, desa_kelurahan, kecamatan, kabupaten_kota, provinsi, kode_pos, telepon, email, website, logo_url, kepala_sekolah_nama, kepala_sekolah_nip',
                )
                .limit(1)
                .maybeSingle(),
            period.created_by
                ? this.db
                      .from('cbt_profiles')
                      .select('id, full_name, identity_number, nis')
                      .eq('id', period.created_by)
                      .maybeSingle()
                : Promise.resolve({ data: null }),
            this.db
                .from('cbt_pas_room_invigilators')
                .select('user_id, session_id, profiles:cbt_profiles!user_id(id, full_name, identity_number)')
                .eq('pas_room_id', room.id)
                .eq('session_id', session.id),
            this.db
                .from('cbt_pas_room_students')
                .select('user_id, profiles:cbt_profiles!user_id(id, full_name, identity_number, unique_id)')
                .eq('pas_room_id', room.id),
            this.db
                .from('cbt_pas_room_schedules')
                .select('schedule_id')
                .eq('pas_room_id', room.id),
            this.db
                .from('cbt_pas_class_schedules')
                .select('id, bank_id, class_id, subject_id, exam_id, scheduled_date, duration_minutes, room, classes:cbt_classes(name), subjects:cbt_subjects(name), question_banks:cbt_question_banks(id, title, subject)')
                .eq('pas_period_id', period.id)
                .eq('session_id', session.id),
        ]);

        const studentIds = ((roomStudentRows as any[]) || []).map((row) => row.user_id as string);
        const invigilatorUserIds = ((invigilatorRows as any[]) || []).map((row) => row.user_id as string);
        const allProfileIds = [...new Set([...studentIds, ...invigilatorUserIds])];

        // Load student classes, profiles fallback, subjects fallback, and question banks fallback
        const [profilesRes, classMembersRes, classesRes, subjectsRes, questionBanksRes] =
            await Promise.all([
                allProfileIds.length > 0
                    ? this.db
                          .from('cbt_profiles')
                          .select('id, full_name, identity_number, unique_id, nis')
                          .in('id', allProfileIds)
                    : Promise.resolve({ data: [] }),
                studentIds.length > 0
                    ? this.db
                          .from('cbt_class_members')
                          .select('user_id, class_id, classes:cbt_classes(name)')
                          .in('user_id', studentIds)
                    : Promise.resolve({ data: [] }),
                this.db
                    .from('cbt_classes')
                    .select('id, name')
                    .eq('organization_id', organizationId),
                this.db
                    .from('cbt_subjects')
                    .select('id, name')
                    .eq('organization_id', organizationId),
                this.db
                    .from('cbt_question_banks')
                    .select('id, title, subject')
                    .eq('organization_id', organizationId),
            ]);

        const profileById = new Map<string, any>();
        for (const p of ((profilesRes.data as any[]) || [])) {
            if (p.id) profileById.set(p.id, p);
        }

        const classById = new Map<string, string>();
        for (const c of ((classesRes.data as any[]) || [])) {
            if (c.id && c.name) classById.set(c.id, c.name);
        }

        const subjectById = new Map<string, string>();
        for (const s of ((subjectsRes.data as any[]) || [])) {
            if (s.id && s.name) subjectById.set(s.id, s.name);
        }

        const bankById = new Map<string, { title: string; subject: string }>();
        for (const b of ((questionBanksRes.data as any[]) || [])) {
            if (b.id) bankById.set(b.id, { title: b.title || 'Bank Soal', subject: b.subject || '' });
        }

        const classMap = new Map<string, string>();
        const studentClassIds = new Set<string>();
        for (const cm of ((classMembersRes.data as any[]) || [])) {
            if (cm.class_id) studentClassIds.add(cm.class_id as string);
            const className = cm.classes?.name || (cm.class_id ? classById.get(cm.class_id) : undefined);
            if (cm.user_id && className) {
                classMap.set(cm.user_id, className);
            }
        }

        const linkedScheduleIds = new Set(
            ((roomScheduleLinks as Array<{ schedule_id: string }>) || []).map((r) => r.schedule_id),
        );
        const roomNameLower = String(room.name || '').trim().toLowerCase();
        const allSessionSchedules = ((sessionSchedules as any[]) || []);

        // Filter schedules relevant to this specific room (via room_schedules, room name, or student classes in room)
        const roomScopedSchedules = allSessionSchedules.filter((sc) => {
            if (linkedScheduleIds.has(sc.id)) return true;
            if (sc.room && String(sc.room).trim().toLowerCase() === roomNameLower) return true;
            if (sc.class_id && studentClassIds.has(sc.class_id)) return true;
            return false;
        });
        const relevantSessionSchedules =
            roomScopedSchedules.length > 0 ? roomScopedSchedules : allSessionSchedules;

        const availableDates = [
            ...new Set(
                relevantSessionSchedules
                    .map((sc) => cleanDateString(sc.scheduled_date))
                    .filter(Boolean),
            ),
        ].sort();

        const effectiveDate = cleanDateString(
            params.examDate || availableDates[0] || period.start_date || new Date().toISOString().slice(0, 10),
        );

        const dateSchedules = relevantSessionSchedules.filter(
            (sc) => cleanDateString(sc.scheduled_date) === effectiveDate,
        );
        const activeSchedules = dateSchedules.length > 0 ? dateSchedules : relevantSessionSchedules;

        const [attemptsRes, savedAttendancesRes, savedReportRes] = await Promise.all([
            studentIds.length > 0 && activeSchedules.some((sc) => sc.exam_id)
                ? this.db
                      .from('cbt_exam_attempts')
                      .select('id, user_id, exam_id, status, started_at, finished_at')
                      .in(
                          'exam_id',
                          activeSchedules.map((sc) => sc.exam_id).filter(Boolean),
                      )
                      .in('user_id', studentIds)
                : Promise.resolve({ data: [] }),
            this.db
                .from('cbt_pas_student_attendances')
                .select('user_id, status, remark, updated_at')
                .eq('pas_period_id', period.id)
                .eq('pas_room_id', room.id)
                .eq('session_id', session.id)
                .eq('exam_date', effectiveDate),
            this.db
                .from('cbt_pas_administration_reports')
                .select('*')
                .eq('pas_period_id', period.id)
                .eq('pas_room_id', room.id)
                .eq('session_id', session.id)
                .eq('exam_date', effectiveDate)
                .maybeSingle(),
        ]);

        const scheduleByExamId = new Map<string, any>();
        for (const sc of activeSchedules) {
            if (sc.exam_id) scheduleByExamId.set(sc.exam_id, sc);
        }

        const attemptByStudent = new Map<string, any>();
        for (const att of ((attemptsRes.data as any[]) || [])) {
            const existing = attemptByStudent.get(att.user_id);
            if (!existing || (att.started_at && !existing.started_at)) {
                attemptByStudent.set(att.user_id, att);
            }
        }

        const savedAttendanceByStudent = new Map<string, { status: AttendanceStatus; remark: string }>();
        for (const row of ((savedAttendancesRes.data as any[]) || [])) {
            const st = String(row.status || 'hadir').toLowerCase() as AttendanceStatus;
            savedAttendanceByStudent.set(row.user_id, {
                status: VALID_ATTENDANCE_STATUSES.has(st) ? st : 'hadir',
                remark: String(row.remark || ''),
            });
        }

        const students = ((roomStudentRows as any[]) || [])
            .map((row) => {
                const userId = row.user_id as string;
                const profile = row.profiles || profileById.get(userId) || {};
                const attempt = attemptByStudent.get(userId);
                const savedAtt = savedAttendanceByStudent.get(userId);
                const matchedSchedule = attempt?.exam_id ? scheduleByExamId.get(attempt.exam_id) : undefined;
                const nisValue = profile.identity_number || profile.unique_id || profile.nis || '-';
                const fallbackBank = matchedSchedule?.bank_id
                    ? bankById.get(matchedSchedule.bank_id)
                    : activeSchedules[0]?.bank_id
                      ? bankById.get(activeSchedules[0].bank_id)
                      : undefined;

                const status: AttendanceStatus = savedAtt?.status || 'hadir';
                return {
                    user_id: userId,
                    full_name: profile.full_name || 'Tanpa Nama',
                    nis: nisValue,
                    identity_number: nisValue,
                    class_name:
                        classMap.get(userId) ||
                        matchedSchedule?.classes?.name ||
                        (matchedSchedule?.class_id ? classById.get(matchedSchedule.class_id) : undefined) ||
                        '-',
                    exam_title:
                        matchedSchedule?.question_banks?.title ||
                        activeSchedules[0]?.question_banks?.title ||
                        fallbackBank?.title ||
                        '-',
                    started_at: attempt?.started_at || null,
                    finished_at: attempt?.finished_at || null,
                    attempt_status: attempt?.status || null,
                    status,
                    attendance_status: status,
                    remark: savedAtt?.remark || '',
                };
            })
            .sort((a, b) => {
                const classCmp = String(a.class_name).localeCompare(String(b.class_name), 'id-ID', { numeric: true });
                if (classCmp !== 0) return classCmp;
                return String(a.full_name).localeCompare(String(b.full_name), 'id-ID');
            });

        const counts = {
            total: students.length,
            hadir: students.filter((s) => s.status === 'hadir').length,
            sakit: students.filter((s) => s.status === 'sakit').length,
            izin: students.filter((s) => s.status === 'izin').length,
            alpha: students.filter((s) => s.status === 'alpha').length,
        };

        const invigilators = ((invigilatorRows as any[]) || []).map((inv) => {
            const prof = inv.profiles || profileById.get(inv.user_id as string) || {};
            return {
                user_id: inv.user_id as string,
                full_name: prof.full_name || 'Pengawas Ruang',
                identity_number: prof.identity_number || prof.nis || null,
            };
        });

        const defaultInvigilatorName =
            invigilators.map((i) => i.full_name).filter(Boolean).join(', ') || 'Pengawas Ruang';
        const defaultInvigilatorNip =
            invigilators.map((i) => i.identity_number).filter(Boolean).join(', ') || '-';
        const defaultProctorName =
            (creatorProfile as any)?.full_name || 'Proktor / Panitia Ujian';
        const defaultProctorNip =
            (creatorProfile as any)?.identity_number || (creatorProfile as any)?.nis || '-';

        const savedReport = savedReportRes.data as Record<string, any> | null;
        const configuredChair = await this.committeeChair(this.db, period);
        const signatureVersion = savedReport ? Number(savedReport.signature_version || 1) : 2;
        const committeeChairName = savedReport ? savedReport.committee_chair_name || '' : configuredChair.committee_chair_name;
        const committeeChairNip = savedReport ? savedReport.committee_chair_nip || '' : configuredChair.committee_chair_nip;
        const proctorNip = signatureVersion === 2 && savedReport ? savedReport.proctor_nip || '' : defaultProctorNip;
        const defaultCodes = buildVerificationCodePair(period.id, room.id, session.id, effectiveDate);

        const invigilatorName = savedReport?.invigilator_name || defaultInvigilatorName;
        const proctorName = savedReport?.proctor_name || defaultProctorName;
        const verificationCode = savedReport?.verification_code || defaultCodes.beritaAcaraCode;
        const attendanceVerificationCode =
            savedReport?.attendance_verification_code || defaultCodes.daftarHadirCode;

        const signatureHash =
            savedReport?.signature_hash ||
            computeAdministrationSignatureHash({
                organizationId,
                periodId: period.id,
                roomId: room.id,
                sessionId: session.id,
                examDate: effectiveDate,
                invigilatorName,
                proctorName,
                signatureVersion,
                committeeChairName,
                committeeChairNip,
                proctorNip,
                beritaAcaraCode: verificationCode,
                daftarHadirCode: attendanceVerificationCode,
                counts,
            });

        const ps = (profilSekolahRow || {}) as Record<string, any>;
        const orgName = ps.nama || (organization as any)?.name || 'Madrasah / Sekolah';
        const profilSekolah = {
            nama: orgName,
            jenjang: ps.jenjang || (/\b(MAN|MA)\b/i.test(orgName) ? 'MA' : /\bMTs/i.test(orgName) ? 'MTs' : /\bMI\b/i.test(orgName) ? 'MI' : null),
            jenis: ps.jenis || null,
            alamat: ps.alamat || null,
            desa_kelurahan: ps.desa_kelurahan || null,
            kecamatan: ps.kecamatan || null,
            kabupaten_kota: ps.kabupaten_kota || null,
            provinsi: ps.provinsi || null,
            kode_pos: ps.kode_pos || null,
            telepon: ps.telepon || null,
            email: ps.email || null,
            website: ps.website || null,
            logo_url: ps.logo_url || (organization as any)?.logo_url || null,
            kepala_sekolah_nama: ps.kepala_sekolah_nama || null,
            kepala_sekolah_nip: ps.kepala_sekolah_nip || null,
        };

        return {
            organization: {
                id: organizationId,
                name: orgName,
                logo_url: profilSekolah.logo_url,
            },
            profil_sekolah: profilSekolah,
            period: {
                id: period.id,
                name: period.name,
                type: period.type || 'pas',
                school_year: period.school_year,
                semester: period.semester,
                start_date: cleanDateString(period.start_date),
                end_date: cleanDateString(period.end_date),
                is_locked: Boolean(period.is_locked),
                created_by: period.created_by || null,
                organization_name: orgName,
            },
            room: {
                id: room.id,
                name: room.name,
                capacity: Number(room.capacity) || 0,
            },
            session: {
                id: session.id,
                name: session.name,
                start_time: session.start_time,
                end_time: session.end_time,
            },
            exam_date: effectiveDate,
            available_dates: availableDates,
            schedules: dateSchedules.map((sc) => {
                const bankInfo = sc.bank_id ? bankById.get(sc.bank_id) : undefined;
                const subjName =
                    sc.subjects?.name ||
                    (sc.subject_id ? subjectById.get(sc.subject_id) : undefined) ||
                    sc.question_banks?.subject ||
                    bankInfo?.subject ||
                    '-';
                return {
                    id: sc.id,
                    bank_title: sc.question_banks?.title || bankInfo?.title || 'Bank Soal',
                    subject_name: subjName,
                    class_name: sc.classes?.name || (sc.class_id ? classById.get(sc.class_id) : undefined) || '-',
                    duration_minutes: sc.duration_minutes || 90,
                };
            }),
            invigilators,
            proctor_creator: {
                id: (creatorProfile as any)?.id || period.created_by || null,
                full_name: defaultProctorName,
                identity_number: defaultProctorNip !== '-' ? defaultProctorNip : null,
            },
            committee_chair: configuredChair,
            report: {
                id: savedReport?.id || null,
                is_saved: Boolean(savedReport?.id),
                status: savedReport?.status || (savedReport?.signed_at ? 'approved' : 'draft'),
                notes:
                    savedReport?.notes ??
                    'Pelaksanaan ujian berjalan dengan tertib, aman, dan lancar.',
                incident_summary:
                    savedReport?.incident_summary ??
                    'Tidak ada kendala atau insiden khusus selama pelaksanaan ujian.',
                invigilator_id:
                    savedReport?.invigilator_id || invigilators[0]?.user_id || null,
                invigilator_name: invigilatorName,
                invigilator_nip: defaultInvigilatorNip,
                proctor_id:
                    savedReport?.proctor_id || (creatorProfile as any)?.id || period.created_by || null,
                proctor_name: proctorName,
                proctor_nip: proctorNip,
                committee_chair_name: committeeChairName,
                committee_chair_nip: committeeChairNip,
                signature_version: signatureVersion,
                verification_code: verificationCode,
                attendance_verification_code: attendanceVerificationCode,
                signature_hash: signatureHash,
                signed_at: savedReport?.signed_at || null,
                submitted_at: savedReport?.submitted_at || null,
                submitted_by: savedReport?.submitted_by || null,
                approved_at: savedReport?.approved_at || null,
                approved_by: savedReport?.approved_by || null,
                rejection_note: savedReport?.rejection_note || '',
                updated_at: savedReport?.updated_at || null,
            },
            students,
            counts,
        };
    }

    async saveAdministrationSlot(user: AuthUser, dto: SavePASAdministrationDto) {
        const examDate = cleanDateString(dto.exam_date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
            throw new BadRequestException('Format tanggal pelaksanaan harus YYYY-MM-DD.');
        }

        const { period, room, session, organizationId } = await this.assertSlotAccess(
            user,
            dto.pas_period_id,
            dto.pas_room_id,
            dto.session_id,
        );

        await this.db.transaction(async (db) => {
            await advisoryTransactionLock(
                db,
                `pas-admin-slot:${period.id}:${room.id}:${session.id}:${examDate}`,
            );

            const chair = await this.committeeChair(db, period);
            if (!chair.committee_chair_name) {
                throw new BadRequestException('Nama Ketua Panitia belum diatur pada folder ujian ini. Silakan atur Ketua Panitia terlebih dahulu.');
            }
            const { data: creator, error: creatorError } = await db.from('cbt_profiles')
                .select('id, full_name, identity_number, nis').eq('id', period.created_by).maybeSingle();
            if (creatorError || !period.created_by || !creator?.full_name?.trim()) {
                throw new BadRequestException('Profil pembuat ujian belum tersedia untuk penandatangan Proktor.');
            }
            // Proktor always comes from the folder creator, never from client input.
            const resolvedProctorName = creator.full_name.trim();
            const resolvedProctorNip = creator.identity_number || creator.nis || '';

            // Validate room students
            const { data: roomStudents } = await db
                .from('cbt_pas_room_students')
                .select('user_id')
                .eq('pas_room_id', room.id);

            const validStudentIds = new Set(
                ((roomStudents as Array<{ user_id: string }>) || []).map((r) => r.user_id),
            );

            const incomingAttendances = (dto.attendances || []).filter((item) =>
                validStudentIds.has(item.user_id),
            );

            // Replace attendances for this slot
            const { error: delAttErr } = await db
                .from('cbt_pas_student_attendances')
                .delete()
                .eq('pas_period_id', period.id)
                .eq('pas_room_id', room.id)
                .eq('session_id', session.id)
                .eq('exam_date', examDate);
            if (delAttErr) {
                throw new BadRequestException(`Gagal memperbarui daftar hadir: ${delAttErr.message}`);
            }

            if (incomingAttendances.length > 0) {
                const nowIso = new Date().toISOString();
                const rowsToInsert = incomingAttendances.map((item) => {
                    const normalizedStatus = String(item.status || 'hadir').toLowerCase() as AttendanceStatus;
                    return {
                        pas_period_id: period.id,
                        pas_room_id: room.id,
                        session_id: session.id,
                        exam_date: examDate,
                        user_id: item.user_id,
                        status: VALID_ATTENDANCE_STATUSES.has(normalizedStatus) ? normalizedStatus : 'hadir',
                        remark: String(item.remark || '').trim(),
                        updated_by: user.id,
                        updated_at: nowIso,
                    };
                });

                const { error: insAttErr } = await db
                    .from('cbt_pas_student_attendances')
                    .insert(rowsToInsert);
                if (insAttErr) {
                    throw new BadRequestException(`Gagal menyimpan daftar hadir: ${insAttErr.message}`);
                }
            }

            // Compute attendance counts for digital signature hash
            const statusByStudent = new Map<string, AttendanceStatus>();
            for (const item of incomingAttendances) {
                const st = String(item.status || 'hadir').toLowerCase() as AttendanceStatus;
                statusByStudent.set(item.user_id, VALID_ATTENDANCE_STATUSES.has(st) ? st : 'hadir');
            }
            const counts = {
                total: validStudentIds.size,
                hadir: 0,
                sakit: 0,
                izin: 0,
                alpha: 0,
            };
            for (const studentId of validStudentIds) {
                const st = statusByStudent.get(studentId) || 'hadir';
                counts[st] += 1;
            }

            // Resolve default invigilator and proctor names if not explicitly provided
            let resolvedInvigilatorName = String(dto.invigilator_name || '').trim();
            let resolvedInvigilatorId = dto.invigilator_id || null;
            if (!resolvedInvigilatorName) {
                const { data: invRows } = await db
                    .from('cbt_pas_room_invigilators')
                    .select('user_id')
                    .eq('pas_room_id', room.id)
                    .eq('session_id', session.id);
                const invIds = ((invRows as Array<{ user_id: string }>) || []).map((r) => r.user_id);
                if (!resolvedInvigilatorId && invIds[0]) {
                    resolvedInvigilatorId = invIds[0];
                }
                if (invIds.length > 0) {
                    const { data: invProfiles } = await db
                        .from('cbt_profiles')
                        .select('id, full_name')
                        .in('id', invIds);
                    resolvedInvigilatorName =
                        ((invProfiles as Array<{ full_name: string }>) || [])
                            .map((p) => p.full_name)
                            .filter(Boolean)
                            .join(', ') || 'Pengawas Ruang';
                } else {
                    resolvedInvigilatorName = 'Pengawas Ruang';
                }
            }

            const { data: existingReport } = await db
                .from('cbt_pas_administration_reports')
                .select('id, verification_code, attendance_verification_code')
                .eq('pas_period_id', period.id)
                .eq('pas_room_id', room.id)
                .eq('session_id', session.id)
                .eq('exam_date', examDate)
                .maybeSingle();

            const defaultCodes = buildVerificationCodePair(period.id, room.id, session.id, examDate);
            const verificationCode =
                (existingReport as any)?.verification_code || defaultCodes.beritaAcaraCode;
            const attendanceVerificationCode =
                (existingReport as any)?.attendance_verification_code || defaultCodes.daftarHadirCode;

            const notes =
                dto.notes !== undefined
                    ? String(dto.notes).trim()
                    : 'Pelaksanaan ujian berjalan dengan tertib, aman, dan lancar.';
            const incidentSummary =
                dto.incident_summary !== undefined
                    ? String(dto.incident_summary).trim()
                    : 'Tidak ada kendala atau insiden khusus selama pelaksanaan ujian.';

            const signatureHash = computeAdministrationSignatureHash({
                organizationId,
                periodId: period.id,
                roomId: room.id,
                sessionId: session.id,
                examDate,
                invigilatorName: resolvedInvigilatorName,
                proctorName: resolvedProctorName,
                signatureVersion: 2,
                committeeChairName: chair.committee_chair_name,
                committeeChairNip: chair.committee_chair_nip,
                proctorNip: resolvedProctorNip,
                beritaAcaraCode: verificationCode,
                daftarHadirCode: attendanceVerificationCode,
                counts,
            });

            const nowIso = new Date().toISOString();
            const isManager = await this.isProktorOrAdmin(user, organizationId);
            let finalStatus: 'draft' | 'submitted' | 'approved' = 'submitted';
            let submittedAt: string | null = nowIso;
            let submittedBy: string | null = user.id;
            let approvedAt: string | null = null;
            let approvedBy: string | null = null;

            if (isManager) {
                if (dto.action === 'save_draft') {
                    finalStatus = 'draft';
                    submittedAt = (existingReport as any)?.submitted_at || null;
                    submittedBy = (existingReport as any)?.submitted_by || null;
                } else if (dto.action === 'submit') {
                    finalStatus = 'submitted';
                } else {
                    finalStatus = 'approved';
                    approvedAt = nowIso;
                    approvedBy = user.id;
                    submittedAt = (existingReport as any)?.submitted_at || nowIso;
                    submittedBy = (existingReport as any)?.submitted_by || user.id;
                }
            } else {
                if (dto.action === 'save_draft') {
                    finalStatus = 'draft';
                    submittedAt = null;
                    submittedBy = null;
                } else {
                    finalStatus = 'submitted';
                    submittedAt = nowIso;
                    submittedBy = user.id;
                }
            }

            if ((existingReport as any)?.id) {
                const { error: updErr } = await db
                    .from('cbt_pas_administration_reports')
                    .update({
                        notes,
                        incident_summary: incidentSummary,
                        invigilator_id: resolvedInvigilatorId,
                        invigilator_name: resolvedInvigilatorName,
                        proctor_id: period.created_by,
                        proctor_name: resolvedProctorName,
                        proctor_nip: resolvedProctorNip,
                        committee_chair_name: chair.committee_chair_name,
                        committee_chair_nip: chair.committee_chair_nip,
                        signature_version: 2,
                        signature_hash: signatureHash,
                        signed_at: nowIso,
                        status: finalStatus,
                        submitted_at: submittedAt,
                        submitted_by: submittedBy,
                        approved_at: approvedAt,
                        approved_by: approvedBy,
                        rejection_note: '',
                        updated_by: user.id,
                        updated_at: nowIso,
                    })
                    .eq('id', (existingReport as any).id);
                if (updErr) {
                    throw new BadRequestException(`Gagal memperbarui berita acara: ${updErr.message}`);
                }
            } else {
                const { error: insErr } = await db
                    .from('cbt_pas_administration_reports')
                    .insert({
                        organization_id: organizationId,
                        pas_period_id: period.id,
                        pas_room_id: room.id,
                        session_id: session.id,
                        exam_date: examDate,
                        notes,
                        incident_summary: incidentSummary,
                        invigilator_id: resolvedInvigilatorId,
                        invigilator_name: resolvedInvigilatorName,
                        proctor_id: period.created_by,
                        proctor_name: resolvedProctorName,
                        proctor_nip: resolvedProctorNip,
                        committee_chair_name: chair.committee_chair_name,
                        committee_chair_nip: chair.committee_chair_nip,
                        signature_version: 2,
                        verification_code: verificationCode,
                        attendance_verification_code: attendanceVerificationCode,
                        signature_hash: signatureHash,
                        signed_at: nowIso,
                        status: finalStatus,
                        submitted_at: submittedAt,
                        submitted_by: submittedBy,
                        approved_at: approvedAt,
                        approved_by: approvedBy,
                        rejection_note: '',
                        updated_by: user.id,
                        updated_at: nowIso,
                    });
                if (insErr) {
                    throw new BadRequestException(`Gagal menyimpan berita acara: ${insErr.message}`);
                }
            }
        });

        return this.getAdministrationSlot(user, {
            periodId: period.id,
            roomId: room.id,
            sessionId: session.id,
            examDate,
        });
    }

    async approveAdministrationSlot(user: AuthUser, dto: ApprovePASAdministrationDto) {
        const examDate = cleanDateString(dto.exam_date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
            throw new BadRequestException('Format tanggal pelaksanaan harus YYYY-MM-DD.');
        }

        const { period, room, session, organizationId } = await this.assertSlotAccess(
            user,
            dto.pas_period_id,
            dto.pas_room_id,
            dto.session_id,
        );

        await this.authz.assertProktor(user, organizationId);

        const { data: creator } = await this.db
            .from('cbt_profiles')
            .select('id, full_name, identity_number, nis')
            .eq('id', user.id)
            .maybeSingle();
        const resolvedProctorName = creator?.full_name?.trim() || user.fullName || user.email || 'Proktor Ujian';
        const resolvedProctorNip = creator?.identity_number || creator?.nis || '';

        const nowIso = new Date().toISOString();

        const { data: existingReport } = await this.db
            .from('cbt_pas_administration_reports')
            .select('*')
            .eq('pas_period_id', period.id)
            .eq('pas_room_id', room.id)
            .eq('session_id', session.id)
            .eq('exam_date', examDate)
            .maybeSingle();

        if (!existingReport) {
            await this.saveAdministrationSlot(user, {
                ...dto,
                action: 'approve',
            });
        } else {
            const { error: updErr } = await this.db
                .from('cbt_pas_administration_reports')
                .update({
                    status: 'approved',
                    approved_at: nowIso,
                    approved_by: user.id,
                    proctor_id: user.id,
                    proctor_name: resolvedProctorName,
                    proctor_nip: resolvedProctorNip,
                    rejection_note: '',
                    updated_by: user.id,
                    updated_at: nowIso,
                })
                .eq('id', (existingReport as any).id);

            if (updErr) {
                throw new BadRequestException(`Gagal menyetujui berita acara: ${updErr.message}`);
            }
        }

        return this.getAdministrationSlot(user, {
            periodId: period.id,
            roomId: room.id,
            sessionId: session.id,
            examDate,
        });
    }

    async rejectAdministrationSlot(user: AuthUser, dto: RejectPASAdministrationDto) {
        const examDate = cleanDateString(dto.exam_date);
        const { period, room, session, organizationId } = await this.assertSlotAccess(
            user,
            dto.pas_period_id,
            dto.pas_room_id,
            dto.session_id,
        );

        await this.authz.assertProktor(user, organizationId);

        const nowIso = new Date().toISOString();
        const note = String(dto.rejection_note || 'Perlu perbaikan oleh pengawas ruang').trim();

        const { error: updErr } = await this.db
            .from('cbt_pas_administration_reports')
            .update({
                status: 'rejected',
                rejection_note: note,
                updated_by: user.id,
                updated_at: nowIso,
            })
            .eq('pas_period_id', period.id)
            .eq('pas_room_id', room.id)
            .eq('session_id', session.id)
            .eq('exam_date', examDate);

        if (updErr) {
            throw new BadRequestException(`Gagal mengembalikan berita acara: ${updErr.message}`);
        }

        return this.getAdministrationSlot(user, {
            periodId: period.id,
            roomId: room.id,
            sessionId: session.id,
            examDate,
        });
    }

    async getPeriodAdministrationOverview(user: AuthUser, periodId: string) {
        const { data: period } = await this.db
            .from('cbt_pas_periods')
            .select('id, organization_id, name')
            .eq('id', periodId)
            .maybeSingle();

        if (!period) throw new NotFoundException('Periode ujian tidak ditemukan.');
        const organizationId = (period as any).organization_id as string;
        await this.authz.assertOrgStaff(user, organizationId);

        const [
            { data: rooms },
            { data: sessions },
            { data: schedules },
            { data: reports },
            { data: studentAttendances },
        ] = await Promise.all([
            this.db
                .from('cbt_pas_rooms')
                .select(
                    `id, name, capacity,
                     pas_room_invigilators:cbt_pas_room_invigilators!pas_room_id(user_id, session_id, profiles:cbt_profiles!user_id(full_name)),
                     pas_room_students:cbt_pas_room_students!cbt_pas_room_students_pas_room_id_fkey(user_id)`,
                )
                .eq('pas_period_id', periodId)
                .order('name'),
            this.db
                .from('cbt_pas_sessions')
                .select('id, name, start_time, end_time')
                .eq('pas_period_id', periodId)
                .order('start_time'),
            this.db
                .from('cbt_pas_class_schedules')
                .select('id, session_id, scheduled_date')
                .eq('pas_period_id', periodId),
            this.db
                .from('cbt_pas_administration_reports')
                .select('id, pas_room_id, session_id, exam_date, status, invigilator_name, proctor_name, verification_code, attendance_verification_code, submitted_at, approved_at, notes, incident_summary, rejection_note')
                .eq('pas_period_id', periodId),
            this.db
                .from('cbt_pas_student_attendances')
                .select('pas_room_id, session_id, exam_date, status')
                .eq('pas_period_id', periodId),
        ]);

        const roomList = ((rooms as any[]) || []);
        const sessionList = ((sessions as any[]) || []).map((s) => ({
            ...s,
            start_time: normalizeSqlTime(s.start_time) || '07:30:00',
            end_time: normalizeSqlTime(s.end_time) || '09:30:00',
        }));
        const scheduleList = ((schedules as any[]) || []);
        const reportList = ((reports as any[]) || []);
        const attendanceList = ((studentAttendances as any[]) || []);

        const overview: Array<Record<string, any>> = [];

        const allDates = [
            ...new Set(
                scheduleList.map((sc) => cleanDateString(sc.scheduled_date)).filter(Boolean),
            ),
        ].sort();

        const effectiveDates = allDates.length > 0 ? allDates : [cleanDateString(new Date())];

        for (const date of effectiveDates) {
            for (const session of sessionList) {
                const hasSchedule = scheduleList.some(
                    (sc) => sc.session_id === session.id && cleanDateString(sc.scheduled_date) === date,
                );
                const hasExistingReport = reportList.some(
                    (r) => r.session_id === session.id && cleanDateString(r.exam_date) === date,
                );
                if (!hasSchedule && !hasExistingReport && scheduleList.length > 0) continue;

                for (const room of roomList) {
                    const invigilators = ((room.pas_room_invigilators as any[]) || [])
                        .filter((inv) => inv.session_id === session.id)
                        .map((inv) => inv.profiles?.full_name || 'Pengawas')
                        .filter(Boolean);

                    const studentCount = ((room.pas_room_students as any[]) || []).length;

                    const report = reportList.find(
                        (r) =>
                            r.pas_room_id === room.id &&
                            r.session_id === session.id &&
                            cleanDateString(r.exam_date) === date,
                    );

                    const slotAttendances = attendanceList.filter(
                        (a) =>
                            a.pas_room_id === room.id &&
                            a.session_id === session.id &&
                            cleanDateString(a.exam_date) === date,
                    );

                    const hadirCount = slotAttendances.filter((a) => a.status === 'hadir').length;
                    const sakitCount = slotAttendances.filter((a) => a.status === 'sakit').length;
                    const izinCount = slotAttendances.filter((a) => a.status === 'izin').length;
                    const alphaCount = slotAttendances.filter((a) => a.status === 'alpha').length;

                    overview.push({
                        room_id: room.id,
                        room_name: room.name,
                        session_id: session.id,
                        session_name: session.name,
                        start_time: session.start_time,
                        end_time: session.end_time,
                        exam_date: date,
                        assigned_invigilators: invigilators,
                        student_count: studentCount,
                        report_id: report?.id || null,
                        status: report?.status || (report?.signed_at ? 'approved' : 'draft'),
                        invigilator_name: report?.invigilator_name || invigilators.join(', ') || '-',
                        proctor_name: report?.proctor_name || '-',
                        submitted_at: report?.submitted_at || null,
                        approved_at: report?.approved_at || null,
                        rejection_note: report?.rejection_note || '',
                        verification_code: report?.verification_code,
                        attendance_verification_code: report?.attendance_verification_code,
                        counts: {
                            total: studentCount,
                            hadir: hadirCount,
                            sakit: sakitCount,
                            izin: izinCount,
                            alpha: alphaCount,
                        },
                    });
                }
            }
        }

        return overview;
    }

    async verifyDocumentByCode(rawCode: string) {
        const code = String(rawCode || '').trim().toUpperCase();
        if (!code) {
            return { verified: false, valid: false, message: 'Kode verifikasi tidak boleh kosong.' };
        }

        const { data: byBa } = await this.db
            .from('cbt_pas_administration_reports')
            .select('*')
            .eq('verification_code', code)
            .maybeSingle();

        const { data: byDh } = !byBa
            ? await this.db
                  .from('cbt_pas_administration_reports')
                  .select('*')
                  .eq('attendance_verification_code', code)
                  .maybeSingle()
            : { data: null };

        const report = (byBa || byDh) as Record<string, any> | null;
        if (!report) {
            return {
                verified: false,
                valid: false,
                code,
                verification_code: code,
                message: 'Dokumen dengan kode verifikasi ini tidak ditemukan atau belum disahkan di sistem.',
            };
        }

        const documentType = byBa ? 'berita_acara' : 'daftar_hadir';
        const documentLabel = byBa ? 'Berita Acara Pelaksanaan Ujian' : 'Daftar Hadir Peserta Ujian';
        const examDate = cleanDateString(report.exam_date);

        const [
            { data: organization },
            { data: period },
            { data: room },
            { data: session },
            { data: roomStudents },
            { data: attendances },
            { data: schedules },
        ] = await Promise.all([
            this.db
                .from('cbt_organizations')
                .select('id, name, logo_url')
                .eq('id', report.organization_id)
                .maybeSingle(),
            this.db
                .from('cbt_pas_periods')
                .select('id, name, type, school_year, semester')
                .eq('id', report.pas_period_id)
                .maybeSingle(),
            this.db
                .from('cbt_pas_rooms')
                .select('id, name, capacity')
                .eq('id', report.pas_room_id)
                .maybeSingle(),
            this.db
                .from('cbt_pas_sessions')
                .select('id, name, start_time, end_time')
                .eq('id', report.session_id)
                .maybeSingle(),
            this.db
                .from('cbt_pas_room_students')
                .select('user_id, profiles:cbt_profiles!user_id(full_name)')
                .eq('pas_room_id', report.pas_room_id),
            this.db
                .from('cbt_pas_student_attendances')
                .select('user_id, status, remark')
                .eq('pas_period_id', report.pas_period_id)
                .eq('pas_room_id', report.pas_room_id)
                .eq('session_id', report.session_id)
                .eq('exam_date', examDate),
            this.db
                .from('cbt_pas_class_schedules')
                .select('id, scheduled_date, classes:cbt_classes(name), question_banks:cbt_question_banks(title, subject)')
                .eq('pas_period_id', report.pas_period_id)
                .eq('session_id', report.session_id)
                .eq('scheduled_date', examDate),
        ]);

        const studentRows = ((roomStudents as any[]) || []);
        const attMap = new Map<string, { status: AttendanceStatus; remark: string }>();
        for (const a of ((attendances as any[]) || [])) {
            const st = String(a.status || 'hadir').toLowerCase() as AttendanceStatus;
            attMap.set(a.user_id, {
                status: VALID_ATTENDANCE_STATUSES.has(st) ? st : 'hadir',
                remark: String(a.remark || ''),
            });
        }

        const counts = {
            total: studentRows.length,
            hadir: 0,
            sakit: 0,
            izin: 0,
            alpha: 0,
        };
        const nonPresentStudents: Array<{ full_name: string; status: AttendanceStatus; remark: string }> = [];

        for (const s of studentRows) {
            const att = attMap.get(s.user_id);
            const st = att?.status || 'hadir';
            counts[st] += 1;
            if (st !== 'hadir') {
                nonPresentStudents.push({
                    full_name: s.profiles?.full_name || 'Peserta',
                    status: st,
                    remark: att?.remark || '',
                });
            }
        }

        const expectedHash = computeAdministrationSignatureHash({
            organizationId: report.organization_id,
            periodId: report.pas_period_id,
            roomId: report.pas_room_id,
            sessionId: report.session_id,
            examDate,
            invigilatorName: report.invigilator_name || '',
            proctorName: report.proctor_name || '',
            signatureVersion: Number(report.signature_version || 1),
            committeeChairName: report.committee_chair_name || '',
            committeeChairNip: report.committee_chair_nip || '',
            proctorNip: report.proctor_nip || '',
            beritaAcaraCode: report.verification_code,
            daftarHadirCode: report.attendance_verification_code,
            counts,
        });

        const integrityValid = report.signature_hash === expectedHash;

        return {
            verified: true,
            valid: true,
            integrity_valid: integrityValid,
            integrity_verified: integrityValid,
            code,
            verification_code: code,
            document_type: documentType,
            document_label: documentLabel,
            document_title: documentLabel,
            paired_codes: {
                berita_acara: report.verification_code,
                daftar_hadir: report.attendance_verification_code,
            },
            attendance_verification_code: report.attendance_verification_code,
            signature_hash: report.signature_hash,
            signed_at: report.signed_at,
            organization_name: (organization as any)?.name || 'Madrasah / Sekolah',
            period: {
                id: (period as any)?.id || report.pas_period_id,
                name: (period as any)?.name || 'Periode Ujian',
                school_year: (period as any)?.school_year || '-',
                semester: (period as any)?.semester || '-',
            },
            room: {
                id: (room as any)?.id || report.pas_room_id,
                name: (room as any)?.name || '-',
                capacity: Number((room as any)?.capacity) || 0,
            },
            session: {
                id: (session as any)?.id || report.session_id,
                name: (session as any)?.name || '-',
                start_time: normalizeSqlTime((session as any)?.start_time) || '07:30:00',
                end_time: normalizeSqlTime((session as any)?.end_time) || '09:30:00',
            },
            exam_date: examDate,
            schedules: ((schedules as any[]) || []).map((sc) => ({
                bank_title: sc.question_banks?.title || 'Bank Soal',
                subject_name: sc.question_banks?.subject || '-',
                class_name: sc.classes?.name || '-',
            })),
            invigilator_name: report.invigilator_name || 'Pengawas Ruang',
            proctor_name: report.proctor_name || 'Proktor Ujian',
            committee_chair_name: report.committee_chair_name || '',
            committee_chair_nip: report.committee_chair_nip || '',
            signature_version: Number(report.signature_version || 1),
            notes: report.notes || '',
            incident_summary: report.incident_summary || '',
            counts,
            non_present_students: nonPresentStudents,
        };
    }
}
