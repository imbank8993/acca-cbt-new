const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { groupFolderExams, resolveMonitoringSelection, isFolderGroupId } = require('../../web/lib/monitoring-folder.ts');
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

const scope = { assertSchoolId: async id => id };
function fixture() {
    const db = fixtureDb({
        cbt_exams: [
            { id: 'e1', organization_id: 'school', created_by: 'admin', exam_type: 'pas', question_bank_id: 'bank', is_published: true },
            { id: 'e2', organization_id: 'school', created_by: 'admin', exam_type: 'pas', question_bank_id: 'other-bank', is_published: true },
        ],
        cbt_question_banks: [{ id: 'bank', organization_id: 'school', created_by: 'owner' }, { id: 'other-bank', organization_id: 'school', created_by: 'owner' }],
        cbt_bank_collaborators: [{ bank_id: 'bank', user_id: 'colleague', permission: 'viewer' }],
        cbt_exam_collaborators: [],
    });
    const roles = { hasOrgRole: async (id, org, allowed) => org === 'school' && ['owner', 'colleague', 'stranger'].includes(id) && allowed.includes('Guru') };
    return { db, roles, auth: new AuthorizationService(db, roles, scope) };
}

test('MF-01: kolaborator bank soal memantau seluruh peserta, tanpa hak reset', async () => {
    const { db, auth } = fixture();
    assert.equal(await auth.assertExamMonitoring({ id: 'colleague' }, 'e1'), undefined);
    assert.equal(await auth.assertExamMonitoring({ id: 'owner' }, 'e1'), undefined);
    await assert.rejects(auth.assertExamMonitoring({ id: 'colleague' }, 'e2'), /izin/);
    await assert.rejects(auth.assertExamMonitoring({ id: 'stranger' }, 'e1'), /izin/);
    assert.equal(await auth.getExamResetScope({ id: 'colleague' }, db.tables.cbt_exams[0]), null);
    assert.equal(await auth.getExamResetScope({ id: 'owner' }, db.tables.cbt_exams[0]), null);
    db.tables.cbt_bank_collaborators[0].revoked_at = '2026-01-01T00:00:00Z';
    await assert.rejects(auth.assertExamMonitoring({ id: 'colleague' }, 'e1'), /izin/);
});

test('MF-02: daftar ujian guru memuat ujian dari bank soal tempat ia berkolaborasi', async () => {
    const { db, roles, auth } = fixture();
    await new ExamAdminService(db, auth, roles).list({ id: 'colleague' }, 'school');
    const or = db.queries.filter(query => query.table === 'cbt_exams').flatMap(query => query.calls).find(call => call[0] === 'or');
    assert.match(or[1], /question_bank_id\.in\.\(bank\)/);
});

const folderExam = (id, className, extra = {}) => ({
    id, title: 'Simulasi TO 3', exam_type: 'pas', question_bank_id: 'bind', is_published: true,
    description: `Bahasa Indonesia • Kelas ${className} | 2026/2027 | PAS ganjil`,
    start_time: '2026-10-26T00:00:00Z', end_time: '2026-10-26T02:00:00Z',
    metadata: { is_pas_exam: true, pas_period_id: 'p1', bank_title: 'Bahasa Indonesia' }, ...extra,
});

test('MF-03: ujian folder satu entri per bank soal; ujian biasa tetap apa adanya', () => {
    const exams = [
        folderExam('x-b', 'X B', { start_time: '2026-10-26T01:00:00Z', end_time: '2026-10-26T03:00:00Z' }),
        { id: 'daily', title: 'Ulangan Harian', exam_type: 'daily' },
        folderExam('x-a', 'X A', { is_published: false }),
        folderExam('x-c', 'X C, X D'),
        folderExam('math', 'X A', { question_bank_id: 'math', description: 'Matematika • Kelas X A | 2026/2027', metadata: { is_pas_exam: true, pas_period_id: 'p1', bank_title: 'Matematika' } }),
    ];
    const grouped = groupFolderExams(exams);
    assert.deepEqual(grouped.list.map(exam => exam.id), ['pas:p1:bind', 'daily', 'pas:p1:math']);
    const group = grouped.groups.get('pas:p1:bind');
    assert.deepEqual(group.examIds, ['x-b', 'x-a', 'x-c']);
    assert.deepEqual(group.classes, ['X A', 'X B', 'X C', 'X D']);
    assert.equal(group.entry.start_time, '2026-10-26T00:00:00Z');
    assert.equal(group.entry.end_time, '2026-10-26T03:00:00Z');
    assert.equal(group.entry.is_published, true);
    assert.match(group.entry.description, /^Bahasa Indonesia • Kelas X A, X B, X C, X D \| 2026\/2027/);
    // Tautan lama ke ujian per kelas, dan tautan folder pas:<periodId>, menuju entri grup.
    assert.equal(resolveMonitoringSelection('x-a', grouped), 'pas:p1:bind');
    assert.equal(resolveMonitoringSelection('daily', grouped), 'daily');
    assert.ok(['pas:p1:bind', 'pas:p1:math'].includes(resolveMonitoringSelection('pas:p1', grouped)));
    assert.equal(resolveMonitoringSelection('pas:none', grouped), '');
    assert.equal(isFolderGroupId('pas:p1:bind'), true);
    assert.equal(isFolderGroupId('daily'), false);
});

