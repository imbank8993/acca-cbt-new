const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { examMatchingScoringRule, applyMatchingScoringRule } = require('../src/common/complex-scoring.ts');
const { loadFrozenExamQuestions, readExamQuestionVersion } = require('../src/common/exam-question-snapshots.ts');
const { GradingService } = require('../src/grading/grading.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { normalizePasExamSettings, resolvePasExamSettings, pasExamSettingsUpdate, storedPasExamSettings } = require('../src/common/pas-exam-settings.ts');
const EXAM = '33333333-3333-4333-8333-333333333333';
const BANK = '11111111-1111-4111-8111-111111111111';
const q = { id:'match', type:'matching', score_default:4, metadata:{other:'keep'}, bank_question_options:[{id:'s',metadata:{match_text:'X'}}] };

test('old exams stay proportional; the matching rule is independent of B/S', () => {
    assert.equal(examMatchingScoringRule(null),'proportional');
    assert.equal(examMatchingScoringRule({complex_scoring_rule:'official'}),'proportional');
    assert.equal(examMatchingScoringRule({matching_scoring_rule:'official'}),'official');
    assert.strictEqual(applyMatchingScoringRule(q,'proportional'),q);
    const marked=applyMatchingScoringRule(q,'official');
    assert.equal(marked.metadata.matching_scoring,'official');
    assert.equal(q.metadata.matching_scoring,undefined);
    assert.equal(applyMatchingScoringRule(marked,'proportional').metadata.matching_scoring,'proportional');
    const pg={type:'mcq',metadata:{}};assert.strictEqual(applyMatchingScoringRule(pg,'official'),pg);
});

test('snapshot reads carry exam matching rules without rewriting the frozen question',async()=>{
    for(const rule of ['official','proportional']){
        const db=fixtureDb({cbt_exams:[{id:EXAM,metadata:{matching_scoring_rule:rule}}],
            cbt_exam_question_snapshots:[{exam_id:EXAM,order_number:0,question_snapshot:structuredClone(q)}]});
        const frozen=await loadFrozenExamQuestions(db,EXAM);
        assert.equal(frozen[0].metadata.matching_scoring,rule==='official'?'official':undefined);
        assert.equal(frozen[0].metadata.other,'keep');
        assert.equal(db.tables.cbt_exam_question_snapshots[0].question_snapshot.metadata.matching_scoring,undefined);
        assert.deepEqual(await readExamQuestionVersion(db,EXAM),frozen);
    }
});

test('matching rules reach the normal grading payload',async()=>{
    const db=fixtureDb({cbt_exams:[{id:EXAM,exam_type:'daily',metadata:{matching_scoring_rule:'official'}}],
        cbt_exam_question_snapshots:[{exam_id:EXAM,order_number:0,question_snapshot:structuredClone(q)}],
        cbt_exam_attempts:[{id:'attempt',exam_id:EXAM,status:'submitted',total_score:null,metadata:{}}],cbt_answers:[]});
    const sent=[];const scoring={post:async(url,body)=>{sent.push(body);return {items:[],total_score:0,max_possible_score:4,scaled_score:0,needs_manual_grading:false,dimension_scores:{}}}};
    await new GradingService(db,{},scoring).gradeAttemptFromSavedAnswers('attempt');
    assert.equal(sent[0].items[0].question.metadata.matching_scoring,'official');
});

test('folder matching choices override banks, preserve old defaults, and lock started exams',()=>{
    assert.equal(storedPasExamSettings({}).defaults.matching_scoring,'proportional');
    const config=normalizePasExamSettings({defaults:{matching_scoring:'official'},banks:{[BANK]:{matching_scoring:'proportional'}}});
    assert.equal(resolvePasExamSettings(config,BANK).matching_scoring,'proportional');
    const settings=resolvePasExamSettings(config,null);
    const fresh=pasExamSettingsUpdate({id:EXAM,metadata:{complex_scoring_rule:'official'}},settings,false);
    assert.equal(fresh.update.metadata.matching_scoring_rule,'official');
    const locked=pasExamSettingsUpdate({id:EXAM,metadata:{complex_scoring_rule:'official'}},settings,true);
    assert.equal(locked.scoringRuleLocked,true);
    assert.equal(locked.update.metadata.matching_scoring_rule,undefined);
    assert.throws(()=>normalizePasExamSettings({defaults:{matching_scoring:'other'}}),/Menjodohkan/);
});

function service(metadata={},started=false){
    const db=fixtureDb({cbt_exams:[{id:EXAM,organization_id:BANK,exam_type:'daily',status:'draft',metadata}],
        cbt_exam_attempts:started?[{id:'attempt',exam_id:EXAM}]:[]});
    const s=Object.create(ExamAdminService.prototype);s.db=db;
    s.settings={getSchoolTimeZone:async()=> 'Asia/Makassar'};s.resolveOrganizationId=async()=>BANK;
    s.assertMayUseExamType=async()=>{};s.authz={assertExamStaff:async()=>{}};
    return {s,db};
}
const edit=(extra={})=>({title:'UH',examType:'daily',duration:60,...extra});
test('ordinary exam can choose matching scoring before students start; omitting the choice preserves it',async()=>{
    const {s,db}=service();
    assert.equal(s.buildMetadata('daily',edit(),{}).matching_scoring_rule,'proportional');
    await s.update({id:'staff'},EXAM,edit({matchingScoringRule:'official'}));
    assert.equal(db.tables.cbt_exams[0].metadata.matching_scoring_rule,'official');
    await s.update({id:'staff'},EXAM,edit());
    assert.equal(db.tables.cbt_exams[0].metadata.matching_scoring_rule,'official');
});
test('ordinary exam rejects matching rule changes after a student starts but accepts unchanged rules',async()=>{
    const {s,db}=service({},true);
    await assert.rejects(s.update({id:'staff'},EXAM,edit({matchingScoringRule:'official'})),/Menjodohkan tidak dapat diubah/);
    await s.update({id:'staff'},EXAM,edit({matchingScoringRule:'proportional'}));
    assert.equal(db.tables.cbt_exams[0].metadata.matching_scoring_rule,'proportional');
});
test('DTO rejects unknown matching scoring rules',async()=>{
    require('reflect-metadata');const {plainToInstance}=require('class-transformer');const {validate}=require('class-validator');
    const {UpdateExamDto}=require('../src/proctor/dto/proctor.dto.ts');
    for(const matchingScoringRule of ['official','proportional','bad']){
        const errors=await validate(plainToInstance(UpdateExamDto,edit({matchingScoringRule})));
        assert.equal(errors.some(e=>e.property==='matchingScoringRule'),matchingScoringRule==='bad');
    }
});
