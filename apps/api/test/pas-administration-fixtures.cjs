function createFixtures() {
    return {
        acca_settings: [{ key: 'exam_administration', value: {
            committee_chair_name: 'Dr. Ketua Panitia, M.Pd.',
            committee_chair_nip: '197001012000011001',
        } }],
        profil_sekolah: [
            {
                id: 1,
                nama: 'MAN Insan Cendekia Gowa',
                jenjang: 'MA',
                jenis: 'Madrasah',
                alamat: 'Jl. Pendidikan Desa Belapunrangan',
                kecamatan: 'Parangloe',
                kabupaten_kota: 'Gowa',
                provinsi: 'Sulawesi Selatan',
                kode_pos: '92173',
                telepon: '085173279846',
                email: 'insancendekiagowa@gmail.com',
                website: 'icgowa.sch.id',
                logo_url: 'https://tiny-field-c83e.imbank8993.workers.dev/profil_sekolah/logo.png',
                kepala_sekolah_nama: 'Burhanuddin',
                kepala_sekolah_nip: '197808142006041002',
            },
        ],
        cbt_organizations: [
            { id: 'org-1', name: 'MAN Insan Cendekia Gowa' },
        ],
        cbt_pas_periods: [
            {
                id: 'period-1',
                organization_id: 'org-1',
                name: 'PAS Ganjil 2026',
                type: 'pas',
                school_year: '2026/2027',
                semester: 'Ganjil',
                start_date: '2026-10-15',
                end_date: '2026-10-25',
                is_locked: false,
                created_by: 'proctor-creator-1',
            },
        ],
        cbt_pas_rooms: [
            { id: 'room-1', pas_period_id: 'period-1', name: 'Lab Komputer 1', capacity: 30 },
            { id: 'room-2', pas_period_id: 'period-1', name: 'Lab Komputer 2', capacity: 30 },
        ],
        cbt_pas_sessions: [
            { id: 'session-1', pas_period_id: 'period-1', name: 'Sesi 1', start_time: '07:30:00', end_time: '09:30:00' },
            { id: 'session-2', pas_period_id: 'period-1', name: 'Sesi 2', start_time: '10:00:00', end_time: '12:00:00' },
        ],
        cbt_pas_room_students: [
            { id: 'rs-1', pas_room_id: 'room-1', user_id: 'student-1' },
            { id: 'rs-2', pas_room_id: 'room-1', user_id: 'student-2' },
            { id: 'rs-3', pas_room_id: 'room-1', user_id: 'student-3' },
        ],
        cbt_pas_room_invigilators: [
            { id: 'inv-map-1', pas_room_id: 'room-1', session_id: 'session-1', user_id: 'pengawas-1', exam_date: '2026-10-17' },
        ],
        cbt_profiles: [
            { id: 'proctor-creator-1', full_name: 'Budi Santoso, S.Kom.', nis: '19880101', email: 'proktor@icgowa.sch.id' },
            { id: 'pengawas-1', full_name: 'Dra. Siti Aminah, M.Pd.', nis: '19790512', email: 'siti@icgowa.sch.id' },
            { id: 'student-1', full_name: 'Ahmad Fauzan', nis: '24001', email: 'ahmad@siswa.id' },
            { id: 'student-2', full_name: 'Nadia Putri', nis: '24002', email: 'nadia@siswa.id' },
            { id: 'student-3', full_name: 'Rizky Ramadhan', nis: '24003', email: 'rizky@siswa.id' },
        ],
        cbt_classes: [
            { id: 'class-10a', organization_id: 'org-1', name: 'X MIPA 1' },
            { id: 'class-11b', organization_id: 'org-1', name: 'XI IPS 1' },
        ],
        cbt_class_members: [
            { id: 'cm-1', class_id: 'class-10a', user_id: 'student-1', role: 'siswa' },
            { id: 'cm-2', class_id: 'class-10a', user_id: 'student-2', role: 'siswa' },
            { id: 'cm-3', class_id: 'class-10a', user_id: 'student-3', role: 'siswa' },
        ],
        cbt_subjects: [
            { id: 'subj-math', organization_id: 'org-1', name: 'Matematika Wajib' },
            { id: 'subj-econ', organization_id: 'org-1', name: 'Ekonomi' },
        ],
        cbt_question_banks: [
            { id: 'bank-math', organization_id: 'org-1', title: 'Bank PAS Matematika X', subject: 'Matematika Wajib' },
            { id: 'bank-econ', organization_id: 'org-1', title: 'Bank PAS Ekonomi XI', subject: 'Ekonomi' },
        ],
        cbt_pas_class_schedules: [
            {
                id: 'sched-1',
                pas_period_id: 'period-1',
                session_id: 'session-1',
                class_id: 'class-10a',
                subject_id: 'subj-math',
                bank_id: 'bank-math',
                exam_id: 'exam-math-1',
                scheduled_date: '2026-10-17',
                scheduled_time: '07:30:00',
                window_end_time: '09:30:00',
                duration_minutes: 90,
                room: 'Lab Komputer 1',
                status: 'active',
            },
            {
                id: 'sched-other-room',
                pas_period_id: 'period-1',
                session_id: 'session-1',
                class_id: 'class-11b',
                subject_id: 'subj-econ',
                bank_id: 'bank-econ',
                exam_id: 'exam-econ-1',
                scheduled_date: '2026-10-17',
                scheduled_time: '07:30:00',
                window_end_time: '09:30:00',
                duration_minutes: 90,
                room: 'Lab Komputer 2',
                status: 'active',
            },
        ],
        cbt_pas_room_schedules: [
            { id: 'prs-1', pas_room_id: 'room-1', schedule_id: 'sched-1' },
            { id: 'prs-2', pas_room_id: 'room-2', schedule_id: 'sched-other-room' },
        ],
        cbt_exam_attempts: [
            {
                id: 'att-1',
                exam_id: 'exam-math-1',
                user_id: 'student-1',
                status: 'finished',
                started_at: '2026-10-17T07:32:00.000Z',
                finished_at: '2026-10-17T08:55:00.000Z',
            },
        ],
        cbt_pas_administration_reports: [],
        cbt_pas_student_attendances: [],
    };
}

function createAuthzMock(proktorIds = ['proctor-creator-1']) {
    return {
        assertOrgStaff: async () => {},
        assertOrgMonitoring: async () => {},
        assertProktorByRecord: async () => {},
        assertProktor: async (user) => {
            if (!user.isPlatformAdmin && !proktorIds.includes(user.id)) {
                const err = new Error('Forbidden');
                err.status = 403;
                throw err;
            }
        },
    };
}


function signingInput() {
    return {
        pas_period_id: 'period-1', pas_room_id: 'room-1', session_id: 'session-1', exam_date: '2026-10-17',
        attendances: [{ user_id: 'student-1', status: 'hadir' }, { user_id: 'student-2', status: 'sakit' }, { user_id: 'student-3', status: 'izin' }],
    };
}


module.exports = { createFixtures, createAuthzMock, signingInput };
