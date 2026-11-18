const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { pendingRecoveryCandidates, uncountedAnswers } = require('../../web/lib/pending-recovery.ts');

const row = (id, status, review, canReset = true) => ({ id, status, canReset, offline_review: review });
const lost = { connection_lost_at_close: { last_seen_at: null, deadline_at: null, gap_seconds: 120 }, uncounted_local_answers: null, late_security_evidence: 0 };
const pending = count => ({ connection_lost_at_close: null, uncounted_local_answers: { count, reported_at: null }, late_security_evidence: 0 });

test('bulk pending recovery lists only finished attempts the user may recover, with reported unsent answers first', () => {
    const { confirmed, possible } = pendingRecoveryCandidates([
        row('reported', 'auto_submitted', pending(5)),
        row('reported-submitted', 'submitted', pending(1)),
        row('no-contact', 'auto_submitted', lost),
        row('clean', 'submitted', null),
        row('still-working', 'in_progress', pending(3)),
        row('no-permission', 'auto_submitted', pending(2), false),
    ]);
    assert.deepEqual(confirmed.map(r => r.id), ['reported', 'reported-submitted']);
    assert.deepEqual(possible.map(r => r.id), ['no-contact']);
    assert.equal(uncountedAnswers(confirmed[0]), 5);
});

test('bulk pending recovery always uses submit-only recovery on the same device, at least 60 minutes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/BulkPendingRecoveryPanel.tsx'), 'utf8');
    // releaseDevice=false, submitOnly=true: siswa tidak dapat mengubah jawaban.
    assert.match(source, /resetExamAttempt\(attempt\.id, reason\.trim\(\), minutes, false, true\)/);
    assert.doesNotMatch(source, /startMakeupExam|SUSULAN/);
    assert.match(source, /PENDING_RECOVERY_MINUTES = \[60, 120\]/);
    // Hanya yang dilaporkan perangkat yang tercentang otomatis.
    assert.match(source, /useState<string\[\]>\(\(\) => confirmed\.map\(attempt => attempt\.id\)\)/);
    const workspace = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/ParticipantsWorkspace.tsx'), 'utf8');
    assert.match(workspace, /\['pending', `Pulihkan jawaban tertunda/);
});
