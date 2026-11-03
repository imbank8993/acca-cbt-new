const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const {classicalDifficulty,classicalDifficultyIndex,ITEM_DIFFICULTY_CATEGORIES}=require('@acca-cbt/shared');

test('five difficulty bands have exact nonuniform boundaries and preserve extreme P values',()=>{
 const cases=[[0,'Sangat Sulit'],[.1,'Sangat Sulit'],[.100001,'Sulit'],[.3,'Sulit'],[.300001,'Sedang'],
  [.7,'Sedang'],[.700001,'Mudah'],[.9,'Mudah'],[.900001,'Sangat Mudah'],[1,'Sangat Mudah']];
 for(const [p,label]of cases)assert.equal(classicalDifficulty(p),label,`P=${p}`);
 for(const p of [null,undefined,NaN,Infinity,-.01,1.01,'0.5'])assert.equal(classicalDifficulty(p),null);
 assert.equal(classicalDifficultyIndex(0,0),null);
 assert.equal(classicalDifficultyIndex(0,10),0);
 assert.equal(classicalDifficultyIndex(10,0),1);
 assert.equal(classicalDifficultyIndex(3,7),.3);
 assert.equal(classicalDifficultyIndex(-1,10),null);
 assert.deepEqual(Array.from({length:20},()=>classicalDifficulty(.5)),Array(20).fill('Sedang'),'Categories must not force equal counts');
});

function loadWeb(file, overrides={}){
 const source=fs.readFileSync(path.resolve(__dirname,'../../web',file),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports','React',code)(name=>{
  if(name in overrides)return overrides[name];
  if(name==='@acca-cbt/shared')return require(name);
  if(name==='@/lib/item-analysis-order')return loadWeb('lib/item-analysis-order.ts');
  if(name.endsWith('.css'))return {};
  if(name.endsWith('monitoring-health'))return {formatStudentName:name=>name||'Tanpa Nama'};
  if(name.endsWith('question-snippet'))return {getQuestionSnippet:text=>text};
  if(name.endsWith('irt-status'))return {hasIrtScore:()=>false};
  return new Proxy({}, {get:(_,key)=>key});
 },mod,mod.exports,overrides.react);
 return mod.exports;
}

test('legacy rounded analysis is categorized using full-precision counts; ungraded items stay unclassified',()=>{
 const {buildItemAnalysis}=loadWeb('lib/item-analysis.ts');
 const items=buildItemAnalysis({questions:[],answers:[],detailed:{items:[{
  id:'q',number:1,question_text:'q',type:'mcq',total_answered:100000,total_correct:10001,total_incorrect:89999,
  difficulty_index:.1,difficulty_label:'sukar',incorrect_percentage:90,
 },{id:'pending',number:2,total_answered:2,total_correct:0,total_incorrect:0,total_ungraded:2,difficulty_index:0}]}},[]);
 assert.equal(items.find(item=>item.id==='q').difficultyLabel,'Sulit');
 assert.equal(items.find(item=>item.id==='q').difficultyIndex,.10001);
 assert.equal(items.find(item=>item.id==='pending').difficultyLabel,undefined);
});

function hooks(){
 const state=[];let cursor=0;
 return {reset:()=>{cursor=0;},React:{createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
  useRef:value=>({current:value}),useEffect:()=>{},}};
}
const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.children)];
const text=root=>root==null||typeof root==='boolean'?'':typeof root!=='object'?String(root):Array.isArray(root)?root.map(text).join(''):text(root.children);

test('analysis filter always offers all five categories in the requested order',()=>{
 const h=hooks();const {ItemAnalysisPanel}=loadWeb('app/components/monitoring/ItemAnalysisPanel.tsx',{react:h.React});
 const tree=ItemAnalysisPanel({analysis:[]});
 const select=nodes(tree).find(node=>node.type==='FilterSelect');
 assert.deepEqual(select.props.options.map(option=>option.label),['Semua',...ITEM_DIFFICULTY_CATEGORIES]);
});

test('bulk reset immediately lists only eligible students and preserves select-all without a collapse control',()=>{
 const h=hooks();const {BulkResetPanel}=loadWeb('app/components/monitoring/BulkResetPanel.tsx',{react:h.React});
 const attempts=[{id:'one',status:'submitted',canReset:true,profiles:{full_name:'Ani'}},
  {id:'two',status:'auto_submitted',canReset:true,profiles:{full_name:'Budi'}},
  {id:'restricted',status:'submitted',canReset:false,profiles:{full_name:'Rahasia'}},
  {id:'active',status:'in_progress',canReset:true,profiles:{full_name:'Aktif'}}];
 const render=()=>{h.reset();return BulkResetPanel({attempts,onRefresh:()=>{}});};
 let tree=render();
 assert.match(text(tree),/Ani/);assert.match(text(tree),/Budi/);assert.doesNotMatch(text(tree),/Rahasia|Aktif/);
 assert.ok(!nodes(tree).some(node=>node.props['aria-expanded']!==undefined));
 assert.equal(nodes(tree).filter(node=>node.type==='input').length,3);
 nodes(tree).find(node=>node.type==='input').props.onChange();
 tree=render();
 assert.ok(nodes(tree).filter(node=>node.type==='input').every(node=>node.props.checked));
 assert.equal(nodes(tree).find(node=>node.type==='Button').props.disabled,false);
 assert.match(text(tree),/2 tersedia · 2 terpilih/);
});


test('difficulty ranking prioritizes three wrong responses over one, then uses question number',()=>{
 const {compareItemAnalysisDifficulty:compare}=loadWeb('lib/item-analysis-order.ts');
 const items=[{number:1,correct:0,incorrect:1},{number:3,correct:0,incorrect:3},
  {number:2,correct:0,incorrect:3},{number:4,correct:2,incorrect:8},
  {number:5,correct:1,incorrect:1},{number:6,correct:0,incorrect:0}];
 assert.deepEqual([...items].sort(compare).map(x=>x.number),[2,3,1,4,5,6]);
 assert.deepEqual(items.map(x=>x.number),[1,3,2,4,5,6],'sorting a copy preserves the source');
});

test('detailed and fallback analyses use counts rather than rounded percentages',()=>{
 const {buildItemAnalysis}=loadWeb('lib/item-analysis.ts');
 const questions=[{id:'one',number:1},{id:'three',number:2}];
 const answers=[{question_id:'one',attempt_id:'a',is_correct:false},
  ...['a','b','c'].map(attempt_id=>({question_id:'three',attempt_id,is_correct:false}))];
 assert.deepEqual(buildItemAnalysis({questions,answers},[]).map(x=>x.id),['three','one']);
 const items=questions.map(q=>({...q,total_correct:0,total_incorrect:q.id==='one'?1:3,incorrect_percentage:100}));
 assert.deepEqual(buildItemAnalysis({questions,answers:[],detailed:{items}},[]).map(x=>x.id),['three','one']);
});
