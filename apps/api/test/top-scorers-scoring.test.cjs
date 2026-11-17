const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {ProctorService}=require('../src/proctor/proctor.service.ts');
test('IRT scores retain their label; a pending IRT exam has no classical fallback row',async()=>{
 const rows=[{exam_id:'irt',exam_title:'IRT ready',exam_type:'daily',score_label:'IRT 1PL',scored_count:20,participant_count:20,
   rank:1,user_id:'s',full_name:'Student',total_score:'0.81333',last_finished_at:null,finished_at:null},
  {exam_id:'pending',exam_title:'IRT pending',exam_type:'daily',score_label:'IRT 1PL',scored_count:0,participant_count:40,
   rank:null,user_id:null,full_name:null,total_score:null,last_finished_at:null,finished_at:null}];
 let authorized=false;
 const service=new ProctorService({}, {isRestrictedProctor:async()=>false,assertOrgStaff:async()=>{authorized=true}}, {},{$queryRawUnsafe:async(_sql,org,limit,perExam)=>{
  assert.equal(authorized,true);assert.deepEqual([org,limit,perExam],['school',12,3]);return rows;
 }});
 const result=await service.getTopScorers({id:'staff'},'school',{examLimit:12,perExam:3});
 assert.equal(result[0].scoreLabel,'IRT 1PL');assert.equal(result[0].topScorers[0].score,581.33,'IRT ranking score is reported as 500 + 100θ');
 assert.equal(result[1].scoreLabel,'IRT 1PL');assert.equal(result[1].scoredCount,0);
 assert.deepEqual(result[1].topScorers,[]);assert.equal(result[1].participantCount,40);
});
test('top score query is never executed when organizational monitoring is denied',async()=>{
 let queried=false;
 const service=new ProctorService({}, {assertOrgStaff:async()=>{throw Error('Denied')}}, {},{$queryRawUnsafe:async()=>{queried=true;return[]}});
 await assert.rejects(service.getTopScorers({id:'student'},'school',{examLimit:12,perExam:3}),/Denied/);
 assert.equal(queried,false);
});
test('equal scores prioritize elapsed working time before submission time, with invalid durations last',async()=>{
 let query;
 const service=new ProctorService({}, {isRestrictedProctor:async()=>false,assertOrgStaff:async()=>{}}, {},{$queryRawUnsafe:async(sql)=>{query=sql;return[]}});
 await service.getTopScorers({id:'staff'},'school',{examLimit:12,perExam:3});
 assert.match(query,/CASE WHEN a\.started_at IS NOT NULL AND a\.finished_at >= a\.started_at\s+THEN a\.finished_at - a\.started_at END AS working_duration/);
 assert.match(query,/ORDER BY c\.ranking_score DESC, c\.working_duration ASC NULLS LAST,\s+c\.finished_at ASC NULLS LAST, c\.user_id/);
});

test('semester assessment top scorers include the subject from the subject catalog or question bank',async()=>{
 const rows=['pas','am'].map((exam_type,index)=>({exam_id:`exam-${index}`,exam_title:'ASAS Ganjil 2026/2027',exam_type,
  subject_name:index===0?'Matematika':'Bahasa Indonesia',score_label:'Klasikal',scored_count:1,participant_count:1,
  rank:1,user_id:`student-${index}`,full_name:'Student',total_score:90,last_finished_at:null,finished_at:null}));
 let query;
 const service=new ProctorService({}, {isRestrictedProctor:async()=>false,assertOrgStaff:async()=>{}}, {},{$queryRawUnsafe:async sql=>{query=sql;return rows;}});
 const result=await service.getTopScorers({id:'staff'},'school',{examLimit:12,perExam:3});
 assert.deepEqual(result.map(exam=>exam.subjectName),['Matematika','Bahasa Indonesia']);
 assert.match(query,/LEFT JOIN public\.cbt_subjects s ON s\.id = x\.subject_id/);
 assert.match(query,/LEFT JOIN public\.cbt_question_banks b ON b\.id = x\.question_bank_id/);
 assert.match(query,/COALESCE\(NULLIF\(BTRIM\(s\.name\), ''\), NULLIF\(BTRIM\(b\.subject\), ''\)\) AS subject_name/);
});
