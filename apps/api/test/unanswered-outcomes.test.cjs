const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../../web/tsconfig.json'),transpileOnly:true,compilerOptions:{module:'CommonJS',moduleResolution:'node'}});
const {hasAnswerValue,hasStoredAnswer}=require('@acca-cbt/shared');
const {summarizeAnswerOutcomes,matchesAnswerOutcome,isAnswerUnanswered}=require('../../web/lib/answer-stats.ts');
test('empty rows and structured blank placeholders are unanswered, regardless of a persisted incorrect flag',()=>{
 for(const value of [null,undefined,'','  ','null','[]','{}','[null,"",{}]','{"a":"","b":null}','[[],[""]]']){
  const answer={is_correct:false,essay_answer:value,selected_option_id:null,bank_questions:{type:'mcq'}};
  assert.equal(isAnswerUnanswered(answer),true,String(value));
  assert.equal(matchesAnswerOutcome(answer,'wrong'),false);
  assert.equal(matchesAnswerOutcome(answer,'unanswered'),true);
  assert.deepEqual(summarizeAnswerOutcomes([answer]),{total:1,answered:0,unanswered:1,correct:0,wrong:0,essays:0,ungraded:0});
 }
});
test('zero, false, partial structured answers and selected options are real responses',()=>{
 for(const value of [0,false,'0','false','[false]','{"a":false}','{"a":0}','["","isi"]','Isi jawaban'])assert.equal(hasAnswerValue(value),true,String(value));
 assert.equal(hasStoredAnswer({essay_answer:'',selected_option_id:'option'}),true);
});
test('mixed response statistics and filters keep blank, wrong, correct and manual grading separate',()=>{
 const answers=[
  {is_correct:true,selected_option_id:'a',bank_questions:{type:'mcq'}},
  {is_correct:false,selected_option_id:'b',bank_questions:{type:'mcq'}},
  {is_correct:false,selected_option_id:null,bank_questions:{type:'mcq'}},
  {is_correct:null,essay_answer:'Esai',bank_questions:{type:'essay'}},
  {is_correct:false,essay_answer:'',bank_questions:{type:'essay'}},
  {is_correct:null,essay_answer:'Isian menunggu nilai',bank_questions:{type:'short_answer'}},
 ];
 assert.deepEqual(summarizeAnswerOutcomes(answers),{total:6,correct:1,wrong:1,essays:1,answered:4,unanswered:2,ungraded:1});
 assert.equal(answers.filter(row=>matchesAnswerOutcome(row,'all')).length,6);
 assert.equal(answers.filter(row=>matchesAnswerOutcome(row,'wrong')).length,1);
 assert.equal(answers.filter(row=>matchesAnswerOutcome(row,'correct')).length,1);
 assert.equal(answers.filter(row=>matchesAnswerOutcome(row,'unanswered')).length,2);
});

test('a completely unanswered 25-question attempt reports zero answered and zero wrong',()=>{
 const answers=Array.from({length:25},()=>({selected_option_id:null,essay_answer:null,is_correct:false,bank_questions:{type:'mcq'}}));
 const stats=summarizeAnswerOutcomes(answers);
 assert.equal(stats.total,25);assert.equal(stats.unanswered,25);assert.equal(stats.answered,0);assert.equal(stats.wrong,0);assert.equal(stats.correct,0);
});
