const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const helpers = require('../../web/lib/monitoring-exams.ts');
const makeExam = patch => ({ id:'math-a', title:'PAS Ganjil', exam_type:'pas',
    metadata:{bank_title:'Matematika XI'}, description:'Matematika XI • Kelas XI A | 2026/2027 | PAS 1',
    start_time:'2026-10-17T00:00:00Z', duration_minutes:90, is_published:true, status:'scheduled', ...patch });

test('same PAS folder reveals bank and class without renaming exams or changing their IDs', () => {
    const a=makeExam({});
    const b=makeExam({id:'biology',metadata:{bank_title:'Biologi XI'}});
    const c=makeExam({id:'math-b',description:'Matematika XI • Kelas XI B | 2026/2027 | PAS 1'});
    assert.notEqual(helpers.monitoringExamLabel(a),helpers.monitoringExamLabel(b));
    assert.notEqual(helpers.monitoringExamLabel(a),helpers.monitoringExamLabel(c));
    // Ujian folder: bank soal lalu kelas; nama folder dan periode menjadi keterangan.
    assert.equal(helpers.monitoringExamLabel(a),'Matematika XI · Kelas XI A');
    assert.equal(helpers.monitoringExamLabel(c),'Matematika XI · Kelas XI B');
    assert.equal(helpers.monitoringExamDetails(a),'PAS Ganjil · 2026/2027 · PAS 1');
    assert.deepEqual(helpers.sortMonitoringExams([c,b,a],0).map(e=>e.id),['biology','math-a','math-b']);
    assert.equal(a.title,'PAS Ganjil'); assert.equal(a.id,'math-a');
    assert.equal(helpers.monitoringExamLabel(makeExam({title:'Harian',metadata:null,description:null})),'Harian');
    assert.equal(helpers.monitoringExamDetails(makeExam({description:null,subject:'Bahasa Arab'})),'Bahasa Arab');
    assert.equal(helpers.monitoringExamLabel(makeExam({metadata:{bank_title:42}})),'Matematika XI · Kelas XI A');
});

test('picker keeps class and schedule visible after selection and forwards distinct exam IDs', () => {
    let props;
    const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/monitoring/MonitoringExamPicker.tsx'),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const dependencies={
        'react': React,
        '@/app/components/ui/inlineselect':{InlineSelect:p=>React.createElement('select',{'aria-label':p['aria-label']},p.options.map(o=>React.createElement('option',{key:o.value},o.label)))},
        '@/components/ui/SearchableSelect':{__esModule:true,default:p=>{props=p;return React.createElement('div',null,'Selector')}},
        '@/lib/monitoring-exams':helpers,
        '@/lib/school-time':{formatSchoolDateTime:(value,zone)=>value+' '+zone},
        '@/lib/useSchoolTimeZone':{useSchoolTimeZone:()=>({timeZone:'Asia/Makassar',error:''})},
        './monitoring-exam-picker.css':{}, 'react/jsx-runtime':require('react/jsx-runtime'),
    };
    const mod={exports:{}};
    new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,name);return dependencies[name]},mod,mod.exports);
    const exams=[makeExam({}),makeExam({id:'math-b',description:'Matematika XI • Kelas XI B | 2026/2027 | PAS 1'})];
    let chosen;
    const html=renderToStaticMarkup(React.createElement(mod.exports.default,{exams,now:Date.parse('2026-10-17T00:01:00Z'),value:'math-b',onChange:v=>chosen=v}));
    assert.match(html,/Kelas XI B/); assert.match(html,/Asia.Makassar/); assert.match(html,/90 menit/);
    assert.equal(props.value,'math-b'); assert.match(props.options[0].label,/^Matematika XI · Kelas XI A$/);
    assert.match(props.options[1].label,/^Matematika XI · Kelas XI B$/);
    assert.match(props.options[0].subLabel,/PAS Ganjil · 2026\/2027 · PAS 1 · .*90 menit/);
    props.onChange('math-a'); assert.equal(chosen,'math-a');
    assert.match(props.searchPlaceholder,/kelas/);
    const unsafe=makeExam({description:'<img src=x onerror=alert(1)>'});
    const escaped=renderToStaticMarkup(React.createElement(mod.exports.default,{exams:[unsafe],now:0,value:unsafe.id,onChange:()=>{}}));
    assert.doesNotMatch(escaped,/<img/); assert.match(escaped,/&lt;img/);
});


