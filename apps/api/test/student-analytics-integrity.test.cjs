const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { StudentAnalyticsService, analyticsDuration, analyticsScore } = require('../src/analytics/student-analytics.service.ts');
const user = { id: 'student' };
const exam = (id, overrides = {}) => ({ id, organization_id: 'school', show_results: true, title: id,
    duration_minutes: 60, end_time: '2026-09-19T02:00:00Z', metadata: {},
    question_banks: { subject: 'Matematika' }, ...overrides });
const attempt = (id, examId, score, overrides = {}) => ({ id, exam_id: examId, user_id: user.id,
    exams: exam(examId), status: 'submitted', total_score: score, needs_manual_grading: false,
    started_at: '2026-09-19T00:00:00Z', finished_at: '2026-09-19T00:10:00Z',
    personal_end_time: '2026-09-19T01:00:00Z', metadata: {}, ...overrides });
function fixture(rows = [attempt('a', 'exam', 80)], extra = {}, failures = []) {
    return fixtureDb({ cbt_exam_attempts: rows,
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }], ...extra }, failures);
}

test('null, nonfinite, out-of-range and provisional scores never become zero; actual zero is valid', () => {
    for (const value of [null, undefined, NaN, Infinity, -1, 101, 'bad', '', ' ', false, [], {}]) assert.equal(analyticsScore(attempt('a','e', value)), null);
    assert.equal(analyticsScore(attempt('a','e', 0)), 0);
    assert.equal(analyticsScore(attempt('a','e', '80.5')), 80.5);
    assert.equal(analyticsScore(attempt('a','e', 80, { needs_manual_grading: true })), null);
    assert.equal(analyticsScore(attempt('a','e', 80, { metadata: { relative_scoring_pending: true } })), null);
});
test('overview averages only latest released final scores, retaining zero and original precision', async () => {
    const rows = [attempt('a','e1',80.25), attempt('b','e2',60), attempt('old','e1',100,{ finished_at: '2026-09-18T00:01:00Z' }),
        attempt('pending','e3',null), attempt('manual','e4',70,{needs_manual_grading:true}),
        attempt('hidden','e5',100,{exams:exam('e5',{show_results:false})}), attempt('active','e6',100,{status:'in_progress'}),
        attempt('other','e7',100,{user_id:'other'})];
    const r = await new StudentAnalyticsService(fixture(rows)).overview(user);
    assert.equal(r.overview.averageScore,70.13); assert.equal(r.overview.totalExams,2);
    assert.equal(r.dataQuality.excludedAttempts,2);
    assert.equal(r.performanceTrend.find(row => row.examTitle === 'e1').score,80.25);
    assert.equal(r.subjectPerformance[0].subjectName,'Matematika');
    assert.equal(r.subjectPerformance[0].totalExams,2);
    assert.equal(r.comparison,null); assert.equal(r.overview.rank,null);
});
test('late upload, submit intent, recovery and invalid timestamps have honest durations', () => {
    assert.equal(analyticsDuration(attempt('a','e',80,{finished_at:'2026-09-19T03:00:00Z'})),3600);
    assert.equal(analyticsDuration(attempt('a','e',80,{metadata:{submit_intent_at:'2026-09-19T00:05:00Z'}})),300);
    assert.equal(analyticsDuration(attempt('a','e',80,{finished_at:'2026-09-19T03:00:00Z',
        personal_end_time:'2026-09-19T02:30:00Z',metadata:{proctor_recovery_until:'2026-09-19T02:30:00Z'}})),9000);
    assert.equal(analyticsDuration(attempt('a','e',80,{started_at:'invalid'})),null);
    assert.equal(analyticsDuration(attempt('a','e',80,{finished_at:'2026-09-18T00:00:00Z'})),null);
    assert.equal(analyticsDuration(attempt('a','e',80,{finished_at:'2026-09-19T00:00:00Z'})),0);
});
test('competition ranking handles ties and compares complete equal exam sets only', async () => {
    const rows = [attempt('a','e1',80),attempt('b','e2',80)];
    for (const [id,score] of [['tie',80],['higher',90],['lower',50]])
        for (const e of ['e1','e2']) rows.push(attempt(id+e,e,score,{user_id:id}));
    rows.push(attempt('partial','e1',100,{user_id:'partial'}),attempt('foreign','e1',100,{user_id:'foreign'}),
        attempt('unrelated','else',100,{user_id:'lower'}));
    const members = ['student','tie','higher','lower','partial'].map(user_id => ({user_id,organization_id:'school',is_active:true}));
    const r = await new StudentAnalyticsService(fixture(rows,{cbt_organization_members:members})).overview(user);
    assert.equal(r.overview.rank,2); assert.equal(r.overview.totalStudents,4);
    assert.equal(r.overview.percentile,33); assert.equal(r.comparison.totalPeers,3);
    assert.equal(r.comparison.classAverage,73.33); assert.equal(r.comparison.difference,6.67);
    assert.equal(r.comparison.scope,'same-exams');
});
test('zero cohort averages do not divide by zero or imply missing data', async () => {
    const db = fixture([attempt('a','e',0),attempt('peer','e',0,{user_id:'peer'})],{
        cbt_organization_members: ['student','peer'].map(user_id=>({user_id,organization_id:'school',is_active:true})) });
    const r = await new StudentAnalyticsService(db).overview(user);
    assert.equal(r.overview.rank,1); assert.equal(r.overview.percentile,0);
    assert.equal(r.comparison.classAverage,0); assert.equal(r.comparison.difference,0);
    assert.equal(r.comparison.betterThanClass,null);
});
test('unreleased discussion counts activity without reading snapshots or correctness', async () => {
    const db = fixture(); const r = await new StudentAnalyticsService(db).overview(user);
    assert.equal(r.overview.averageScore,80); assert.equal(r.dataQuality.analyzedExams,0);
    assert.deepEqual(r.strengthsWeaknesses,[]);
    assert.ok(r.difficultyPerformance.every(row=>row.percentage===null));
    assert.ok(!db.queries.some(q=>q.table==='cbt_exam_question_snapshots'));
    const answerQuery=db.queries.find(q=>q.table==='cbt_answers');
    assert.ok(answerQuery);
    assert.doesNotMatch(answerQuery.calls.find(call=>call[0]==='select')[1], /is_correct/);
});
test('snapshot denominator includes unanswered questions and excludes uncertain/subjective grading', async () => {
    const row = attempt('a','e',60); row.exams.metadata.show_answer_keys=true;
    const questions = [1,2,3,4,5].map(n=>({id:'q'+n,type:'mcq',difficulty:'easy'}));
    questions.push({id:'unknown',type:'short_answer',difficulty:'hard'}, {id:'personality',type:'likert',difficulty:'hard'},
        {id:'no-difficulty',type:'mcq',difficulty:null});
    const db=fixture([row],{
        cbt_exam_question_snapshots:questions.map(question_snapshot=>({exam_id:'e',question_snapshot})),
        cbt_answers:[1,2,3].map(n=>({attempt_id:'a',question_id:'q'+n,is_correct:true,selected_option_id:'selected'}))
            .concat([{attempt_id:'a',question_id:'unknown',is_correct:null,essay_answer:'response'}]),
    });
    const r=await new StudentAnalyticsService(db).overview(user);
    const easy=r.difficultyPerformance.find(row=>row.difficulty==='easy');
    assert.equal(easy.totalQuestions,5); assert.equal(easy.correctAnswers,3); assert.equal(easy.percentage,60);
    assert.equal(r.subjectPerformance[0].questionTypeBreakdown[0].total,6);
    assert.equal(r.dataQuality.unknownGrades,1); assert.equal(r.studyHabits.averageQuestionsPerMinute,0.4);
    assert.ok(!JSON.stringify(r).includes('response')); assert.ok(!JSON.stringify(r).includes('selected'));
});
test('legacy exams without snapshots are not analyzed against mutable current bank questions', async () => {
    const row=attempt('a','e',80); row.exams.metadata.show_answer_keys=true;
    const r=await new StudentAnalyticsService(fixture([row])).overview(user);
    assert.equal(r.dataQuality.analyzedExams,0); assert.equal(r.studyHabits.averageQuestionsPerMinute,0);
    assert.ok(r.difficultyPerformance.every(row=>row.totalQuestions===0));
});
test('invalid timing and tiny samples do not invent speed or learning recommendations', async () => {
    const row=attempt('a','e',0,{started_at:'invalid'}); row.exams.metadata.show_answer_keys=true;
    const r=await new StudentAnalyticsService(fixture([row],{
        cbt_exam_question_snapshots:[{exam_id:'e',question_snapshot:{id:'q',type:'mcq',difficulty:'hard'}}],
    })).overview(user);
    assert.equal(r.overview.totalStudyTime,null); assert.equal(r.studyHabits.fastestCompletion,null);
    assert.equal(r.studyHabits.averageQuestionsPerMinute,null); assert.deepEqual(r.strengthsWeaknesses,[]);
    assert.ok(!JSON.stringify(r).includes('Afternoon'));
});
test('foreign-school results and inactive membership cannot expose analytics', async () => {
    const foreign=attempt('foreign','foreign',100,{exams:exam('foreign',{organization_id:'other-school'})});
    const r=await new StudentAnalyticsService(fixture([attempt('own','e',50),foreign])).overview(user);
    assert.equal(r.overview.totalExams,1); assert.equal(r.overview.averageScore,50);
    await assert.rejects(new StudentAnalyticsService(fixture(undefined,{cbt_organization_members:[]})).overview(user),e=>e.getStatus()===403);
});
test('failed reads are errors rather than empty analytics, zeros or hidden permission decisions', async () => {
    for(const table of ['cbt_exam_attempts','cbt_organization_members']) {
        const service=new StudentAnalyticsService(fixture(undefined,{},[table]));
        await assert.rejects(service.overview(user),e=>e.getStatus()===500);
        await assert.rejects(service.history(user),e=>e.getStatus()===500);
        await assert.rejects(service.comparison(user),e=>e.getStatus()===500);
    }
    const row=attempt('a','e',80); row.exams.metadata.show_answer_keys=true;
    for(const table of ['cbt_answers','cbt_exam_question_snapshots'])
        await assert.rejects(new StudentAnalyticsService(fixture([row],{},[table])).overview(user),e=>e.getStatus()===500);
});
test('history limit is bounded, integral and applied to released final scores', async () => {
    const service=new StudentAnalyticsService(fixture([attempt('a','e1',80),attempt('b','e2',0),attempt('pending','e3',null)]));
    assert.equal((await service.history(user,1.8)).length,1);
    assert.equal((await service.history(user,0.8)).length,2);
    assert.equal((await service.history(user,NaN)).length,2);
    assert.equal((await service.history(user,-1)).length,2);
});
test('speed counts answered questions including subjective responses, not empty questions', async () => {
    const row=attempt('a','e',80); row.exams.metadata.show_answer_keys=true;
    const db=fixture([row],{
        cbt_exam_question_snapshots:['mcq','likert','short_answer'].map((type,index)=>({exam_id:'e',question_snapshot:{id:'q'+index,type,difficulty:'easy'}})),
        cbt_answers:[{attempt_id:'a',question_id:'q0',is_correct:true,selected_option_id:'choice'},
            {attempt_id:'a',question_id:'q1',is_correct:null,essay_answer:'3'}],
    });
    const r=await new StudentAnalyticsService(db).overview(user);
    assert.equal(r.studyHabits.averageQuestionsPerMinute,0.2); // 2 responses / 10 minutes.
    assert.equal(r.difficultyPerformance[0].totalQuestions,2);
    assert.equal(r.difficultyPerformance[0].correctAnswers,1);
});

