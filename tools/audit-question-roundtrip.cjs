/* Regression suite: no network, database, or application data is modified. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const { createRequire } = require('node:module');
const { load } = require('./question-test-loader.cjs');
const quiet = console.log;
let checks = 0;
function check(name, fn) { fn(); checks++; quiet('PASS', name); }
async function asyncCheck(name,fn) { await fn(); checks++; quiet('PASS',name); }
const doc = load('apps/web/lib/doc-parser.ts');
const excel = load('apps/web/lib/excel-parser.ts');
const exp = load('apps/web/lib/export-template.ts');
const archive = load('apps/web/lib/question-archive.ts');
const transfer = load('apps/web/lib/question-transfer.ts');
function readRows(html) {
    return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map(t=>
        [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(r=>({cells:[...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c=>c[1])})));
}
function parseRows(rows) { const old=console.log;console.log=()=>{};try{return doc.parseQuestionTable(rows);}finally{console.log=old;} }
async function parseSheet(headers,rows) {
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,...rows]),'Test');
    const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
    return excel.parseExcelToQuestions({arrayBuffer:async()=>bytes});
}
(async()=>{
    const template=excel.generateTemplateData();
    const parsed=await parseSheet(template.headers,template.sampleRows);
    check('Excel template retains real option columns and Jakarta key',()=>{
        assert.deepEqual(parsed.questions[0].options.map(o=>o.text),['Jakarta','Bandung','Surabaya','Yogyakarta','Semarang']);
        assert.equal(parsed.questions[0].options.find(o=>o.isCorrect).text,'Jakarta');
        assert.equal(parsed.errors.length,0);
    });
    const gap=await parseSheet(['Soal','Tipe','Kunci','A','B','C','D','E','F'],[['Gap','PG','C','alpha','','gamma','delta','epsilon','zeta']]);
    check('Excel skips empty B without shifting key C; sixth option survives',()=>{
        assert.equal(gap.questions[0].options.find(o=>o.isCorrect).text,'gamma');assert.equal(gap.questions[0].options.length,5);
    });
    const bad=await parseSheet(['Soal','Tipe','Kunci','A','B'],[['Bad','PG','','one','two']]);
    check('Missing key is rejected instead of guessing A',()=>assert.equal(bad.errors.length,1));
    const csv=fs.readFileSync('apps/web/public/template_soal.csv');
    const legacy=await excel.parseExcelToQuestions({arrayBuffer:async()=>csv});
    check('Legacy zero-based CSV keys retain option identity',()=>{
        assert.equal(legacy.questions[0].options.find(o=>o.isCorrect).text,'Jakarta');
        assert.equal(legacy.questions[1].options.find(o=>o.isCorrect).text,'Thomas Alva Edison');
    });
    const headers={cells:['NO','TIPE','SOAL','KUNCI','SKOR']};
    const tf=parseRows([headers,{cells:['1','BS','Question','B|B','1']},{cells:['','P1','one','B','']},{cells:['','P2','two','B','']}]);
    check('Each B/S subrow uses its own key',()=>assert.deepEqual(tf[0].options.map(o=>o.isCorrect),[true,true]));
    const types=['mcq','mcq_complex','true_false','matching','categorization','short_answer','essay','ordering','sjt','likert','forced_choice','checklist','ranking','paired_comparison'];
    const fixtures=types.map(type=>({
        question_text:`Question ${type}`,type,difficulty:'hard',score_default:3,
        metadata:{correct_order:['id-2','id-1'],blanks:[{answer:'one',variations:['uno','1']}],right_items:['right','other'],categories:['cat','other'],custom:'retained'},
        bank_question_options:['short_answer','essay','likert'].includes(type)?[]:[0,1].map(i=>({id:`id-${i+1}`,option_text:`Option ${i}`,order:i,is_correct:type==='mcq'?i===0:true,weight:i+2,metadata:{match_texts:['right','other'],category_names:['cat','other'],dimension_id:'dim-1'}})),
    }));
    for(const q of fixtures){
        const personal=exp.PERSONALITY_TYPES.includes(q.type);
        const blob=personal?await exp.buildKepribadianDoc([q],{title:'Audit'},[{id:'dim-1',name:'Focus'}]):await exp.buildAkademikDoc([q],{title:'Audit'});
        const restored=await doc.parseDocxToQuestions(blob);
        check(`DOCX roundtrip ${q.type}: options, keys, weights and metadata`,()=>{
            assert.deepEqual(restored,[transfer.portableQuestion(q,{dimensions:personal?[{id:'dim-1',name:'Focus'}]:[]})]);
        });
        const html=await mammoth.convertToHtml({buffer:Buffer.from(await blob.arrayBuffer())});
        const tables=readRows(html.value);
        const reparsed=parseRows(tables[0]);
        check(`Visible Word rows ${q.type} remain importable after editing`,()=>{
            assert.equal(reparsed[0].type,q.type);
            assert.equal(reparsed[0].options.length,q.bank_question_options.length);
            if(['mcq','mcq_complex','true_false'].includes(q.type)) assert.deepEqual(reparsed[0].options.map(o=>o.isCorrect),q.bank_question_options.map(o=>o.is_correct));
            if(q.type==='matching') assert.deepEqual(reparsed[0].options[0].metadata.match_texts,['right','other']);
            if(q.type==='categorization') assert.deepEqual(reparsed[0].options[0].metadata.category_names,['cat','other']);
            if(q.type==='ordering') assert.deepEqual(reparsed[0].metadata.correct_order,['2','1']);
        });
        if(q.type==='mcq'){
            const zip=await JSZip.loadAsync(await blob.arrayBuffer());
            zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('Question mcq','Edited question'));
            check('Archive does not override edits in Word',()=>{});
            assert.equal(await archive.readQuestionArchive(await zip.generateAsync({type:'arraybuffer'})),null);
        }
    }
    const many={...fixtures[0],bank_question_options:Array.from({length:12},(_,i)=>({id:`o${i}`,option_text:`Item ${i}`,order:i,is_correct:i===11,weight:1}))};
    const blob=await exp.buildAkademikDoc([many],{title:'Many'});
    const html=await mammoth.convertToHtml({buffer:Buffer.from(await blob.arrayBuffer())});
    check('Word export retains 12 MCQ options and key L',()=>{
        const q=parseRows(readRows(html.value)[0])[0];assert.equal(q.options.length,12);assert.equal(q.options.find(o=>o.isCorrect).text.replace(/<[^>]*>/g,''),'Item 11');
    });
    for(const name of ['pengetahuan','kepribadian']){
        const html=await mammoth.convertToHtml({buffer:fs.readFileSync(`apps/web/public/template_soal_${name}.docx`)});
        const tables=readRows(html.value);const old=console.log;console.log=()=>{};
        let parsed;try{parsed=doc.parseAllTables(tables,tables.map(t=>t[0].cells));}finally{console.log=old;}
        check(`Bundled ${name} template contains importable questions`,()=>assert.ok(parsed.questions.length>0));
        check(`Bundled ${name} template passes import validation`,()=>assert.deepEqual(excel.validateQuestions(parsed.questions).invalid.map(i=>i.errors),[]));
        if(name==='pengetahuan') check('Bundled academic keys match all template entries, including distractor',()=>{
            const q=parsed.questions;
            assert.deepEqual(q[0].options.map(o=>o.isCorrect),[true,false,false,false]);
            assert.deepEqual(q[1].options.map(o=>o.isCorrect),[true,false,true,false]);
            assert.deepEqual(q[2].options.map(o=>o.isCorrect),[true,false]);
            assert.deepEqual(q[3].options.map(o=>o.metadata.match_texts),[['Ikan'],['Wortel'],['Beras'],[]]);
            assert.deepEqual(q[4].options.map(o=>o.metadata.category_names),[['Mamalia','Vertebrata'],['Burung','Vertebrata'],['Ikan','Vertebrata']]);
            assert.deepEqual(q[5].metadata.blanks.map(b=>b.answer),['Jakarta','Tokyo']);
            assert.deepEqual(q[7].metadata.correct_order,['2','1','4','3']);
        });
        else check('Bundled personality weights and dimensions match template',()=>{
            assert.deepEqual(parsed.questions[0].options.map(o=>o.weight),[0,3,2,1]);
            assert.deepEqual(parsed.questions[0].options.map(o=>o.metadata.dimension),['Integritas','Integritas','Disiplin','Kerja Sama']);
        });
        quiet('Template coverage:',name,parsed.questions.map(q=>`${q.type}:${q.options.length}`).join(', '));
    }
    quiet(`Completed ${checks} import/export regression checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
