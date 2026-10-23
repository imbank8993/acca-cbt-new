// Run from repository root: node --test apps/api/test/pas-administration-stage39.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

const { fixtureDb } = require('./fixture-db.cjs');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { SettingsController } = require('../src/settings/settings.controller.ts');
const { PasController } = require('../src/pas/pas.controller.ts');
const { PasService } = require('../src/pas/pas.service.ts');
const { drawAdministrationSigners, resolveAdministrationInvigilators } = require('../../web/lib/pas/administration-signers.ts');
const { jsPDF } = require('jspdf');
const {
    PasAdministrationService,
    buildVerificationCodePair,
    computeAdministrationSignatureHash,
} = require('../src/pas/pas-administration.service.ts');
const {
    generateQrMatrix,
    generateQrSvgDataUrl,
} = require('../../web/lib/pas/qr-svg.ts');
const {
    formatKopParts,
    renderKopHTML,
} = require('../../web/lib/pas/print-kop.ts');

const { createFixtures, createAuthzMock, signingInput } = require('./pas-administration-fixtures.cjs');

test('ADMIN-01: RoomManagementModal memisahkan Pengawas dari modal detail ruang ke view tersendiri', () => {
    for (const roleDir of ['admin', 'proktor']) {
        const modalSource = fs.readFileSync(
            path.resolve(__dirname, '../../web/app/components/pas/RoomManagementPanel.tsx'),
            'utf8',
        );
        assert.match(modalSource, /view\??:\s*'rooms'\s*\|\s*'sessions'\s*\|\s*'invigilators'/);
        assert.match(modalSource, /Pemetaan Pengawas Ruang & Sesi/);
        assert.doesNotMatch(modalSource, /useState<'students'\s*\|\s*'proctors'\s*\|\s*'schedules'>/);
    }
});

test('ADMIN-02: Halaman detail periode PAS Admin & Proktor menampilkan tab Pengawas dan Administrasi', () => {
    for (const roleDir of ['admin', 'proktor']) {
        const pageSource = fs.readFileSync(
            path.resolve(__dirname, `../../web/app/dashboard/${roleDir}/exams/pas/[id]/page.tsx`),
            'utf8',
        );
        assert.match(pageSource, /'invigilators'/);
        assert.match(pageSource, /'administration'/);
        assert.match(pageSource, /<PASAdministrationPanel/);
    }
});

for (const assessmentType of ['pas', 'pat', 'am']) test(`ADMIN-03 ${assessmentType}: administration loads participants, times and invigilators`, async () => {
    const db = fixtureDb(createFixtures());
    db.tables.cbt_pas_periods[0].type = assessmentType;
    const service = new PasAdministrationService(db, createAuthzMock());
    const pengawasUser = { id: 'pengawas-1', isPlatformAdmin: false };

    const slot = await service.getAdministrationSlot(pengawasUser, {
        periodId: 'period-1',
        roomId: 'room-1',
        sessionId: 'session-1',
        examDate: '2026-10-17',
    });

    assert.equal(slot.room.name, 'Lab Komputer 1');
    assert.equal(slot.session.name, 'Sesi 1');
    assert.equal(slot.report.invigilator_name, 'Dra. Siti Aminah, M.Pd.');
    assert.equal(slot.report.invigilator_nip, '19790512');
    assert.equal(slot.report.proctor_name, 'Budi Santoso, S.Kom.');
    assert.equal(slot.report.proctor_nip, '19880101');
    assert.equal(slot.students.length, 3);
    assert.equal(slot.period.type, assessmentType);

    const ahmad = slot.students.find((s) => s.user_id === 'student-1');
    assert.equal(ahmad.class_name, 'X MIPA 1');
    assert.equal(ahmad.started_at, '2026-10-17T07:32:00.000Z');
    assert.equal(ahmad.finished_at, '2026-10-17T08:55:00.000Z');
    assert.equal(ahmad.attendance_status, 'hadir');
});

