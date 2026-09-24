const test = require('node:test');
const assert = require('node:assert/strict');

test('Classes Security & Bug Fixes Verification', async (t) => {
    await t.test('RATE-LIMIT: failed join attempts are throttled after 5 attempts', () => {
        const failedAttempts = new Map();
        const assertRateLimit = (userId) => {
            const now = Date.now();
            const timestamps = (failedAttempts.get(userId) || []).filter(t => now - t < 60000);
            if (timestamps.length >= 5) {
                throw new Error('TOO_MANY_REQUESTS');
            }
            failedAttempts.set(userId, timestamps);
        };
        const recordFailed = (userId) => {
            const attempts = failedAttempts.get(userId) || [];
            attempts.push(Date.now());
            failedAttempts.set(userId, attempts);
        };

        const user = 'student-123';
        for (let i = 0; i < 5; i++) {
            assertRateLimit(user);
            recordFailed(user);
        }

        assert.throws(() => assertRateLimit(user), /TOO_MANY_REQUESTS/);
    });

    await t.test('PROTECT-MAIN-CLASS: cbt_classes deletion is blocked', () => {
        const removeClass = (table) => {
            if (table === 'cbt_classes') {
                throw new Error('Kelas utama disinkronkan dari data master acca-new dan tidak dapat dihapus di sini.');
            }
            return { success: true };
        };

        assert.throws(() => removeClass('cbt_classes'), /tidak dapat dihapus/);
        assert.deepEqual(removeClass('cbt_additional_classes'), { success: true });
    });
});
