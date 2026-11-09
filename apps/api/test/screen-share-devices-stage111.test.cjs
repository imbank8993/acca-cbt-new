// Run from repository root: node --test apps/api/test/screen-share-devices-stage111.test.cjs
// Berbagi layar di tablet/HP: deteksi perangkat, pengecualian per periode, dan pembukaan otomatis.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { screenShareSupport, isMobileOrTablet, isUnsupportedRejection } = require('../../web/lib/screen-share-support.ts');
const helper = require('../src/common/screen-share-exceptions.ts');

const api = (relative) => fs.readFileSync(path.resolve(__dirname, '../src', relative), 'utf8');
const web = (relative) => fs.readFileSync(path.resolve(__dirname, '../../web', relative), 'utf8');

const UA = {
    androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    androidPhoneOldChrome: 'Mozilla/5.0 (Linux; Android 9; Redmi 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0 Mobile Safari/537.36',
    samsungInternet: 'Mozilla/5.0 (Linux; Android 12; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    androidDesktopMode: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
};
const env = (userAgent, extra = {}) => ({ hasGetDisplayMedia: true, userAgent, maxTouchPoints: 0, finePointer: true, ...extra });

test('SSD-01: tablet dan HP dikenali walau browsernya menampilkan getDisplayMedia', () => {
    assert.equal(screenShareSupport(env(UA.androidTablet, { hasGetDisplayMedia: false, maxTouchPoints: 10, finePointer: false })), 'unsupported-device');
    assert.equal(screenShareSupport(env(UA.androidPhoneOldChrome, { maxTouchPoints: 5, finePointer: false })), 'unsupported-device',
        'Chrome Android lama menampilkan fungsi tetapi selalu menolak');
    assert.equal(screenShareSupport(env(UA.samsungInternet, { maxTouchPoints: 5 })), 'unsupported-device');
    assert.equal(screenShareSupport(env(UA.iphone, { hasGetDisplayMedia: false, maxTouchPoints: 5 })), 'unsupported-device');
    assert.equal(screenShareSupport(env(UA.ipadDesktopMode, { hasGetDisplayMedia: false, platform: 'MacIntel', maxTouchPoints: 5 })), 'unsupported-device',
        'iPad menyamar sebagai Mac');
    assert.equal(screenShareSupport(env(UA.androidDesktopMode, { maxTouchPoints: 10, finePointer: false })), 'unsupported-device',
        'tablet Android mode situs desktop');
    assert.equal(screenShareSupport(env(UA.windowsChrome, { userAgentDataMobile: true })), 'unsupported-device');
});

test('SSD-02: laptop/komputer tetap didukung, termasuk layar sentuh', () => {
    assert.equal(screenShareSupport(env(UA.windowsChrome)), 'supported');
    assert.equal(screenShareSupport(env(UA.windowsChrome, { maxTouchPoints: 10, finePointer: false })), 'supported', 'Windows tablet/2-in-1');
    assert.equal(screenShareSupport(env(UA.macSafari, { platform: 'MacIntel', maxTouchPoints: 0 })), 'supported');
    assert.equal(screenShareSupport(env(UA.chromebook, { maxTouchPoints: 10, finePointer: false })), 'supported');
    assert.equal(screenShareSupport(env(UA.androidDesktopMode, { maxTouchPoints: 10, finePointer: true })), 'supported', 'Linux layar sentuh + mouse');
    assert.equal(screenShareSupport(env(UA.windowsChrome, { hasGetDisplayMedia: false })), 'unsupported-browser');
    assert.equal(isMobileOrTablet(env(UA.windowsChrome)), false);
});

test('SSD-03: penolakan instan di perangkat sentuh = tidak didukung; di laptop = siswa membatalkan', () => {
    const notAllowed = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    assert.equal(isUnsupportedRejection(notAllowed, env(UA.androidPhoneOldChrome, { maxTouchPoints: 5 })), true);
    assert.equal(isUnsupportedRejection(notAllowed, env(UA.windowsChrome)), false);
    assert.equal(isUnsupportedRejection(Object.assign(new Error(), { name: 'NotSupportedError' }), env(UA.windowsChrome)), true);
    assert.equal(isUnsupportedRejection(Object.assign(new Error(), { name: 'AbortError' }), env(UA.windowsChrome)), false);
});

function fakeDb({ tableExists, examRow = null }) {
    const calls = [];
    const from = (table) => {
        const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: () => { q.single = true; return q; },
            then: (resolve) => { calls.push({ table }); resolve({ data: q.single ? examRow : [], error: null }); } };
        return q;
    };
    return {
        calls, from,
        raw: async (sql, ...params) => {
            calls.push({ sql, params });
            if (/to_regclass/.test(sql)) return [{ ok: tableExists }];
            return [];
        },
    };
}