test('ADMIN-04: Pengawas ditolak mengakses ruang dan sesi yang tidak ditugaskan kepadanya', async () => {
    const db = fixtureDb(createFixtures());
    const service = new PasAdministrationService(db, createAuthzMock());
    const pengawasUser = { id: 'pengawas-1', isPlatformAdmin: false };

    await assert.rejects(
        () =>
            service.getAdministrationSlot(pengawasUser, {
                periodId: 'period-1',
                roomId: 'room-2',
                sessionId: 'session-1',
                examDate: '2026-10-17',
            }),
        /tidak ditugaskan sebagai pengawas/i,
    );
});

for (const assessmentType of ['pas', 'pat', 'am']) test(`ADMIN-05 ${assessmentType}: attendance and signed reports support public verification`, async () => {
    const db = fixtureDb(createFixtures());
    db.tables.cbt_pas_periods[0].type = assessmentType;
    const service = new PasAdministrationService(db, createAuthzMock());
    const pengawasUser = { id: 'pengawas-1', isPlatformAdmin: false };

    const saved = await service.saveAdministrationSlot(pengawasUser, {
        pas_period_id: 'period-1',
        pas_room_id: 'room-1',
        session_id: 'session-1',
        exam_date: '2026-10-17',
        notes: 'Ujian berlangsung tertib dan lancar.',
        incident_summary: '1 peserta sakit dan 1 peserta izin.',
        attendances: [
            { user_id: 'student-1', status: 'hadir', remark: '' },
            { user_id: 'student-2', status: 'sakit', remark: 'Surat keterangan dokter' },
            { user_id: 'student-3', status: 'izin', remark: 'Dispensasi lomba OSN' },
        ],
    });

    assert.equal(saved.counts.total, 3);
    assert.equal(saved.counts.hadir, 1);
    assert.equal(saved.counts.sakit, 1);
    assert.equal(saved.counts.izin, 1);
    assert.equal(saved.counts.alpha, 0);
    assert.equal(saved.report.committee_chair_name, 'Dr. Ketua Panitia, M.Pd.');
    assert.equal(saved.report.committee_chair_nip, '197001012000011001');
    assert.equal(saved.report.signature_version, 3);
    assert.ok(saved.report.signed_at);
    assert.match(saved.report.verification_code, /^BA-PAS-20261017-/);
    assert.match(saved.report.attendance_verification_code, /^DH-PAS-20261017-/);

    await service.approveAdministrationSlot({ id: 'proctor-creator-1' }, signingInput());
    // Verifikasi keaslian dokumen Berita Acara
    const verifyBa = await service.verifyDocumentByCode(saved.report.verification_code);
    assert.equal(verifyBa.verified, true);
    assert.equal(verifyBa.integrity_valid, true);
    assert.equal(verifyBa.document_type, 'berita_acara');
    assert.equal(verifyBa.invigilator_name, 'Dra. Siti Aminah, M.Pd.');
    assert.equal(verifyBa.proctor_name, 'Budi Santoso, S.Kom.');
    assert.deepEqual(verifyBa.counts, { total: 3, hadir: 1, sakit: 1, izin: 1, alpha: 0 });

    // Verifikasi keaslian dokumen Daftar Hadir
    const verifyDh = await service.verifyDocumentByCode(saved.report.attendance_verification_code);
    assert.equal(verifyDh.verified, true);
    assert.equal(verifyDh.integrity_valid, true);
    assert.equal(verifyDh.document_type, 'daftar_hadir');

    // Jika data dimanipulasi di database, integrity_valid harus bernilai false
    db.tables.cbt_pas_administration_reports[0].invigilator_name = 'Nama Palsu';
    const tampered = await service.verifyDocumentByCode(saved.report.verification_code);
    assert.equal(tampered.integrity_valid, false);
});