test('speed uses matching timed exams, counts each response once and does not depend on snapshots or keys', async () => {
    const db = fixture([
        attempt('a','e1',80),
        attempt('b','e2',60,{finished_at:'2026-09-19T00:20:00Z'}),
        attempt('invalid','e3',70,{started_at:'invalid'}),
        attempt('zero','e4',70,{finished_at:'2026-09-19T00:00:00Z'}),
        attempt('hidden','e5',90,{exams:exam('e5',{show_results:false})}),
    ], {cbt_answers:[
        {attempt_id:'a',question_id:'q1',selected_option_id:'choice'},
        {attempt_id:'a',question_id:'q1',selected_option_id:'choice'},
        {attempt_id:'a',question_id:'q2',essay_answer:'essay'},
        {attempt_id:'a',question_id:'empty',essay_answer:'  '},
        {attempt_id:'b',question_id:'q3',essay_answer:'3'},
        ...['invalid','zero','hidden','foreign'].map(attempt_id=>({attempt_id,question_id:'q',selected_option_id:'choice'})),
    ]});
    const r=await new StudentAnalyticsService(db).overview(user);
    assert.equal(r.studyHabits.averageQuestionsPerMinute,0.1); // 3 responses / 30 minutes.
    assert.equal(r.studyHabits.speedMeasuredExams,2);
    assert.equal(r.studyHabits.speedAnsweredQuestions,3);
    assert.equal(r.dataQuality.analyzedExams,0);
    assert.ok(!JSON.stringify(r).includes('choice'));
});
