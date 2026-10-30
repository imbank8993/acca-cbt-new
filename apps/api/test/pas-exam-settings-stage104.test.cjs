const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasService } = require('../src/pas/pas.service.ts');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const {
    PAS_EXAM_SETTING_DEFAULTS, normalizePasExamSettings, resolvePasExamSettings, storedPasExamSettings,
} = require('../src/common/pas-exam-settings.ts');

const MATH = '11111111-1111-4111-8111-111111111111';
const ENGLISH = '22222222-2222-4222-8222-222222222222';
const OUTSIDE = '33333333-3333-4333-8333-333333333333';
const user = { id: 'proctor-1' };
const authz = { assertProktorByRecord: async () => {}, assertProktorByParent: async () => {}, assertBankAccess: async () => {} };

function tables() {
    return {
        cbt_pas_periods: [{ id: 'period-1', organization_id: 'school-1', name: 'ASAS Ganjil', type: 'pas',
            school_year: '2026/2027', semester: 'ganjil', is_locked: false, screenshot_enabled: false, exam_settings: {},
            start_date: '2026-10-01', end_date: '2026-10-31' }],
        cbt_pas_class_schedules: [
            { id: 'sch-math-a', pas_period_id: 'period-1', bank_id: MATH, class_id: 'class-a', exam_id: 'exam-math-a' },
            { id: 'sch-math-b', pas_period_id: 'period-1', bank_id: MATH, class_id: 'class-b', exam_id: 'exam-math-b' },
            { id: 'sch-eng-a', pas_period_id: 'period-1', bank_id: ENGLISH, class_id: 'class-a', exam_id: 'exam-eng-a' },
            { id: 'sch-eng-b', pas_period_id: 'period-1', bank_id: ENGLISH, class_id: 'class-b', exam_id: null },
        ],
        cbt_exams: ['exam-math-a', 'exam-math-b', 'exam-eng-a'].map(id => ({
            id, title: 'ASAS Ganjil', description: `${id} • Kelas X | 2026/2027`, show_results: false,
            randomize_questions: true, randomize_options: true,
            metadata: { is_pas_exam: true, is_safe_mode: true, screenshot_enabled: false, pas_period_id: 'period-1' },
        })),
        cbt_exam_attempts: [{ id: 'attempt-1', exam_id: 'exam-math-b', status: 'in_progress' }],
        cbt_pas_administration_reports: [],
    };
}

test('SET-01: folder lama tanpa pengaturan tetap memakai perilaku sebelumnya; screenshot mengikuti folder', () => {
    assert.deepEqual(storedPasExamSettings({ exam_settings: {}, screenshot_enabled: false }).defaults, PAS_EXAM_SETTING_DEFAULTS);
    assert.deepEqual(PAS_EXAM_SETTING_DEFAULTS, {
        randomize_questions: true, randomize_options: true, show_results: false, show_answer_keys: false,
        is_safe_mode: true, max_violations: 3, screenshot_enabled: false, scoring: 'classical',
        complex_scoring: 'official',
    });
    assert.equal(storedPasExamSettings({ exam_settings: null, screenshot_enabled: true }).defaults.screenshot_enabled, true);
    const stored = storedPasExamSettings({ exam_settings: {
        defaults: { show_results: true, max_violations: 'banyak' },
        banks: { [MATH]: { show_answer_keys: true }, 'bukan-uuid': { show_results: true }, [ENGLISH]: 'rusak' },
    } });
    assert.equal(stored.defaults.show_results, false, 'bawaan rusak diabaikan seluruhnya');
    assert.deepEqual(Object.keys(stored.banks), [MATH]);
});

test('SET-02: timpaan bank soal hanya mengganti bidang yang diatur khusus', () => {
    const config = normalizePasExamSettings({
        defaults: { show_results: true, is_safe_mode: true, max_violations: 5 },
        banks: { [MATH]: { show_answer_keys: true }, [ENGLISH]: { is_safe_mode: false } },
    });
    assert.deepEqual(resolvePasExamSettings(config, MATH), { ...PAS_EXAM_SETTING_DEFAULTS, show_results: true, max_violations: 5, show_answer_keys: true });
    assert.equal(resolvePasExamSettings(config, ENGLISH).is_safe_mode, false);
    assert.equal(resolvePasExamSettings(config, ENGLISH).show_answer_keys, false);
    assert.equal(resolvePasExamSettings(config, null).max_violations, 5);
});