test('SSD-04: tanpa migrasi periode, query tidak pernah menyentuh tabel yang belum ada', async () => {
    helper.resetScreenShareExceptionCache();
    const db = fakeDb({ tableExists: false });
    assert.equal(await helper.findScreenShareException(db, 'e1', 'u1'), null);
    await helper.loadScreenShareExceptions(db, 'e1');
    assert.ok(db.calls.every(call => !/FROM public\.cbt_pas_screen_share_exceptions/.test(call.sql || '')));
    assert.equal(db.calls.filter(call => /to_regclass/.test(call.sql || '')).length, 1, 'hasil negatif diingat sebentar');

    helper.resetScreenShareExceptionCache();
    const ready = fakeDb({ tableExists: true });
    await helper.findScreenShareException(ready, 'e1', 'u1');
    const query = ready.calls.find(call => /cbt_pas_screen_share_exceptions p/.test(call.sql || ''));
    assert.match(query.sql, /cbt_pas_class_schedules s WHERE s\.exam_id = \$1::uuid\) AND p\.user_id = \$2::uuid/);
    assert.deepEqual(query.params, ['e1', 'u1']);

    // Pengecualian per ujian ditemukan lebih dulu: tabel periode tidak perlu ditanya.
    helper.resetScreenShareExceptionCache();
    const exam = fakeDb({ tableExists: true, examRow: { reason: 'tablet', created_at: '2026-11-09', created_by: 'p1' } });
    const found = await helper.findScreenShareException(exam, 'e1', 'u1');
    assert.equal(found.scope, 'exam');
    assert.equal(found.reason, 'tablet');
    assert.equal(exam.calls.filter(call => call.sql).length, 0);
});

test('SSD-05: semua pemeriksaan pengecualian memakai helper yang menghormati cakupan periode', () => {
    for (const file of ['students/exam-attempts.service.ts', 'students/students.service.ts', 'proctoring/proctoring.service.ts']) {
        const source = api(file);
        assert.match(source, /findScreenShareException\(/, file);
        assert.doesNotMatch(source, /from\('cbt_exam_screen_share_exceptions'\)/, file);
    }
    assert.equal((api('students/exam-attempts.service.ts').match(/findScreenShareException\(/g) || []).length, 2, 'mulai + simpan jawaban');
    const monitoring = api('proctor/exam-monitoring.service.ts');
    assert.match(monitoring, /loadScreenShareExceptions\(this\.db, examId\)/);
    assert.match(monitoring, /row\.screen_share_period = screenSharePeriod/);
});

test('SSD-06: pengecualian periode hanya oleh pengelola periode dan tidak dapat dicabut saat siswa mengerjakan', () => {
    const admin = api('proctor/exam-admin.service.ts');
    assert.match(admin, /scope === 'period'\) return this\.setPeriodScreenShareException/);
    const period = admin.slice(admin.indexOf('private async setPeriodScreenShareException'));
    assert.match(period, /assertPasPeriodManage\(user, period\.id, 'write'\)/);
    assert.match(period, /assertPeriodExceptionsAvailable\(this\.db\)/);
    assert.match(period, /status = 'in_progress'[\s\S]*pas_period_id = \$2::uuid/);
    assert.ok(admin.indexOf('assertExamStaff(user, examId)') < admin.indexOf('setPeriodScreenShareException(user'));
    assert.match(api('proctor/dto/proctor.dto.ts'), /@IsIn\(\['exam', 'period'\]\)/);
    assert.match(api('proctor/proctor.controller.ts'), /dto\.scope \?\? 'exam'/);
    const migration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261109_01_pas_screen_share_exceptions.sql'), 'utf8');
    assert.match(migration, /PRIMARY KEY \(pas_period_id, user_id\)/);
    assert.match(migration, /REFERENCES public\.cbt_pas_periods\(id\) ON DELETE CASCADE/);
});

test('SSD-07: panel menawarkan cakupan periode dan mencabut sesuai cakupannya', () => {
    const panel = web('app/components/monitoring/ScreenShareExceptionsPanel.tsx');
    assert.match(panel, /periodWide && period \? 'period' : 'exam'/);
    assert.match(panel, /row\.screen_share_exception\?\.scope === 'period' \? 'period' : 'exam'/);
    assert.match(panel, /Berlakukan untuk semua ujian di/);
    assert.match(web('lib/api/proctor.ts'), /\{ enabled, reason, scope \}/);
});

test('SSD-08: siswa yang tertahan berbagi layar terbuka sendiri setelah pengecualian diberikan', () => {
    const page = web('app/components/questions/ExamPage.tsx');
    assert.match(page, /const waitingForScreenShareException = exam\?\.metadata\?\.screenshot_enabled === true && !screenshots\.sharing &&\s+!isCompleted && \(awaitingStart \|\| screenShareBlocked\)/);
    assert.match(page, /detail\.exam\?\.metadata\?\.screen_share_exception !== true\) return/);
    assert.match(page, /window\.setInterval\(\(\) => void check\(\), 15_000\)/);
    assert.match(page, /unsupportedMessage: screenshots\.unsupportedMessage/);
    const hook = web('hooks/useExamScreenshots.ts');
    assert.match(hook, /screenShareSupport\(currentScreenShareEnvironment\(\)\)/);
    assert.match(hook, /isUnsupportedRejection\(error, currentScreenShareEnvironment\(\)\)/);
    // Server tetap menegakkan aturan: tanpa pengecualian, mulai ditolak.
    assert.match(api('students/exam-attempts.service.ts'), /if \(!exception\) throw new ForbiddenException\('Bagikan seluruh layar sebelum memulai atau melanjutkan ujian\.'\)/);
});
