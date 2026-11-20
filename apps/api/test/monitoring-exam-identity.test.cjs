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
    assert.equal(helpers.monitoringExamDetails(a),'ASAS Ganjil · 2026/2027 · ASAS 1');
    assert.equal(helpers.monitoringFolderName(a),'ASAS Ganjil');
    assert.equal(helpers.monitoringAssessmentPeriod('2026/2027 · PAS ganjil'),'2026/2027 · ASAS Ganjil');
    assert.deepEqual(helpers.sortMonitoringExams([c,b,a],0).map(e=>e.id),['biology','math-a','math-b']);
    assert.equal(a.title,'PAS Ganjil'); assert.equal(a.id,'math-a');
    assert.equal(helpers.monitoringExamLabel(makeExam({title:'Harian',metadata:null,description:null})),'Harian');
    assert.equal(helpers.monitoringExamDetails(makeExam({description:null,subject:'Bahasa Arab'})),'Bahasa Arab');
    assert.equal(helpers.monitoringExamLabel(makeExam({metadata:{bank_title:42}})),'Matematika XI · Kelas XI A');
});

test('picker: asesmen (InlineSelect) lalu mapel dan kelas (SearchableSelect, bisa diketik) dengan status dan detail sesuai permintaan', async () => {
    const selects={};
    const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/monitoring/MonitoringExamPicker.tsx'),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const dependencies={
        'react': React,
        '@/app/components/ui/inlineselect':{InlineSelect:p=>{selects[p['aria-label']]=p;return React.createElement('select',{'aria-label':p['aria-label'],value:p.value,onChange:()=>{}},p.children)}},
        '@/app/components/ui/SearchableSelect':{SearchableSelect:p=>{selects[p.ariaLabel]=p;return React.createElement('select',{'aria-label':p.ariaLabel,value:p.value,onChange:()=>{}},p.options.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)))}},
        '@/lib/monitoring-exams':helpers,
        'lucide-react':{Info:()=>React.createElement('svg'),X:()=>React.createElement('svg')},
        '@/lib/school-time':{formatSchoolDateTime:(value,zone)=>value+' '+zone},
        '@/lib/useSchoolTimeZone':{useSchoolTimeZone:()=>({timeZone:'Asia/Makassar',error:''})},
        './monitoring-exam-picker.css':{}, 'react/jsx-runtime':require('react/jsx-runtime'),
    };
    const mod={exports:{}};
    new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,name);return dependencies[name]},mod,mod.exports);
    const folder={bank_title:'Matematika XI',pas_period_id:'p1'};
    const exams=[makeExam({metadata:folder}),makeExam({id:'math-b',metadata:folder,description:'Matematika XI • Kelas XI B | 2026/2027 | PAS 1',subject:'Matematika',questionCreatorNames:['Guru Bank'],examCreatorName:'Pembuat Folder'}),
        makeExam({id:'daily',title:'Ulangan Harian',exam_type:'daily',metadata:null,description:null,start_time:'2026-12-01T00:00:00Z'})];
    let chosen;
    const now=Date.parse('2026-10-17T00:01:00Z');
    const html=renderToStaticMarkup(React.createElement(mod.exports.default,{exams,now,value:'math-b',onChange:v=>chosen=v}));
    assert.equal(selects['Asesmen'].value,'p1');
    assert.match(html,/<option value="p1"[^>]*>● ASAS Ganjil<\/option>/);
    assert.match(html,/<option value="__other__">Ujian lainnya<\/option>/);
    assert.deepEqual(selects['Mata pelajaran dan kelas'].options,[
        {value:'math-a',label:'Matematika XI · Kelas XI A',badge:'Sedang berlangsung'},
        {value:'math-b',label:'Matematika · Kelas XI B',badge:'Sedang berlangsung'},
    ]);
    assert.equal(selects['Mata pelajaran dan kelas'].value,'math-b');
    assert.doesNotMatch(html,/Ulangan Harian/, 'ujian lain tidak dicampur ke daftar mapel folder');
    assert.match(html,/Sedang berlangsung<\/span>/);
    assert.match(html,/90 menit/);
    assert.match(html,/Lihat detail ujian/);
    assert.doesNotMatch(html,/PAS 1|2026\/2027|ASAS\/ASAT/);
    selects['Mata pelajaran dan kelas'].onChange('math-a'); assert.equal(chosen,'math-a');
    selects['Asesmen'].onChange('__other__'); assert.equal(chosen,'daily');

    renderToStaticMarkup(React.createElement(mod.exports.default,{exams,now,value:'daily',onChange:()=>{}}));
    assert.deepEqual(selects['Ujian'].options,[{value:'daily',label:'Ulangan Harian',badge:'Akan datang'}]);
    const room=renderToStaticMarkup(React.createElement(mod.exports.default,{exams,now,value:'math-b',folderLevel:true,onChange:()=>{}}));
    assert.doesNotMatch(room,/Mata pelajaran dan kelas/);
    assert.doesNotMatch(room,/Semua mapel dan ruang|Lihat detail ujian/, 'Per ruang: tanpa baris pengisi; status ada di kartu ruang');
    const slotted=renderToStaticMarkup(React.createElement(mod.exports.default,{exams,now,value:'math-b',folderLevel:true,slotRef:()=>{},onChange:()=>{}}));
    assert.match(slotted,/class="monitoring-exam-picker__slot"/);
    // Satu mapel, dua bank soal: nama bank ikut tampil agar pilihan dapat dibedakan.
    const twins=[makeExam({id:'bi-wajib',subject:'Bahasa Indonesia',metadata:{bank_title:'B. Indonesia Wajib',pas_period_id:'p1'},description:'B. Indonesia Wajib • Kelas XI D | 2026/2027 | PAS 1'}),
        makeExam({id:'bi-minat',subject:'Bahasa Indonesia',metadata:{bank_title:'B. Indonesia Peminatan',pas_period_id:'p1'},description:'B. Indonesia Peminatan • Kelas XI D | 2026/2027 | PAS 1'}),
        makeExam({id:'mtk',subject:'Matematika',metadata:{bank_title:'Matematika XI',pas_period_id:'p1'}})];
    const twinHtml=renderToStaticMarkup(React.createElement(mod.exports.default,{exams:twins,now,value:'bi-wajib',onChange:()=>{}}));
    assert.match(twinHtml,/>Bahasa Indonesia — B\. Indonesia Wajib · Kelas XI D</);
    assert.match(twinHtml,/>Bahasa Indonesia — B\. Indonesia Peminatan · Kelas XI D</);
    assert.match(twinHtml,/>Matematika · Kelas XI A</, 'mapel yang tidak kembar tetap ringkas');
    const unsafe=makeExam({description:'<img src=x onerror=alert(1)>'});
    const escaped=renderToStaticMarkup(React.createElement(mod.exports.default,{exams:[unsafe],now:0,value:unsafe.id,onChange:()=>{}}));
    assert.doesNotMatch(escaped,/<img/);

    const document=require('jsdom').jsdom('<div id="root"></div>');
    const dom={window:document.defaultView};
    const previousWindow=global.window,previousDocument=global.document,previousNavigator=global.navigator;
    global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT=true;
    const {createRoot}=require('react-dom/client');
    const root=createRoot(dom.window.document.getElementById('root'));
    try {
        await React.act(async()=>root.render(React.createElement(mod.exports.default,{exams,now:0,value:'math-b',onChange:()=>{}})));
        const trigger=dom.window.document.querySelector('[aria-label="Lihat detail ujian"]');
        assert.equal(trigger.getAttribute('aria-expanded'),'false');
        await React.act(async()=>trigger.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
        const popup=dom.window.document.querySelector('[role="dialog"]');
        assert.ok(popup);
        assert.match(popup.textContent,/Tahun ajaran2026\/2027/);
        assert.match(popup.textContent,/Jenis asesmenASAS 1/);
        assert.match(popup.textContent,/Mata pelajaranMatematika/);
        assert.match(popup.textContent,/KelasXI B/);
        assert.match(popup.textContent,/Pembuat bank soalGuru Bank/);
        assert.match(popup.textContent,/Pembuat ujianPembuat Folder/);
        assert.match(trigger.textContent,/Detail/);
        assert.doesNotMatch(popup.textContent,/PAS 1/);
        await React.act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
    } finally {
        await React.act(async()=>root.unmount());
        global.window=previousWindow;global.document=previousDocument;global.navigator=previousNavigator;
        delete global.IS_REACT_ACT_ENVIRONMENT;
        dom.window.close();
    }
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
            {id:'generated',organization_id:'school',title:'ASAS',exam_type:'pas',created_by:null,question_bank_id:'bank-a',subject_id:'00000000-0000-4000-8000-000000000002',is_published:true,metadata:{is_pas_exam:true,pas_period_id:'00000000-0000-4000-8000-000000000001'}},
            {id:'ordinary',organization_id:'school',title:'Harian',exam_type:'daily',created_by:'proctor',question_bank_id:'bank-a',is_published:true},
        ],
        cbt_exam_question_sources:[{exam_id:'ordinary',bank_id:'bank-b'}],
        cbt_question_banks:[{id:'bank-a',organization_id:'school',title:'Matematika',subject:'Matematika Bank',created_by:'teacher-a'},{id:'bank-b',organization_id:'school',title:'Peluang',subject:'Peluang',created_by:'teacher-b'}],
        cbt_subjects:[{id:'00000000-0000-4000-8000-000000000002',organization_id:'school',name:'Matematika'}],
        cbt_pas_periods:[{id:'00000000-0000-4000-8000-000000000001',organization_id:'school',created_by:'folder-owner'}],
        cbt_profiles:[{id:'teacher-a',full_name:'Guru A'},{id:'teacher-b',full_name:'Guru B'},{id:'proctor',full_name:'Proktor Ujian'},{id:'folder-owner',full_name:'Pembuat Folder'}],
    });
    const roles={hasOrgRole:async(id,org,allowed)=>id==='proctor'&&org==='school'&&allowed.includes('Proktor')};
    const auth=new AuthorizationService(db,roles,{assertSchoolId:async id=>id});
    const listed=await new ExamAdminService(db,auth,roles).list({id:'proctor'},'school');
    const generated=listed.find(e=>e.id==='generated'),ordinary=listed.find(e=>e.id==='ordinary');
    assert.equal(generated.examCreatorName,'Pembuat Folder');
    assert.deepEqual(generated.questionCreatorNames,['Guru A']);
    assert.equal(generated.subject,'Matematika');
    assert.equal(ordinary.examCreatorName,'Proktor Ujian');
    assert.deepEqual(ordinary.questionCreatorNames,['Guru A','Guru B']);
    assert.equal(ordinary.subject,'Matematika Bank');
    assert.equal(generated.created_by,null);
    assert.equal(ordinary.question_bank_title,'Matematika');
    const grouped=groupFolderExams(listed).list.find(e=>e.id.startsWith('pas:'));
    assert.equal(grouped.examCreatorName,'Pembuat Folder');
    assert.deepEqual(grouped.questionCreatorNames,['Guru A']);
    assert.equal(grouped.subject,'Matematika');
    assert.equal(db.writes.length,0);
    db.tables.cbt_pas_periods[0].organization_id='foreign';
    assert.equal((await new ExamAdminService(db,auth,roles).list({id:'proctor'},'school')).find(e=>e.id==='generated').examCreatorName,null);
});
