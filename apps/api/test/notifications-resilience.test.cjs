const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { safeNotificationUrl, mergeNotifications } = require('../../web/lib/notification-safety.ts');
const { NotificationsService } = require('../src/notifications/notifications.service.ts');
const { fixtureDb } = require('./fixture-db.cjs');
for (const input of ['javascript:alert(1)', '//evil.test/x', 'https://evil.test', '/dashboard/../../login', '/dashboard/\\evil.test', '/dashboard/\nattack']) {
    test(`Reject unsafe notification destination ${JSON.stringify(input)}`, () => assert.equal(safeNotificationUrl(input), null));
}
test('Preserve validation deep link and replace duplicate rows on paging', () => {
    const link = '/dashboard/guru/questions/bank?tab=validations&validation=session';
    assert.equal(safeNotificationUrl(link), link);
    assert.deepEqual(mergeNotifications([{ id: '1', read: false }], [{ id: '1', read: true }, { id: '2' }]), [{ id: '1', read: true }, { id: '2' }]);
});
test('Read and delete actions cannot mutate another account notifications', async () => {
    const db = fixtureDb({ cbt_notifications: [{ id: 'own', user_id: 'a', is_read: false }, { id: 'other', user_id: 'b', is_read: false }] });
    const service = new NotificationsService(db);
    await service.markRead({ id: 'a' }, 'other');
    await service.remove({ id: 'a' }, 'other');
    assert.equal(db.tables.cbt_notifications.find(item => item.id === 'other').is_read, false);
    await service.markAllRead({ id: 'a' });
    await service.removeAllRead({ id: 'a' });
    assert.deepEqual(db.tables.cbt_notifications.map(item => item.id), ['other']);
});
test('Unread count failure is surfaced instead of claiming zero', async () => {
    const query = { select() { return this; }, eq() { return this; }, or: async () => ({ error: { message: 'offline' } }) };
    const service = new NotificationsService({ from: () => query });
    await assert.rejects(service.unreadCount({ id: 'a' }), /belum dapat dimuat/);
});
