const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {ProctorService}=require('../src/proctor/proctor.service.ts');
test('IRT scores retain their label; a pending IRT exam has no classical fallback row',async()=>{
 const rows=[{exam_id:'irt',exam_title:'IRT ready',exam_type:'daily',score_label:'IRT 1PL',scored_count:20,participant_count:20,
   rank:1,user_id:'s',full_name:'Student',total_score:'81.333',last_finished_at:null,finished_at:null},
  {exam_id:'pending',exam_title:'IRT pending',exam_type:'daily',score_label:'IRT 1PL',scored_count:0,participant_count:40,
   rank:null,user_id:null,full_name:null,total_score:null,last_finished_at:null,finished_at:null}];
 let authorized=false;
 const service=new ProctorService({}, {assertOrgMonitoring:async()=>{authorized=true}}, {},{$queryRawUnsafe:async(_sql,org,limit,perExam)=>{
  assert.equal(authorized,true);assert.deepEqual([org,limit,perExam],['school',12,3]);return rows;
 }});
 const result=await service.getTopScorers({id:'staff'},'school',{examLimit:12,perExam:3});
 assert.equal(result[0].scoreLabel,'IRT 1PL');assert.equal(result[0].topScorers[0].score,81.33);
 assert.equal(result[1].scoreLabel,'IRT 1PL');assert.equal(result[1].scoredCount,0);
 assert.deepEqual(result[1].topScorers,[]);assert.equal(result[1].participantCount,40);
});
test('top score query is never executed when organizational monitoring is denied',async()=>{
 let queried=false;
 const service=new ProctorService({}, {assertOrgMonitoring:async()=>{throw Error('Denied')}}, {},{$queryRawUnsafe:async()=>{queried=true;return[]}});
 await assert.rejects(service.getTopScorers({id:'student'},'school',{examLimit:12,perExam:3}),/Denied/);
 assert.equal(queried,false);
});
