const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
require('ts-node').register({project:path.resolve(__dirname,'../../web/tsconfig.json'),transpileOnly:true,compilerOptions:{module:'CommonJS',moduleResolution:'node'}});
const outcomes=require('../../web/lib/answer-stats.ts');
function load(file,name){
 const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components',file),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children})};const mod={exports:{}};
 new Function('require','module','exports','React',code)(id=>id==='@/lib/answer-stats'?outcomes:new Proxy({},{get:(_,key)=>String(key)}),mod,mod.exports,React);
 return mod.exports[name];
}
const text=root=>root==null||typeof root==='boolean'?'':typeof root!=='object'?String(root):Array.isArray(root)?root.map(text).join(''):text(root.children);
test('unanswered outcomes use a neutral indicator and an independent count filter',()=>{
 const answer={is_correct:false,selected_option_id:null,essay_answer:null,bank_questions:{type:'mcq'}};
 const Indicator=load('AnswerOutcomeIndicator.tsx','AnswerOutcomeIndicator');const indicator=Indicator({answer});
 assert.equal(indicator.props['aria-label'],'Tidak dijawab');assert.match(indicator.props.className,/bg-slate-200/);assert.doesNotMatch(indicator.props.className,/bg-red/);
 const Filters=load('AnswerOutcomeFilters.tsx','AnswerOutcomeFilters');let selected;
 const tree=Filters({value:'all',onChange:value=>selected=value,stats:outcomes.summarizeAnswerOutcomes([answer])});
 const buttons=tree.children.flat();const empty=buttons.find(button=>text(button).startsWith('Tidak dijawab'));
 assert.equal(text(empty),'Tidak dijawab1');empty.props.onClick();assert.equal(selected,'unanswered');
 assert.equal(text(buttons.find(button=>text(button).startsWith('Salah'))),'Salah0');
});