test('SET-03: kiriman tidak valid ditolak dengan pesan yang jelas', () => {
    assert.throws(() => normalizePasExamSettings({ defaults: { show_results: 'ya' } }), /ya\/tidak/);
    assert.throws(() => normalizePasExamSettings({ defaults: { max_violations: 0 } }), /1–100/);
    assert.throws(() => normalizePasExamSettings({ defaults: { max_violations: 2.5 } }), /1–100/);
    assert.throws(() => normalizePasExamSettings({ defaults: {}, banks: { 'bank-x': {} } }), /ID bank soal/);
    assert.throws(() => normalizePasExamSettings({ defaults: {}, banks: { [OUTSIDE]: { show_results: true } } }, new Set([MATH])), /dijadwalkan di folder ini/);
    assert.equal(normalizePasExamSettings({ defaults: { max_violations: null } }).defaults.max_violations, null);
    assert.throws(() => normalizePasExamSettings({ defaults: { scoring: 'irt_9pl' } }), /model penilaian/);
    assert.equal(normalizePasExamSettings({ defaults: { scoring: 'irt_1pl' } }).defaults.scoring, 'irt_1pl');
});

test('SET-04: simpan pengaturan menerapkan nilai/pembahasan ke semua ujian, keamanan hanya ke ujian yang belum dikerjakan', async () => {
    const db = fixtureDb(tables());
    const service = new PasService(db, authz);
    const result = await service.updateExamSettings(user, 'period-1', {
        defaults: { show_results: true, is_safe_mode: true, max_violations: null, randomize_questions: false, screenshot_enabled: true },
        banks: { [MATH]: { show_answer_keys: true } },
    });

    assert.equal(result.updated, 3);
    assert.deepEqual(result.security_locked, ['exam-math-b • Kelas X']);
    assert.deepEqual(result.results_locked, []);
    const period = db.tables.cbt_pas_periods[0];
    assert.equal(period.screenshot_enabled, true);
    assert.deepEqual(Object.keys(period.exam_settings.banks), [MATH]);

    const exam = id => db.tables.cbt_exams.find(row => row.id === id);
    assert.equal(exam('exam-math-a').show_results, true);
    assert.equal(exam('exam-math-a').metadata.show_answer_keys, true);
    assert.equal(exam('exam-math-a').randomize_questions, false);
    assert.equal(exam('exam-math-a').metadata.max_violations, null);
    assert.equal(exam('exam-math-a').metadata.screenshot_enabled, true);
    assert.equal(exam('exam-math-a').metadata.is_pas_exam, true, 'metadata folder tetap utuh');

    assert.equal(exam('exam-eng-a').show_results, true);
    assert.equal(exam('exam-eng-a').metadata.show_answer_keys, false, 'pembahasan hanya dibuka untuk bank yang diatur khusus');

    // Sudah dikerjakan: pembahasan ikut, pengacakan & keamanan tidak berubah.
    assert.equal(exam('exam-math-b').metadata.show_answer_keys, true);
    assert.equal(exam('exam-math-b').randomize_questions, true);
    assert.equal(exam('exam-math-b').metadata.screenshot_enabled, false);
    assert.equal(exam('exam-math-b').metadata.max_violations, undefined);
});

test('SET-05: koreksi kunci yang berjalan menahan pembukaan nilai; folder terkunci dan bank di luar folder ditolak', async () => {
    const data = tables();
    data.cbt_exams[0].metadata.key_correction = { state: 'rescoring' };
    const db = fixtureDb(data);
    const service = new PasService(db, authz);
    const result = await service.updateExamSettings(user, 'period-1', { defaults: { show_results: true } });
    assert.deepEqual(result.results_locked, ['exam-math-a • Kelas X']);
    assert.equal(db.tables.cbt_exams[0].show_results, false);
    assert.equal(db.tables.cbt_exams[2].show_results, true);

    await assert.rejects(service.updateExamSettings(user, 'period-1', { defaults: {}, banks: { [OUTSIDE]: { show_results: true } } }), /dijadwalkan di folder ini/);
    db.tables.cbt_pas_periods[0].is_locked = true;
    await assert.rejects(service.updateExamSettings(user, 'period-1', { defaults: { show_results: false } }), /dikunci/);
});

test('SET-05b: exam rows are locked before checking history and merging their settings', async () => {
    const db = fixtureDb(tables());
    const raw = db.raw;
    let locked = false;
    db.raw = async (sql, ...params) => {
        if (/cbt_exams.*FOR UPDATE/.test(sql)) locked = true;
        return raw(sql, ...params);
    };
    const from = db.from;
    db.from = table => {
        if (table === 'cbt_exams' || table === 'cbt_exam_attempts') assert.ok(locked, 'Read current exam state only after acquiring its lock');
        return from(table);
    };
    await new PasService(db, authz).updateExamSettings(user, 'period-1', { defaults: { show_results: true } });
    assert.ok(locked);
});