test('ADMIN: dokumen menyimpan semua pengawas pada tanggal slot meskipun klien memilih satu nama', async () => {
    const db = fixtureDb(createFixtures());
    db.tables.cbt_profiles.push(
        { id: 'pengawas-2', full_name: 'Ahmad Rifai, S.Pd.', nis: '19850203' },
        { id: 'pengawas-3', full_name: 'Pengawas Hari Lain', nis: '19860101' },
    );
    db.tables.cbt_pas_room_invigilators.push(
        { id: 'inv-map-2', pas_room_id: 'room-1', session_id: 'session-1', exam_date: '2026-10-17', user_id: 'pengawas-2' },
        { id: 'inv-map-3', pas_room_id: 'room-1', session_id: 'session-1', exam_date: '2026-10-18', user_id: 'pengawas-3' },
    );
    const service = new PasAdministrationService(db, createAuthzMock());
    const saved = await service.saveAdministrationSlot({ id: 'pengawas-1' }, {
        ...signingInput(), invigilator_id: 'pengawas-1', invigilator_name: 'Dra. Siti Aminah, M.Pd.',
    });
    assert.ok(!saved.report.invigilator_id);
    assert.equal(saved.report.invigilator_name, 'Ahmad Rifai, S.Pd., Dra. Siti Aminah, M.Pd.');
    assert.doesNotMatch(saved.report.invigilator_name, /Hari Lain/);
});

test('ADMIN-06: QR Code SVG generator menghasilkan matriks dan data URL SVG yang valid untuk dokumen A4', () => {
    const codes = buildVerificationCodePair('period-1', 'room-1', 'session-1', '2026-10-17');
    const matrix = generateQrMatrix(`https://cbt.icgowa.sch.id/verify/${codes.beritaAcaraCode}`);
    assert.ok(matrix.length >= 21);
    assert.equal(matrix.length, matrix[0].length);

    const dataUrl = generateQrSvgDataUrl(`https://cbt.icgowa.sch.id/verify/${codes.beritaAcaraCode}`);
    assert.match(dataUrl, /^data:image\/svg\+xml;utf8,/);
});

test('ADMIN-07: KOP profil_sekolah identik dengan KOP Laporan Guru Asuh acca-new & jadwal difilter sesuai ruang', async () => {
    const db = fixtureDb(createFixtures());
    const service = new PasAdministrationService(db, createAuthzMock());
    const pengawasUser = { id: 'pengawas-1', isPlatformAdmin: false };

    const slot = await service.getAdministrationSlot(pengawasUser, {
        periodId: 'period-1',
        roomId: 'room-1',
        sessionId: 'session-1',
        examDate: '2026-10-17',
    });

    // Pastikan jadwal dari Lab Komputer 2 (Ekonomi) tidak bocor ke Lab Komputer 1 (Matematika Wajib)
    assert.equal(slot.schedules.length, 1);
    assert.equal(slot.schedules[0].subject_name, 'Matematika Wajib');

    // Pastikan profil_sekolah dimuat dan menghasilkan KOP Kementerian Agama yang sama dengan Laporan Guru Asuh acca-new
    assert.ok(slot.profil_sekolah);
    assert.equal(slot.profil_sekolah.nama, 'MAN Insan Cendekia Gowa');
    const parts = formatKopParts(slot.profil_sekolah);
    assert.equal(parts.isMadrasah, true);
    assert.equal(parts.kemenagLine1, 'KEMENTERIAN AGAMA REPUBLIK INDONESIA');
    assert.equal(parts.kemenagLine2, 'KANTOR KEMENTERIAN AGAMA KABUPATEN GOWA');
    assert.equal(parts.namaMadrasah, 'MAN INSAN CENDEKIA GOWA');

    const kopHtml = renderKopHTML(slot.profil_sekolah);
    assert.match(kopHtml, /KEMENTERIAN AGAMA REPUBLIK INDONESIA/);
    assert.match(kopHtml, /KANTOR KEMENTERIAN AGAMA KABUPATEN GOWA/);
    assert.match(kopHtml, /MAN INSAN CENDEKIA GOWA/);
    assert.match(kopHtml, /kop-rule-thick/);
    assert.match(kopHtml, /kop-rule-thin/);
});

for (const type of ['pas', 'pat', 'am']) test(`ADMIN-08 ${type}: signer identity comes from creator and configured chair, not API overrides`, async () => {
    const db = fixtureDb(createFixtures()); db.tables.cbt_pas_periods[0].type = type;
    const service = new PasAdministrationService(db, createAuthzMock());
    const saved = await service.saveAdministrationSlot({ id: 'pengawas-1' }, {
        ...signingInput(), proctor_id: 'pengawas-1', proctor_name: 'Proktor Palsu', committee_chair_name: 'Ketua Palsu',
    });
    assert.equal(saved.report.proctor_id, 'proctor-creator-1');
    assert.equal(saved.report.proctor_name, 'Budi Santoso, S.Kom.');
    assert.equal(saved.report.proctor_nip, '19880101');
    assert.equal(saved.report.committee_chair_name, 'Dr. Ketua Panitia, M.Pd.');
    await service.approveAdministrationSlot({ id: 'proctor-creator-1' }, signingInput());
    assert.equal((await service.verifyDocumentByCode(saved.report.verification_code)).committee_chair_name, saved.report.committee_chair_name);
});

