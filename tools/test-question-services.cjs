const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { load } = require('./question-test-loader.cjs');
const { QuestionsService } = load('apps/api/src/questions/questions.service.ts');
const { QuestionBanksService } = load('apps/api/src/questions/question-banks.service.ts');
const { ImportsService } = load('apps/api/src/imports/imports.service.ts');
const { AuthorizationService } = load('apps/api/src/auth/authorization.service.ts');

// An in-memory transactional test double, including injected storage failures.
class MemoryDb {
    constructor(state = {}) { this.state = state; this.fail = null; }
    async raw() { return []; }
    async transaction(work) {
        const child = new MemoryDb(structuredClone(this.state)); child.fail = this.fail;
        const result = await work(child); this.state = child.state; return result;
    }
    from(table) {
        const db = this; let action = 'select', payload, single = false, columns = '';
        const filters = []; let limit;
        const query = {
            select(value) { columns = value || ''; return this; },
            eq(key,value) { filters.push(r=>r[key]===value); return this; },
            ilike(key,value) { filters.push(r=>String(r[key]).toLowerCase()===String(value).toLowerCase()); return this; },
            in(key,value) { filters.push(r=>value.includes(r[key])); return this; },
            not(key,op,value) { const ids=value.slice(1,-1).split(',');filters.push(r=>!ids.includes(r[key]));return this; },
            order() { return this; }, limit(n) { limit=n;return this; },
            single() { single=true;return this; }, maybeSingle() { single=true;return this; },
            insert(value) { action='insert';payload=value;return this; },
            update(value) { action='update';payload=value;return this; },
            upsert(value) { action='upsert';payload=value;return this; },
            delete() { action='delete';return this; },
            then(resolve,reject) {
                return Promise.resolve().then(()=>{
                    if(db.fail?.(table,action))return {data:null,error:{message:'injected write failure'}};
                    const all=db.state[table] ||= [];let result=all.filter(r=>filters.every(f=>f(r)));
                    if(action==='insert'||action==='upsert'){
                        result=(Array.isArray(payload)?payload:[payload]).map(r=>({id:r.id||randomUUID(),...structuredClone(r)}));
                        for(const row of result){const old=all.find(r=>r.id===row.id);if(old&&action==='upsert')Object.assign(old,row);else all.push(row);}
                    } else if(action==='update') result.forEach(r=>Object.assign(r,structuredClone(payload)));
                    else if(action==='delete') db.state[table]=all.filter(r=>!result.includes(r));
                    if(limit!==undefined)result=result.slice(0,limit);
                    result=structuredClone(result);
                    if(table==='cbt_bank_questions'&&columns.includes('bank_question_options:')) result=result.map(q=>({...q,bank_question_options:(db.state.cbt_bank_question_options||[]).filter(o=>o.question_id===q.id)}));
                    if(table==='cbt_question_banks'&&columns.includes('bank_questions:')) result=result.map(b=>({...b,bank_questions:(db.state.cbt_bank_questions||[]).filter(q=>q.bank_id===b.id)}));
                    return {data:single?result[0]||null:result,error:null};
                }).then(resolve,reject);
            },
        };return query;
    }
}
const user={id:'teacher',roles:['GURU']};
const roles={hasOrgRole:async(id,org,wanted)=>org==='org-1'&&wanted.includes(id==='teacher'?'Guru':id==='proctor'?'Proktor':'Admin')};
const schoolScope={assertSchoolId:async id=>{
    if(id!=='org-1')throw new Error('ID sekolah tidak sesuai');
    return id;
}};
const base=()=>new MemoryDb({
    cbt_question_banks:[{id:'bank',organization_id:'org-1',created_by:'teacher'},{id:'other',organization_id:'org-1',created_by:'someone'}],
    bank_folders:[{id:'folder',organization_id:'org-1'},{id:'foreign',organization_id:'org-2'}],
    cbt_answers:[],cbt_exam_attempt_questions:[],cbt_exam_question_sources:[],cbt_exams:[],cbt_exam_attempts:[],
});
let count=0;
async function test(name,fn){await fn();console.log('PASS',name);count++;}
(async()=>{
    await test('Teacher cannot modify another teacher bank; staff limited to organization',async()=>{
        const db=base(),auth=new AuthorizationService(db,roles,schoolScope);
        await assert.rejects(auth.assertBankAccess(user,'other'));
        await auth.assertBankAccess({id:'proctor'},'other');
        await auth.assertBankAccess({id:'admin'},'other');
        db.state.cbt_question_banks.push({id:'foreign',organization_id:'org-2'});
        await assert.rejects(auth.assertBankAccess({id:'proctor'},'foreign'));
    });
    await test('Create, update and move reject foreign folders before mutation',async()=>{
        const db=base(),auth=new AuthorizationService(db,roles,schoolScope),svc=new QuestionBanksService(db,auth,roles,{emailMap:async()=>new Map()});
        for(const work of [()=>svc.create(user,'org-1',{title:'x',folderId:'foreign'}),()=>svc.update(user,'bank',{folderId:'foreign'}),()=>svc.moveToFolder(user,['bank'],'foreign')])await assert.rejects(work);
        assert.equal(db.state.cbt_question_banks.length,2);assert.equal(db.state.cbt_question_banks[0].folder_id,undefined);
        await svc.moveToFolder(user,['bank'],'folder');assert.equal(db.state.cbt_question_banks[0].folder_id,'folder');
    });
    await test('Save retains identical texts with different weights; [] removes all options',async()=>{
        const db=base(),svc=new QuestionsService(db,new AuthorizationService(db,roles,schoolScope),{regradeExamAttemptsByQuestion:async()=>{}});
        const dto={bankId:'bank',questionText:'Question',type:'mcq',difficulty:'medium',scoreDefault:1,options:[{text:'Same',isCorrect:false,weight:2},{text:'Same',isCorrect:false,weight:3}]};
        const saved=await svc.save(user,dto);
        assert.equal(db.state.cbt_bank_question_options.length,2);
        assert.equal((await svc.listByBank(user,'bank'))[0].bank_question_options.length,2);
        await svc.save(user,{...dto,id:saved.id,options:[]});assert.equal(db.state.cbt_bank_question_options.length,0);
    });
    await test('Failed option save rolls back question text and existing options',async()=>{
        const db=base(),svc=new QuestionsService(db,new AuthorizationService(db,roles,schoolScope),{regradeExamAttemptsByQuestion:async()=>{}});
        db.state.cbt_bank_questions=[{id:'question',bank_id:'bank',question_text:'Original'}];
        db.state.cbt_bank_question_options=[{id:'old',question_id:'question',option_text:'Original'}];
        const before=structuredClone(db.state);db.fail=(t,a)=>t==='cbt_bank_question_options'&&a==='insert';
        await assert.rejects(svc.save(user,{id:'question',bankId:'bank',questionText:'Changed',options:[{text:'New',isCorrect:true}]}));
        assert.deepEqual(db.state,before);
    });
    await test('Actual cbt_answers references cause soft deletion and preserve options',async()=>{
        const db=base(),auth=new AuthorizationService(db,roles,schoolScope),svc=new QuestionsService(db,auth,{});
        db.state.cbt_bank_questions=[{id:'question',bank_id:'bank',metadata:{key:'preserved'}}];
        db.state.cbt_bank_question_options=[{id:'option',question_id:'question',option_text:'Historical option'}];
        db.state.cbt_answers=[{id:'answer',attempt_id:'attempt',question_id:'question'}];
        const result=await svc.remove(user,'question','bank');assert.equal(result.softDeleted,true);
        assert.equal((await svc.listByBank(user,'bank')).length,0);assert.equal(db.state.cbt_bank_questions[0].metadata.key,'preserved');
        assert.equal(db.state.cbt_answers.length,1);assert.equal(db.state.cbt_bank_question_options.length,1);
        const banks=new QuestionBanksService(db,auth,roles,{emailMap:async()=>new Map()});
        assert.equal((await banks.list(user,'org-1'))[0].question_count,0);
    });
    await test('An unanswered question is protected once its bank has an attempt',async()=>{
        const db=base(),svc=new QuestionsService(db,new AuthorizationService(db,roles,schoolScope),{});
        db.state.cbt_bank_questions=[{id:'question',bank_id:'bank',metadata:{}}];
        db.state.cbt_exams=[{id:'exam',question_bank_id:'bank'}];
        db.state.cbt_exam_attempts=[{id:'attempt',exam_id:'exam'}];
        const result=await svc.remove(user,'question','bank');
        assert.equal(result.softDeleted,true);assert.equal(db.state.cbt_bank_questions.length,1);
    });
    await test('Historical questions allow text/option updates but metadata and reorder are protected',async()=>{
        const db=base(),auth=new AuthorizationService(db,roles,schoolScope),svc=new QuestionsService(db,auth,{regradeExamAttemptsByQuestion:async()=>{}});
        db.state.cbt_bank_questions=[{id:'question',bank_id:'bank',question_text:'Historical',metadata:{order_index:0}}];
        db.state.cbt_exams=[{id:'exam',question_bank_id:'bank'}];
        db.state.cbt_exam_attempts=[{id:'attempt',exam_id:'exam'}];
        await svc.save(user,{id:'question',bankId:'bank',questionText:'Changed'});
        assert.equal(db.state.cbt_bank_questions[0].question_text,'Changed');
        await assert.rejects(()=>svc.updateMetadata(user,'question',{order_index:1}),/tidak dapat diubah/);
        await assert.rejects(()=>svc.reorder(user,'bank',['question']),/tidak dapat diubah/);
    });
    await test('New questions and imports cannot change a bank after an attempt starts',async()=>{
        const db=base(),auth=new AuthorizationService(db,roles,schoolScope);
        db.state.cbt_exams=[{id:'exam',question_bank_id:'bank'}];
        db.state.cbt_exam_attempts=[{id:'attempt',exam_id:'exam'}];
        const questions=new QuestionsService(db,auth,{regradeExamAttemptsByQuestion:async()=>{}});
        const imports=new ImportsService(db,auth);
        await assert.rejects(()=>questions.save(user,{bankId:'bank',questionText:'Late question'}),/tidak dapat menambah/);
        await assert.rejects(()=>imports.bulkImport(user,'bank',[{question_text:'Late import'}]),/tidak dapat diimpor ulang/);
        assert.equal(db.state.cbt_bank_questions?.length||0,0);
    });
    await test('A bank referenced by an exam cannot be deleted',async()=>{
        const db=base(),auth=new AuthorizationService(db,roles,schoolScope),svc=new QuestionBanksService(db,auth,roles,{emailMap:async()=>new Map()});
        db.state.cbt_exams=[{id:'exam',question_bank_id:'bank'}];
        await assert.rejects(()=>svc.remove(user,'bank'),/tidak dapat dihapus/);
        assert.ok(db.state.cbt_question_banks.some(bank=>bank.id==='bank'));
    });
    await test('Deleting own question does not authorize deletion of arbitrary image URLs',async()=>{
        const db=base(),svc=new QuestionsService(db,new AuthorizationService(db,roles,schoolScope),{});
        db.state.cbt_bank_questions=[{id:'question',bank_id:'bank',question_text:'<img src="https://foreign.r2.dev/victim.png">'}];
        assert.deepEqual((await svc.remove(user,'question','bank')).orphanedImages,[]);
    });
    const question={question_text:'Imported',type:'mcq',metadata:{import_stimulus:'New stimulus'},options:[{option_text:'a',is_correct:true},{option_text:'b',is_correct:false}]};
    await test('Bulk import rolls back companion records and questions when options fail',async()=>{
        const db=base(),svc=new ImportsService(db,new AuthorizationService(db,roles,schoolScope));
        const before=structuredClone(db.state);db.fail=(t,a)=>t==='cbt_bank_question_options'&&a==='insert';
        await assert.rejects(svc.bulkImport(user,'bank',[question]));assert.deepEqual(db.state,before);
    });
    await test('Imported ordering keys reference new option IDs; full options preserved',async()=>{
        const db=base(),svc=new ImportsService(db,new AuthorizationService(db,roles,schoolScope));
        const result=await svc.bulkImport(user,'bank',[{...question,type:'ordering',metadata:{correct_order:['2','1']}}]);
        assert.equal(result.imported,1);assert.equal(result.failed,0);
        const options=db.state.cbt_bank_question_options;
        assert.deepEqual(db.state.cbt_bank_questions[0].metadata.correct_order,[options[1].id,options[0].id]);
    });
    await test('Bulk import preserves template order and each question stimulus',async()=>{
        const db=base(),svc=new ImportsService(db,new AuthorizationService(db,roles,schoolScope));
        db.state.cbt_bank_questions=[
            {id:'existing-b',bank_id:'bank',question_text:'Existing 2',created_at:'2026-01-01T00:00:00Z',metadata:{}},
            {id:'existing-a',bank_id:'bank',question_text:'Existing 1',created_at:'2025-01-01T00:00:00Z',metadata:{}},
        ];
        const rows=['Satu','Dua','Tiga'].map((name,index)=>({
            ...question,
            question_text:`Soal ${name}`,
            metadata:{import_stimulus:`Stimulus ${name}`,stimulus_title:`Bacaan ${name}`,_stimulus_code:String(index+1)},
        }));
        const result=await svc.bulkImport(user,'bank',rows);
        assert.equal(result.imported,3);
        const imported=result.questionIds.map(id=>db.state.cbt_bank_questions.find(q=>q.id===id));
        assert.deepEqual(imported.map(q=>q.metadata.order_index),[2,3,4]);
        assert.deepEqual(
            imported.map(q=>db.state.cbt_question_stimuli.find(s=>s.id===q.stimulus_id)?.content),
            ['Stimulus Satu','Stimulus Dua','Stimulus Tiga'],
        );
        assert.deepEqual(
            db.state.cbt_bank_questions.filter(q=>q.id.startsWith('existing-'))
                .sort((a,b)=>a.metadata.order_index-b.metadata.order_index).map(q=>q.id),
            ['existing-a','existing-b'],
        );
    });
    console.log(`Completed ${count} service regression checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