function loadFolderMonitor() {
    const source = web('app/components/monitoring/FolderExamMonitor.tsx');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(() => new Proxy({}, { get: (_, key) => key }), mod, mod.exports);
    return mod.exports;
}

test('MF-04: Proktor mulai per ruang, Admin per bank soal, guru hanya per bank soal', () => {
    const { defaultFolderView, folderViews } = loadFolderMonitor();
    assert.equal(defaultFolderView('proktor'), 'room');
    assert.equal(defaultFolderView('admin'), 'bank');
    assert.equal(defaultFolderView('guru'), 'bank');
    assert.deepEqual(folderViews('guru'), ['bank']);
    assert.deepEqual(folderViews('admin'), ['bank', 'room']);
    for (const role of ['admin', 'proktor', 'guru']) {
        const page = web(`app/dashboard/${role}/monitoring/page.tsx`);
        assert.match(page, /groupFolderExams\(exams\)/);
        assert.match(page, new RegExp(`<FolderExamMonitor key=\\{folderGroup\\.id\\} group=\\{folderGroup\\} userRole="${role}"`));
        assert.match(page, /hideDetails=\{Boolean\(folderGroup\)\}/);
    }
});

test('MF-05: folder ASAS/AM 5 tab; pelaksanaan dipantau di halaman Monitoring', () => {
    assert.match(web('app/components/pas/CompactExamPeriodWorkspace.tsx'),
        /COMPACT_PERIOD_TABS = \[\s*\['schedules', 'Jadwal'\], \['rooms', 'Ruang dan Pengawas'\], \['sessions', 'Sesi'\], \['exam_settings', 'Pengaturan Ujian'\], \['administration', 'Administrasi'\],\s*\] as const/);
    for (const role of ['admin', 'proktor']) {
        const page = web(`app/dashboard/${role}/exams/pas/[id]/page.tsx`);
        assert.doesNotMatch(page, /PASSlotMonitoring|PASBankResultsPanel|Hasil & Analisis/);
        assert.match(page, /<PASTodayStatusCard periodId=\{period\.id\}/);
        assert.match(page, new RegExp(`/dashboard/${role}/monitoring\\?exam=`));
    }
});

test('MF-06: halaman folder memakai komponen bersama (Button, FilterToolbar, Modal, InlineSelect)', () => {
    const workspace = web('app/components/pas/CompactExamPeriodWorkspace.tsx');
    for (const name of ['@/app/components/ui/button', '@/app/components/ui/filtertoolbar', '@/app/components/ui/modal']) assert.ok(workspace.includes(name), name);
    assert.doesNotMatch(workspace, /<dialog|<select|className="cp-control"/);
    const administration = web('app/components/pas/PASAdministrationPanel.tsx');
    assert.doesNotMatch(administration, /fixed inset-0/);
    assert.match(administration, /<FilterToolbar alwaysExpanded>/);
    assert.match(administration, /<InlineSelect value=\{selectedRoomId\}/);
    assert.match(web('app/components/PASScheduleActions.tsx'), /<Button ref=\{trigger\}/);
});

test('MF-07: Ruang dan Pengawas satu tab dengan tombol Tambah pengawas; Sesi tab sendiri', () => {
    const panel = web('app/components/pas/RoomManagementPanel.tsx');
    assert.match(panel, /Tambah pengawas<\/Button>/);
    assert.match(panel, /hideNav = false/);
    assert.doesNotMatch(panel, /handleTabChange\('invigilators'\)/);
    for (const role of ['admin', 'proktor']) {
        const page = web(`app/dashboard/${role}/exams/pas/[id]/page.tsx`);
        assert.match(page, /if \(tab === 'rooms' \|\| tab === 'sessions'\) \{ setLogisticsSubTab\(tab\); setActiveTab\('rooms_sessions'\); \}/);
        assert.match(page, /hideNav=\{isCompactPeriod\}/);
    }
    assert.match(web('app/components/pas/CompactExamPeriodWorkspace.tsx'), /className="cp-summary-card"/);
});

test('MF-08: pilihan Per bank soal | Per ruang di pojok kanan atas; filter peserta memakai FilterToolbar', () => {
    const header = web('app/components/monitoring/MonitoringWorkspaceHeader.tsx');
    assert.match(header, /\{schedule && <p className="monitoring-workspace__schedule">\{schedule\}<\/p>\}\s*<\/div>\s*\{headerAction && <div className="monitoring-workspace__action">/);
    for (const role of ['admin', 'proktor', 'guru']) {
        assert.match(web(`app/dashboard/${role}/monitoring/page.tsx`), new RegExp(`headerAction=\\{folderGroup \\? <FolderViewToggle role="${role}"`));
    }
    const workspace = web('app/components/monitoring/ParticipantsWorkspace.tsx');
    assert.match(workspace, /<FilterToolbar>\s*<FilterSearch/);
    assert.doesNotMatch(workspace, /ParticipantSummaryLine attempts=/);
    assert.match(workspace, /<Button type="button" variant="outline" size="sm" aria-haspopup="menu"/);
});