test('ADMIN-09: missing chair or creator blocks signing without changing attendance or reports', async () => {
    for (const mutate of [
        db => { db.tables.acca_settings = []; },
        db => { db.tables.cbt_profiles = db.tables.cbt_profiles.filter(p => p.id !== 'proctor-creator-1'); },
    ]) {
        const db = fixtureDb(createFixtures()); mutate(db);
        const service = new PasAdministrationService(db, createAuthzMock());
        await assert.rejects(service.saveAdministrationSlot({ id: 'pengawas-1' }, signingInput()), /Ketua Panitia|Profil pembuat/);
        assert.equal(db.writes.length, 0);
    }
});

test('ADMIN-10: settings changes leave signed snapshots valid; tampered chair data fails verification', async () => {
    const db = fixtureDb(createFixtures());
    const service = new PasAdministrationService(db, createAuthzMock());
    const saved = await service.saveAdministrationSlot({ id: 'pengawas-1' }, signingInput());
    await service.approveAdministrationSlot({ id: 'proctor-creator-1' }, signingInput());
    const original = saved.report.committee_chair_name;
    db.tables.acca_settings[0].value.committee_chair_name = 'Ketua Panitia Baru';
    db.tables.cbt_profiles.find(p => p.id === 'proctor-creator-1').full_name = 'Nama Profil Terbaru';
    const loaded = await service.getAdministrationSlot({ id: 'pengawas-1' }, { periodId: 'period-1', roomId: 'room-1', sessionId: 'session-1', examDate: '2026-10-17' });
    assert.equal(loaded.report.committee_chair_name, original);
    assert.equal(loaded.committee_chair.committee_chair_name, 'Ketua Panitia Baru');
    assert.equal(loaded.report.proctor_name, 'Budi Santoso, S.Kom.');
    assert.equal((await service.verifyDocumentByCode(saved.report.verification_code)).integrity_valid, true);
    db.tables.cbt_pas_administration_reports[0].committee_chair_nip = 'nip-diubah';
    assert.equal((await service.verifyDocumentByCode(saved.report.verification_code)).integrity_valid, false);
    await service.rejectAdministrationSlot({ id: 'proctor-creator-1' }, signingInput());
    const resigned = await service.saveAdministrationSlot({ id: 'pengawas-1' }, signingInput());
    assert.equal(resigned.report.committee_chair_name, 'Ketua Panitia Baru');
    assert.equal(resigned.report.proctor_name, 'Nama Profil Terbaru');
    await service.approveAdministrationSlot({ id: 'proctor-creator-1' }, signingInput());
    assert.equal((await service.verifyDocumentByCode(saved.report.verification_code)).integrity_valid, true);
});

test('ADMIN-11: legacy signatures require explicit reapproval for full-content verification', async () => {
    const db = fixtureDb(createFixtures());
    const service = new PasAdministrationService(db, createAuthzMock());
    const saved = await service.saveAdministrationSlot({ id: 'pengawas-1' }, signingInput());
    const row = db.tables.cbt_pas_administration_reports[0];
    row.signature_version = 1; row.committee_chair_name = ''; row.committee_chair_nip = '';
    row.signature_hash = computeAdministrationSignatureHash({
        organizationId: row.organization_id, periodId: row.pas_period_id, roomId: row.pas_room_id,
        sessionId: row.session_id, examDate: row.exam_date, invigilatorName: row.invigilator_name,
        proctorName: row.proctor_name, beritaAcaraCode: row.verification_code,
        daftarHadirCode: row.attendance_verification_code, counts: saved.counts,
    });
    row.status = 'approved'; row.approved_at = new Date().toISOString(); row.approved_by = 'proctor-creator-1';
    const verified = await service.verifyDocumentByCode(row.verification_code);
    assert.equal(verified.valid, false);
    assert.equal(verified.requires_resign, true);
    await service.approveAdministrationSlot({ id: 'proctor-creator-1' }, signingInput());
    assert.equal((await service.verifyDocumentByCode(row.verification_code)).valid, true);
});

