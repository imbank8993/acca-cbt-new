const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
require('ts-node').register({project:path.resolve(__dirname,'../../web/tsconfig.json'),transpileOnly:true,compilerOptions:{module:'CommonJS',moduleResolution:'node'}});
const {currentRegularClasses}=require('../../web/lib/exam-class-selection.ts');
const regular=(id,name,year='2026/2027')=>({id,name,type:'reguler',school_year:year});
test('all students targets only regular classes in the authoritative active year, in grade order',()=>{
 const classes=[regular('12d','XII D'),regular('11a','XI A'),regular('10a','X A'),
   regular('old','X A','2025/2026'),{...regular('extra','XI Kimia 1'),type:'tambahan'},regular('unknown','X B',null)];
 assert.deepEqual(currentRegularClasses(classes,'2026/2027').map(c=>c.id),['10a','11a','12d']);
 assert.equal(currentRegularClasses(classes,null).length,0);
 assert.equal(classes[0].id,'12d');
 assert.equal(currentRegularClasses([regular('normalized','X B','2026 - 2027')],'2026/2027').length,1);
});
test('class checkbox toggles once, preview does not select, and all students replaces custom assignments',async()=>{
 const state=[];let cursor=0,initial=true;const effects=[];let saved;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment',
  useState(initialValue){const i=cursor++;if(!(i in state))state[i]=initialValue;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value}]},
  useMemo:fn=>fn(),useEffect:fn=>{if(initial)effects.push(fn)}};
 const classes=[regular('a','X A'),regular('b','XI B'),regular('old','XII D','2025/2026'),{...regular('extra','XI Kimia 1'),type:'tambahan'}];
 const props={isOpen:true,onClose(){},classes,classStudents:Object.fromEntries(classes.map(c=>[c.id,[]])),
  initialSelectedClassIds:['extra'],initialClassAssignments:{a:{mode:'selected',studentIds:['one']},extra:{mode:'all',studentIds:[]}},
  onSaveAssignments:(ids,assignments)=>{saved={ids,assignments}}};
 const source=fs.readFileSync(path.resolve(__dirname,'../../web/components/exams/AssignExamModal.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports','window',code)(name=>{
  if(name==='react')return React;
  if(name==='@/lib/exam-class-selection')return{currentRegularClasses};
  if(name==='@/lib/api/proctor')return{getActiveSchoolYear:async()=>({year:'2026/2027'}),listClassStudents:async()=>{throw Error('Empty loaded classes must not refetch')}};
  if(name==='@/lib/monitoring-health')return{formatStudentName:name=>name};
  return new Proxy({}, {get:(_,key)=>String(key)});
 },mod,mod.exports,{setTimeout:fn=>{fn();return 1},clearTimeout(){}});
 const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.children)];
 const text=root=>root==null||typeof root==='boolean'?'':typeof root!=='object'?String(root):Array.isArray(root)?root.map(text).join(''):text(root.children);
 const render=()=>{cursor=0;const tree=mod.exports.AssignExamModal(props);initial=false;return tree};
 let tree=render();effects.forEach(fn=>fn());await new Promise(r=>setImmediate(r));tree=render();
 const find=(tree,predicate)=>{const node=nodes(tree).find(predicate);assert.ok(node);return node};
 const check=()=>find(tree,n=>n.type==='input'&&n.props['aria-label']==='Pilih kelas X A');
 const event={stopped:false,stopPropagation(){this.stopped=true}};
 check().props.onClick(event);assert.equal(event.stopped,true);check().props.onChange(event);
 tree=render();assert.equal(check().props.checked,true);
 check().props.onClick(event);check().props.onChange(event);tree=render();assert.equal(check().props.checked,false);
 find(tree,n=>n.type==='div'&&n.props.key==='b').props.onClick();tree=render();
 assert.equal(find(tree,n=>n.type==='input'&&n.props['aria-label']==='Pilih kelas XI B').props.checked,false);
 find(tree,n=>n.type==='button'&&text(n)==='Semua siswa').props.onClick();tree=render();
 find(tree,n=>n.type==='Button'&&text(n)==='Terapkan Peserta').props.onClick();
 assert.deepEqual(saved.ids,['a','b']);assert.deepEqual(saved.assignments.a,{mode:'all',studentIds:[]});assert.deepEqual(saved.assignments.b,{mode:'all',studentIds:[]});
});