test('SET-06: ujian yang dibangkitkan memakai pengaturan bank soalnya', async () => {
    const db = fixtureDb({
        cbt_pas_class_schedules: [{ id: 'sch-1', pas_period_id: 'period-1', bank_id: MATH, class_id: 'class-1', subject_id: null,
            exam_id: null, scheduled_date: '2026-10-05', scheduled_time: '07:30', window_end_time: '09:30', duration_minutes: 90 }],
        cbt_pas_periods: [{ id: 'period-1', organization_id: 'school-1', name: 'ASAS', type: 'pas', school_year: '2026/2027',
            semester: 'ganjil', screenshot_enabled: false,
            exam_settings: { defaults: { show_results: true, max_violations: 7 }, banks: { [MATH]: { show_answer_keys: true, randomize_options: false } } } }],
        cbt_question_banks: [{ id: MATH, organization_id: 'school-1', title: 'Matematika' }],
        cbt_classes: [{ id: 'class-1', organization_id: 'school-1', name: 'X A' }],
        cbt_exams: [], cbt_exam_targets: [],
    });
    const result = await new PasSchedulesService(db, authz).generate(user, ['sch-1']);
    assert.equal(result.created, 1, JSON.stringify(result.skipped));
    const [exam] = db.tables.cbt_exams;
    assert.equal(exam.show_results, true);
    assert.equal(exam.randomize_options, false);
    assert.equal(exam.randomize_questions, true);
    assert.equal(exam.metadata.show_answer_keys, true);
    assert.equal(exam.metadata.max_violations, 7);
    assert.equal(exam.metadata.is_safe_mode, true);
    assert.equal(exam.metadata.is_pas_exam, true);
});

function loadRoomTabs() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/PASSlotMonitoring.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => name === 'react'
        ? { useState: () => [], useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }) }
        : new Proxy({}, { get: (_, key) => key }), mod, mod.exports);
    return mod.exports.roomSections;
}

test('SET-07: monitoring ruang ASAS/AM ringkas: 4 bagian, reset & pengecualian layar di menu Tindakan', () => {
    const roomSections = loadRoomTabs();
    assert.deepEqual(roomSections('proktor'), ['peserta', 'jawaban', 'hasil', 'berita']);
    assert.deepEqual(roomSections('admin'), ['peserta', 'jawaban', 'hasil', 'berita']);
    assert.deepEqual(roomSections('pengawas'), ['peserta', 'jawaban', 'berita']);
    const workspace = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/ParticipantsWorkspace.tsx'), 'utf8');
    assert.match(workspace, /\['reset', 'Reset massal'\]/);
    assert.match(workspace, /\['screen', 'Pengecualian layar'\]/);
    assert.match(workspace, /userRole !== 'guru' && examRecords\[examId\]\?\.canResetParticipants === true/);
});

test('SET-08: tab Pengaturan Ujian tersedia di folder dan monitoring biasa memakai panel analisis bersama', () => {
    const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    assert.match(web('app/components/pas/CompactExamPeriodWorkspace.tsx'), /\['exam_settings', 'Pengaturan Ujian'\]/);
    const monitoring = ts.createSourceFile('monitoring.tsx', web('app/dashboard/admin/monitoring/page.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let panel;
    const visit = node => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(monitoring) === 'ItemAnalysisPanel') panel = node;
        ts.forEachChild(node, visit);
    };
    visit(monitoring);
    assert.ok(panel, 'monitoring memakai panel analisis bersama');
    const attributes = new Map(panel.attributes.properties.filter(ts.isJsxAttribute)
        .map(attribute => [attribute.name.getText(monitoring), attribute.initializer?.expression?.getText(monitoring)]));
    assert.equal(attributes.get('key'), 'selectedExamId');
    assert.equal(attributes.get('analysis'), 'analysis');
    assert.ok(!attributes.has('topicAnalysis'), 'analisis penguasaan materi tidak ditampilkan di monitoring');
    assert.match(web('app/dashboard/admin/monitoring/page.tsx'), /setAnalysis\(buildItemAnalysis\(analysisData, attData\)\)/);
});

test('SET-09: monitoring ujian folder dapat disaring per ruang; ujian biasa tanpa filter ruang', () => {
    const { monitoringRoomOptions, matchesRoomFilter, effectiveRoomFilter, UNASSIGNED_ROOM } = require('../../web/lib/monitoring-rooms.ts');
    const at = (id, room, status = 'assigned') => ({ id, pas_location: { status, room_id: room, room_name: room ? `Ruang ${room}` : null } });
    const attempts = [at('a', '10'), at('b', '2'), at('c', '2'), at('d', null, 'unassigned')];
    const options = monitoringRoomOptions(attempts);
    assert.deepEqual(options.map(o => [o.label, o.count]), [['Ruang 2', 2], ['Ruang 10', 1], ['Belum ditempatkan', 1]]);
    assert.deepEqual(attempts.filter(row => matchesRoomFilter(row, '2')).map(row => row.id), ['b', 'c']);
    assert.deepEqual(attempts.filter(row => matchesRoomFilter(row, UNASSIGNED_ROOM)).map(row => row.id), ['d']);
    assert.equal(effectiveRoomFilter('ruang-lama', options), '', 'filter ruang dari ujian lain tidak mengosongkan daftar');
    assert.deepEqual(monitoringRoomOptions([{ id: 'x' }, { id: 'y', pas_location: null }]), []);
});
