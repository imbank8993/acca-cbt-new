// Run: node --test apps/api/test/school-timezone-sync.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { SettingsService } = require('../src/settings/settings.service.ts');

test('TIMEZONE-SYNC-01: mengambil zona waktu dari site_settings milik acca-new sebagai Single Source of Truth', async () => {
    const db = fixtureDb({
        site_settings: [{ key: 'timezone', value: 'Asia/Makassar', label: 'Zona Waktu' }],
        acca_settings: [{ key: 'app_config', value: { time_zone: 'Asia/Jakarta' } }],
    });
    const service = new SettingsService(db);

    const info = await service.getSchoolTimeZoneInfo();
    assert.equal(info.timeZone, 'Asia/Makassar');
    assert.equal(info.source, 'site_settings');

    const tz = await service.getSchoolTimeZone();
    assert.equal(tz, 'Asia/Makassar');

    const all = await service.findAll();
    const appConfig = all.find(s => s.key === 'app_config');
    assert.equal(appConfig.value.time_zone, 'Asia/Makassar');
    assert.equal(appConfig.value.time_zone_source, 'site_settings');
});

test('TIMEZONE-SYNC-02: fallback ke app_config saat site_settings belum terisi atau kosong', async () => {
    const db = fixtureDb({
        site_settings: [],
        acca_settings: [{ key: 'app_config', value: { time_zone: 'Asia/Jayapura' } }],
    });
    const service = new SettingsService(db);

    const info = await service.getSchoolTimeZoneInfo();
    assert.equal(info.timeZone, 'Asia/Jayapura');
    assert.equal(info.source, 'app_config');

    const tz = await service.getSchoolTimeZone();
    assert.equal(tz, 'Asia/Jayapura');
});

test('TIMEZONE-SYNC-03: fallback ke default nasional Asia/Jakarta saat kedua pengaturan tidak ada', async () => {
    const db = fixtureDb({
        site_settings: [],
        acca_settings: [],
    });
    const service = new SettingsService(db);

    const info = await service.getSchoolTimeZoneInfo();
    assert.equal(info.timeZone, 'Asia/Jakarta');
    assert.equal(info.source, 'default');

    const tz = await service.getSchoolTimeZone();
    assert.equal(tz, 'Asia/Jakarta');

    const all = await service.findAll();
    const appConfig = all.find(s => s.key === 'app_config');
    assert.equal(appConfig.value.time_zone, 'Asia/Jakarta');
    assert.equal(appConfig.value.time_zone_source, 'default');
});


test('timezone read failure never falls back to a different zone', async () => {
    const db = fixtureDb({ acca_settings: [{ key: 'app_config', value: { time_zone: 'Asia/Jakarta' } }] }, ['site_settings']);
    await assert.rejects(new SettingsService(db).getSchoolTimeZoneInfo(), /belum dapat dibaca/);
});

test('invalid central timezone is rejected instead of silently using WIB', async () => {
    const db = fixtureDb({ site_settings: [{ key: 'timezone', value: 'Invalid/Zone' }] });
    await assert.rejects(new SettingsService(db).getSchoolTimeZoneInfo(), /tidak valid/);
});

test('browser rereads central timezone and formats midnight using WITA', async () => {
    const fs = require('node:fs');
    const ts = require('typescript');
    const vm = require('node:vm');
    let zone = 'Asia/Jakarta';
    let calls = 0;
    const exports = {};
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/school-time.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
        exports, require: () => ({ apiGet: async () => { calls++; return { success: true, timeZone: zone }; } }), Intl, Date,
    });
    assert.equal(await exports.getSchoolTimeZone(), 'Asia/Jakarta');
    zone = 'Asia/Makassar';
    assert.equal(await exports.getSchoolTimeZone(), 'Asia/Makassar');
    assert.equal(calls, 2);
    assert.match(exports.formatSchoolDate('2026-10-10T16:30:00Z', zone), /11/);
    assert.equal(exports.schoolLocalDateTimeToUtc('2026-10-11T08:00', zone), '2026-10-11T00:00:00.000Z');
});


test('exam creation rejects a form opened in the previous timezone before writing', async () => {
    const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
    const service = Object.create(ExamAdminService.prototype);
    service.resolveOrganizationId = async () => 'school';
    service.assertMayUseExamType = async () => {};
    service.settings = { getSchoolTimeZone: async () => 'Asia/Makassar' };
    service.db = { from: () => assert.fail('stale timezone must not write an exam') };
    await assert.rejects(service.create({ id: 'teacher' }, 'school', {
        examType: 'daily', duration: 60, timeZone: 'Asia/Jakarta', startTime: '2026-10-11T08:00',
    }), /Zona waktu sekolah berubah/);
});
