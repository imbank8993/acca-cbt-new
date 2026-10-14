const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
function fixture(total=216,started=204) {
    const db=fixtureDb({
        cbt_exams:[{id:'exam',end_time:'2026-09-20T02:00:00Z',duration_minutes:60}],
        cbt_exam_targets:[{exam_id:'exam',class_id:'class'}],
        cbt_class_members:Array.from({length:total},(_,i)=>({user_id:'u'+i,class_id:'class',profiles:{full_name:'Student '+i},classes:{name:'Class'}})),
        cbt_exam_attempts:Array.from({length:started},(_,i)=>({id:'a'+i,user_id:'u'+i,exam_id:'exam',status:'in_progress',
            started_at:'2026-09-20T00:00:00Z',personal_end_time:'2026-09-20T01:00:00Z',metadata:{},profiles:{full_name:'Student '+i}})),
        cbt_exam_question_snapshots:[{exam_id:'exam',question_snapshot:{id:'q',type:'mcq'}}],
    },[],{now:'2026-09-20T00:30:00Z'});
    const grading={retryPendingAutoSubmissions:async()=>{},gradeAttemptFromSavedAnswers:async()=>null};
    const service=new ExamMonitoringService(db,{assertExamMonitoring:async()=>{}},{},grading,{});
    return {db,service};
}
test('216 assigned students include 204 active and 12 unstarted without per-student transactions',async()=>{
    const {db,service}=fixture(); let transactions=0;
    const transact=db.transaction.bind(db);db.transaction=async(...args)=>{transactions++;return transact(...args)};
    const rows=await service.listAttempts({id:'staff'},'exam');
    assert.equal(rows.length,216);assert.equal(rows.filter(r=>r.status==='in_progress').length,204);
    assert.equal(rows.filter(r=>r.status==='belum').length,12);assert.equal(transactions,0);
    assert.equal(new Set(rows.map(r=>r.user_id)).size,216);
    assert.equal(db.writes.length,0);
});
test('large roster has no 100/216/300 row cap',async()=>{
    const {service}=fixture(620,604);
    assert.equal((await service.listAttempts({id:'staff'},'exam')).length,620);
});
test('only expired sessions are locked; grace, recovery and active submit intent remain respected',async()=>{
    const {db,service}=fixture(4,4);let transactions=0;
    db.tables.cbt_exam_attempts[0].personal_end_time='2026-09-20T00:00:00Z';
    db.tables.cbt_exam_attempts[1].personal_end_time='2026-09-20T00:29:30Z';
    db.tables.cbt_exam_attempts[2].personal_end_time='2026-09-20T00:00:00Z';
    db.tables.cbt_exam_attempts[2].metadata.submit_intent_at='2026-09-20T00:29:30Z';
    db.tables.cbt_exam_attempts[3].personal_end_time='2026-09-20T01:00:00Z';
    db.tables.cbt_exam_attempts[3].metadata.proctor_recovery_until='2026-09-20T01:00:00Z';
    const transact=db.transaction.bind(db);db.transaction=async(...args)=>{transactions++;return transact(...args)};
    await service.finalizeExpired('exam');
    assert.equal(transactions,1);assert.equal(db.tables.cbt_exam_attempts[0].status,'auto_submitted');
    assert.ok(db.tables.cbt_exam_attempts.slice(1).every(r=>r.status==='in_progress'));
});
test('roster read failures cannot silently erase assigned participants',async()=>{
    const {db}=fixture();
    for(const table of ['cbt_exam_targets','cbt_class_members','cbt_exam_participants']){
        const broken=fixtureDb(db.tables,[table],{now:'2026-09-20T00:30:00Z'});
        const service=new ExamMonitoringService(broken,{assertExamMonitoring:async()=>{}},{},{retryPendingAutoSubmissions:async()=>{}},{});
        await assert.rejects(service.listAttempts({id:'staff'},'exam'),/belum dapat dibaca/);
    }
});
test('missing individual profile does not remove an assigned student',async()=>{
    const {db,service}=fixture(0,0);db.tables.cbt_exam_participants=[{exam_id:'exam',user_id:'missing-profile'}];
    const rows=await service.listAttempts({id:'staff'},'exam');
    assert.equal(rows.length,1);assert.equal(rows[0].user_id,'missing-profile');assert.equal(rows[0].status,'belum');
});
