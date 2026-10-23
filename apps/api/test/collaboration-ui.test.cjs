const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/CollaborationButton.tsx'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.children)];
const text=root=>root==null||typeof root==='boolean'?'':typeof root!=='object'?String(root):Array.isArray(root)?root.map(text).join(''):text(root.children);
function mount(canShare=true,canGrantPrivileged=true) {
 const state=[],deps=[],memo=[],effects=[],requests=[];let cursor=0;
 const React={
  createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},
  useCallback(fn,dependencies){const i=cursor++;if(!deps[i]||dependencies.some((v,j)=>v!==deps[i][j])){deps[i]=dependencies;memo[i]=fn;}return memo[i];},
  useEffect(fn,dependencies){const i=cursor++;if(!deps[i]||dependencies.some((v,j)=>v!==deps[i][j])){deps[i]=dependencies;effects.push(fn);}},
 };
 const mod={exports:{}};
 const data={success:true,canShare,canGrantPrivileged,ownerId:'a',ownerName:'A',collaborators:[{user_id:'b',name:'B',permission:'editor'}]};
 const client={apiGet:async url=>url.endsWith('/candidates')?{success:true,candidates:[{id:'b',name:'B',nip:'123'}]}:data,
  apiSend:async(url,body,method)=>{requests.push({url,body,method});return{success:true};}};
 new Function('require','module','exports','React','window',code)(name=>name==='react'?React:name.includes('/api/client')?client:new Proxy({},{get:(_,key)=>String(key)}),mod,mod.exports,React,{setTimeout:fn=>{fn();return 1;},clearTimeout(){}});
 const render=()=>{cursor=0;const tree=mod.exports.CollaborationButton({type:'exam',resourceId:'exam'});while(effects.length)effects.shift()();return tree;};
 return{render,requests};
}
test('collaboration dialog saves selected staff and revokes the exact participant through the API',async()=>{
 const f=mount();let tree=f.render();nodes(tree).find(n=>n.type==='button'&&text(n).includes('Kolaborator')).props.onClick();
 f.render();await new Promise(resolve=>setImmediate(resolve));tree=f.render();
 nodes(tree).find(n=>n.type==='SearchableSelect').props.onChange('b');tree=f.render();
 nodes(tree).find(n=>n.type==='Button'&&text(n)==='Simpan akses').props.onClick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.requests[0],{url:'/api/collaboration/exam/exam/b',method:'PUT',body:{permission:'editor',can_reset:false,expires_at:null}});
 tree=f.render();nodes(tree).find(n=>n.type==='button'&&text(n)==='Cabut akses').props.onClick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.requests[1].method,'DELETE');assert.equal(f.requests[1].url,'/api/collaboration/exam/exam/b');
});
test('readers have no access editing controls and delegated managers cannot grant privileged access',async()=>{
 for(const mode of [[false,false],[true,false]]){
  const f=mount(...mode);let tree=f.render();nodes(tree).find(n=>n.type==='button'&&text(n).includes('Kolaborator')).props.onClick();f.render();
  await new Promise(resolve=>setImmediate(resolve));tree=f.render();
  if(!mode[0]) assert.equal(nodes(tree).some(n=>n.type==='Button'&&text(n)==='Simpan akses'),false);
  else {
   assert.equal(nodes(tree).find(n=>n.type==='InlineSelect').props.options.some(option=>option.value==='manager'),false);
   assert.equal(text(tree).includes('Izinkan reset'),false);
  }
 }
});