test('ADMIN-12: chair settings validate text, preserve optional NIP and remain restricted to Admin/Proktor', async () => {
    const db = fixtureDb({ acca_settings: [] }); const settings = new SettingsService(db);
    await settings.upsert('exam_administration', { committee_chair_name: '  Ketua Panitia  ', committee_chair_nip: '  123  ' });
    assert.deepEqual(db.tables.acca_settings[0].value, { committee_chair_name: 'Ketua Panitia', committee_chair_nip: '123' });
    for (const invalid of [null, [], {}, { committee_chair_name: ' ' }, { committee_chair_name: 12 }, { committee_chair_name: 'Nama', committee_chair_nip: {} }]) {
        await assert.rejects(settings.upsert('exam_administration', invalid));
    }
    assert.deepEqual(Reflect.getMetadata('roles', SettingsController.prototype.upsert), ['ADMIN', 'PROKTOR']);
});

test('ADMIN-13: PDF footer wraps long names and moves all three signers together onto a new page', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const calls = []; const text = pdf.text.bind(pdf);
    pdf.text = (...args) => { calls.push(args); return text(...args); };
    const footer = drawAdministrationSigners(pdf, {
        y: 265, marginLeft: 20, pageWidth: 210, marginRight: 15, signedAt: '17 Oktober 2026',
        invigilator: { name: 'Pengawas Ruang Dengan Nama Panjang Beserta Gelar Pendidikan M.Pd.', nip: '123456789012345678' },
        proctor: { name: 'Proktor Pembuat Ujian Beserta Gelar S.Kom., M.Kom.', nip: '234567890123456789' },
        committeeChair: { name: 'Ketua Panitia Dengan Nama Panjang Beserta Gelar Doktor M.Pd.', nip: '345678901234567890' },
    });
    assert.equal(pdf.getNumberOfPages(), 2);
    assert.equal(footer.topY, 20);
    assert.ok(footer.bottomY < 282);
    const printed = calls.map(call => Array.isArray(call[0]) ? call[0].join(' ') : call[0]).join('\n');
    for (const label of ['Pengawas Ruang', 'Proktor', 'Mengetahui, Ketua Panitia']) assert.ok(printed.includes(label));
    assert.ok(calls.some(call => Array.isArray(call[0]) && call[0].length > 1 && call[1] === 58));
});

test('ADMIN-13b: dua pengawas dicetak bernomor dengan NIP masing-masing', () => {
    const people = resolveAdministrationInvigilators([
        { full_name: 'Imran, S.Si.', identity_number: '19930908' },
        { full_name: 'Nurmadinah, S.Pd.', identity_number: '19940222' },
    ], { invigilator_name: 'Imran, S.Si., Nurmadinah, S.Pd.' });
    assert.deepEqual(people, [
        { name: 'Imran, S.Si.', nip: '19930908' },
        { name: 'Nurmadinah, S.Pd.', nip: '19940222' },
    ]);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const calls = []; const originalText = pdf.text.bind(pdf);
    pdf.text = (...args) => { calls.push(args); return originalText(...args); };
    drawAdministrationSigners(pdf, {
        y: 190, marginLeft: 20, pageWidth: 210, marginRight: 15, signedAt: '23 Oktober 2026',
        invigilator: { name: 'Imran, S.Si., Nurmadinah, S.Pd.' }, invigilators: people,
        proctor: { name: 'Proktor' }, committeeChair: { name: 'Ketua Panitia' },
    });
    const printed = calls.map(call => Array.isArray(call[0]) ? call[0].join(' ') : call[0]).join('\n');
    assert.match(printed, /1\. Imran, S\.Si\./);
    assert.match(printed, /NIP\. 19930908/);
    assert.match(printed, /2\. Nurmadinah, S\.Pd\./);
    assert.match(printed, /NIP\. 19940222/);
    assert.equal(pdf.getNumberOfPages(), 1);
});

