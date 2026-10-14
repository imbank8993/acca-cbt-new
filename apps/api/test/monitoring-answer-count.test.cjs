const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../../web/tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const { savedAnswerCount, matchesAnswerCount, sortByAnswerCount, unansweredQuestionCount, sortByUnansweredCount } = require('../../web/lib/monitoring-answer-count.ts');
const row = (id, count, total=40) => ({ id, saved_answer_count: count, total_questions: total, profiles: { full_name: id } });

test('answer count orders zero and partial responses first, missing data last, without mutating the roster', () => {
    const rows = [row('full',40),row('unknown',undefined),row('partial',7),row('unstarted',0),row('near-full',39)];
    assert.deepEqual(sortByAnswerCount(rows).map(r=>r.id),['unstarted','partial','near-full','full','unknown']);
    assert.equal(rows[0].id,'full');
});
test('filters support exact zero, exact count, incomplete and complete exams', () => {
    const rows = [row('zero',0),row('part',10),row('full',40),row('unknown',undefined)];
    assert.deepEqual(rows.filter(r=>matchesAnswerCount(r,'0')).map(r=>r.id),['zero']);
    assert.deepEqual(rows.filter(r=>matchesAnswerCount(r,'10')).map(r=>r.id),['part']);
    assert.deepEqual(rows.filter(r=>matchesAnswerCount(r,'incomplete')).map(r=>r.id),['zero','part']);
    assert.deepEqual(rows.filter(r=>matchesAnswerCount(r,'complete')).map(r=>r.id),['full']);
    assert.deepEqual(rows.filter(r=>matchesAnswerCount(r,'unknown')).map(r=>r.id),['unknown']);
    assert.equal(rows.filter(r=>matchesAnswerCount(r,'')).length,4);
});
test('completion respects different exam lengths and does not invent counts for invalid data', () => {
    assert.equal(matchesAnswerCount(row('a',10,10),'complete'),true);
    assert.equal(matchesAnswerCount(row('b',10,40),'complete'),false);
    assert.equal(matchesAnswerCount(row('empty-bank',0,0),'complete'),false);
    for (const count of [null,undefined,-1,1.5,NaN,Infinity]) assert.equal(savedAnswerCount(row('invalid',count)),null);
    assert.equal(matchesAnswerCount(row('a',0),'bad'),false);
});
test('equal counts sort by name then id for stable pagination during refreshes', () => {
    const a=row('a',3);a.profiles.full_name='Zain';
    const b=row('b',3);b.profiles.full_name='Ahmad';
    const c=row('c',3);c.profiles.full_name='Ahmad';
    assert.deepEqual(sortByAnswerCount([a,c,b]).map(r=>r.id),['b','c','a']);
});

test('unanswered priority uses remaining questions rather than the number already saved', () => {
    const rows = [row('short',0,10),row('long',20,100),row('complete',40),row('unknown',undefined)];
    assert.deepEqual(sortByUnansweredCount(rows).map(r=>r.id),['long','short','complete','unknown']);
    assert.equal(rows[0].id,'short');
    assert.equal(unansweredQuestionCount(row('over',45,40)),0);
    assert.equal(unansweredQuestionCount(row('empty',0,0)),null);
    assert.equal(unansweredQuestionCount(row('unknown',undefined)),null);
});

test('incomplete toggle removes completed and unknown counts while retaining zero answers', () => {
    const rows = [row('complete',40),row('zero',0),row('partial',10),row('unknown',undefined)];
    const filtered = sortByUnansweredCount(rows.filter(r=>(unansweredQuestionCount(r) ?? 0)>0));
    assert.deepEqual(filtered.map(r=>r.id),['zero','partial']);
});
