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