test('monitoring categories distinguish ASAS/ASAT, AM, and ordinary exams including legacy values', () => {
    const exams = ['pas','pat','am','asas_asat','daily','pts','pkn','tryout',null].map((exam_type,i)=>makeExam({id:String(i),exam_type,metadata:null}));
    assert.deepEqual(helpers.filterMonitoringExams(exams,'assessment').map(e=>e.exam_type),['pas','pat','am','asas_asat']);
    assert.deepEqual(helpers.filterMonitoringExams(exams,'other').map(e=>e.exam_type),['daily','pts','pkn','tryout',null]);
    assert.equal(helpers.filterMonitoringExams(exams,'all').length,exams.length);
    assert.equal(helpers.monitoringExamBadge(exams[0]),'ASAS/ASAT');
    assert.equal(helpers.monitoringExamBadge(exams[2]),'AM');
    assert.equal(helpers.monitoringExamBadge(exams[4]),null);
});

test('API attributes generated exams to their folder creator and includes every source bank author', async () => {
    const {fixtureDb}=require('./fixture-db.cjs');
    const {AuthorizationService}=require('../src/auth/authorization.service.ts');
    const {ExamAdminService}=require('../src/proctor/exam-admin.service.ts');
    const {groupFolderExams}=require('../../web/lib/monitoring-folder.ts');
    const db=fixtureDb({
        cbt_exams:[
            {id:'generated',organization_id:'school',title:'ASAS',exam_type:'pas',created_by:null,question_bank_id:'bank-a',is_published:true,metadata:{is_pas_exam:true,pas_period_id:'00000000-0000-4000-8000-000000000001'}},
            {id:'ordinary',organization_id:'school',title:'Harian',exam_type:'daily',created_by:'proctor',question_bank_id:'bank-a',is_published:true},
        ],
        cbt_exam_question_sources:[{exam_id:'ordinary',bank_id:'bank-b'}],
        cbt_question_banks:[{id:'bank-a',organization_id:'school',title:'Matematika',created_by:'teacher-a'},{id:'bank-b',organization_id:'school',title:'Peluang',created_by:'teacher-b'}],
        cbt_pas_periods:[{id:'00000000-0000-4000-8000-000000000001',organization_id:'school',created_by:'folder-owner'}],
        cbt_profiles:[{id:'teacher-a',full_name:'Guru A'},{id:'teacher-b',full_name:'Guru B'},{id:'proctor',full_name:'Proktor Ujian'},{id:'folder-owner',full_name:'Pembuat Folder'}],
    });
    const roles={hasOrgRole:async(id,org,allowed)=>id==='proctor'&&org==='school'&&allowed.includes('Proktor')};
    const auth=new AuthorizationService(db,roles,{assertSchoolId:async id=>id});
    const listed=await new ExamAdminService(db,auth,roles).list({id:'proctor'},'school');
    const generated=listed.find(e=>e.id==='generated'),ordinary=listed.find(e=>e.id==='ordinary');
    assert.equal(generated.examCreatorName,'Pembuat Folder');
    assert.deepEqual(generated.questionCreatorNames,['Guru A']);
    assert.equal(ordinary.examCreatorName,'Proktor Ujian');
    assert.deepEqual(ordinary.questionCreatorNames,['Guru A','Guru B']);
    assert.equal(generated.created_by,null);
    assert.equal(ordinary.question_bank_title,'Matematika');
    const grouped=groupFolderExams(listed).list.find(e=>e.id.startsWith('pas:'));
    assert.equal(grouped.examCreatorName,'Pembuat Folder');
    assert.deepEqual(grouped.questionCreatorNames,['Guru A']);
    assert.equal(db.writes.length,0);
    db.tables.cbt_pas_periods[0].organization_id='foreign';
    assert.equal((await new ExamAdminService(db,auth,roles).list({id:'proctor'},'school')).find(e=>e.id==='generated').examCreatorName,null);
});