test('ADMIN-14: period-level committee chair can be configured and updated directly on the exam folder', async () => {
    const db = fixtureDb(createFixtures());
    // Give period-1 a specific committee chair
    db.tables.cbt_pas_periods[0].committee_chair_name = 'Drs. Panitia Folder, M.Pd.';
    db.tables.cbt_pas_periods[0].committee_chair_nip = '198001012005011001';

    const service = new PasAdministrationService(db, createAuthzMock());
    const slot = await service.getAdministrationSlot({ id: 'pengawas-1' }, { periodId: 'period-1', roomId: 'room-1', sessionId: 'session-1', examDate: '2026-10-17' });
    // Should prioritize period-level committee chair over acca_settings
    assert.equal(slot.committee_chair.committee_chair_name, 'Drs. Panitia Folder, M.Pd.');
    assert.equal(slot.committee_chair.committee_chair_nip, '198001012005011001');

    // Check roles for updateCommitteeChair on PasController
    assert.deepEqual(Reflect.getMetadata('roles', PasController.prototype.updateCommitteeChair), ['ADMIN', 'PROKTOR']);

    // Check updateCommitteeChair in PasService
    const pasService = new PasService(db, createAuthzMock());
    const updated = await pasService.updateCommitteeChair({ id: 'proctor-1', role: 'PROKTOR', organization_id: 'org-1' }, 'period-1', {
        committee_chair_name: 'Dra. Ketua Diperbarui, M.Si.',
        committee_chair_nip: '198202022006022002',
    });
    assert.equal(updated.committee_chair_name, 'Dra. Ketua Diperbarui, M.Si.');
    assert.equal(db.tables.cbt_pas_periods[0].committee_chair_name, 'Dra. Ketua Diperbarui, M.Si.');
});

test('ADMIN-12: pengawas bergilir per hari — akses dan nama di berita acara mengikuti tanggal slot', async () => {
    const db = fixtureDb(createFixtures());
    db.tables.cbt_profiles.push({ id: 'pengawas-2', full_name: 'Ahmad Rifai, S.Pd.', nis: '19850203' });
    db.tables.cbt_pas_room_invigilators.push({ id: 'inv-map-2', pas_room_id: 'room-1', session_id: 'session-1', exam_date: '2026-10-18', user_id: 'pengawas-2' });
    db.tables.cbt_pas_class_schedules.push({ ...db.tables.cbt_pas_class_schedules[0], id: 'sched-2', exam_id: 'exam-math-2', scheduled_date: '2026-10-18' });
    const service = new PasAdministrationService(db, createAuthzMock());
    const params = { periodId: 'period-1', roomId: 'room-1', sessionId: 'session-1' };

    // Pengawas hari pertama tidak boleh membuka slot hari kedua, dan sebaliknya.
    await assert.rejects(service.getAdministrationSlot({ id: 'pengawas-1' }, { ...params, examDate: '2026-10-18' }), /tanggal ujian ini/);
    await assert.rejects(service.getAdministrationSlot({ id: 'pengawas-2' }, { ...params, examDate: '2026-10-17' }), /tanggal ujian ini/);
    await assert.rejects(service.saveAdministrationSlot({ id: 'pengawas-1' }, { ...signingInput(), exam_date: '2026-10-18', action: 'save_draft' }), /tanggal ujian ini/);

    // Tanpa tanggal, pengawas diarahkan ke hari tugasnya sendiri.
    const ownDay = await service.getAdministrationSlot({ id: 'pengawas-2' }, params);
    assert.equal(ownDay.report.invigilator_name, 'Ahmad Rifai, S.Pd.');

    // Proktor melihat pengawas yang bertugas pada tanggal masing-masing.
    const proktor = { id: 'proctor-creator-1', isPlatformAdmin: false };
    const day1 = await service.getAdministrationSlot(proktor, { ...params, examDate: '2026-10-17' });
    const day2 = await service.getAdministrationSlot(proktor, { ...params, examDate: '2026-10-18' });
    assert.equal(day1.report.invigilator_name, 'Dra. Siti Aminah, M.Pd.');
    assert.equal(day2.report.invigilator_name, 'Ahmad Rifai, S.Pd.');
});
