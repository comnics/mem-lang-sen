import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect } from 'vitest';
import { personalRowSchema } from '@/domain/personal-sentences';
config({path:'.env.local',quiet:true});
type Db=typeof import('@/server/db')['db'];
let db:Db;
let personal:typeof import('@/server/services/personal-content');
let imports:typeof import('@/server/services/personal-imports');
let learning:typeof import('@/server/services/learning');
let content:typeof import('@/server/services/content');
let records:typeof import('@/server/services/records');
let scheduling:typeof import('@/server/services/scheduling');
let a:string,b:string,admin:string;
const extras:string[]=[];
const publicSets:string[]=[];
const value=(n=1)=>({prompt:`한국어 질문 ${n}`,target:`Answer ${n}`,level:'A1' as const});
async function fixture(){const set=await personal.createPersonalSet(a,{title:'개인 세트'});await personal.addPersonalSentences(a,set.id,{expectedRevision:1,sentences:[value()]});const detail=await personal.getPersonalSet(a,set.id);return {set:detail,version:detail.sentences[0].sentenceVersion};}
async function preview(setId:string,rows=[personalRowSchema.parse({row:1,...value(2)})]){return imports.createPersonalPreview(a,setId,'txt:TSV',rows);}
function commitArgs(p:Awaited<ReturnType<typeof preview>>,commitKey=randomUUID()){return {commitKey,expectedSetRevision:p.setRevision,expectedRevision:p.revision,payloadHash:p.payloadHash};}
// Real PostgreSQL tests. Only the isolated final campaign may execute these.
describe('personal content / imports / existing learning integration',()=>{
 beforeAll(async()=>{const url=process.env.DATABASE_URL;if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('A disposable LOCAL database is required.');({db}=await import('@/server/db'));personal=await import('@/server/services/personal-content');imports=await import('@/server/services/personal-imports');learning=await import('@/server/services/learning');content=await import('@/server/services/content');records=await import('@/server/services/records');scheduling=await import('@/server/services/scheduling');});
 beforeEach(async()=>{a=randomUUID();b=randomUUID();admin=randomUUID();await db.appUser.createMany({data:[a,b,admin].map(id=>({id,email:`${id}@personal.integration.test`,role:id===admin?'ADMIN':'USER'}))});});
 afterEach(async()=>{
  const owners=[a,b,admin];const sets=await db.studySet.findMany({where:{OR:[{ownerId:{in:owners}},{id:{in:publicSets.splice(0)}}]},select:{id:true}});const sentences=await db.sentence.findMany({where:{ownerId:{in:owners}},select:{id:true}});const sentenceIds=[...sentences.map(s=>s.id),...extras.splice(0)];
  // Teardown only: assertions above inspect preserved history before deleting test fixtures.
  await db.personalSentenceImport.deleteMany({where:{ownerId:{in:owners}}});
  await db.studySession.deleteMany({where:{userId:{in:owners}}});
  await db.assessmentCohort.deleteMany({where:{userId:{in:owners}}});
  await db.userSentenceState.deleteMany({where:{userId:{in:owners}}});
  await db.userSentencePreference.deleteMany({where:{userId:{in:owners}}});
  await db.setSentence.deleteMany({where:{setId:{in:sets.map(s=>s.id)}}});
  await db.studySet.deleteMany({where:{id:{in:sets.map(s=>s.id)}}});
  await db.sentenceVersion.deleteMany({where:{sentenceId:{in:sentenceIds}}});
  await db.sentence.deleteMany({where:{id:{in:sentenceIds}}});
  await db.appUser.deleteMany({where:{id:{in:owners}}});
 });
 afterAll(async()=>{if(db)await db.$disconnect();});
 it.each([
  {scope:'PERSONAL',mode:'WRITTEN'}, {scope:'PERSONAL',mode:'SPOKEN'},
  {scope:'PUBLIC',mode:'WRITTEN'}, {scope:'PUBLIC',mode:'SPOKEN'},
 ] as const)('keeps hidden $scope sentences available throughout $mode practice but out of today',async({scope,mode})=>{
  let setId:string;
  if(scope==='PERSONAL'){
   const set=await personal.createPersonalSet(a,{title:'숨김 회귀'});
   await personal.addPersonalSentences(a,set.id,{expectedRevision:1,sentences:[value(1),value(2)]});setId=set.id;
  }else{
   const set=await db.studySet.create({data:{title:'Public hidden regression',description:'',category:'SITUATION',level:'A1',status:'PUBLISHED'}});setId=set.id;publicSets.push(setId);
   for(let n=1;n<=2;n++){
    const sentence=await db.sentence.create({data:{}});extras.push(sentence.id);
    const version=await db.sentenceVersion.create({data:{sentenceId:sentence.id,versionNumber:1,...value(n),meaning:'',hint:'',explanation:'',acceptedAnswers:[value(n).target],status:'PUBLISHED'}});
    await db.setSentence.create({data:{setId,sentenceVersionId:version.id,order:n}});
   }
  }
  await learning.enrollSet(a,setId);
  await scheduling.updateStudyPlan(a,{displayName:'숨김 검증',dailyMinutes:5,timezone:'UTC',weekdays:[0,1,2,3,4,5,6],localTime:'00:00'});
  const members=await db.setSentence.findMany({where:{setId},orderBy:{order:'asc'},include:{sentenceVersion:true}});
  const hiddenId=members[0].sentenceVersion.sentenceId;
  await db.userSentencePreference.upsert({where:{userId_sentenceId:{userId:a,sentenceId:hiddenId}},create:{userId:a,sentenceId:hiddenId,hidden:true},update:{hidden:true}});
  const queue=await scheduling.getTodayQueue(a);
  expect(queue.items.some(item=>item.sentenceId===hiddenId)).toBe(false);
  expect(queue.items.some(item=>item.sentenceId===members[1].sentenceVersion.sentenceId)).toBe(true);
  const session=await learning.createStudySession(a,{setId,mode});
  const dto=await learning.getSession(a,session.id);
  expect(dto.status).toBe('ACTIVE');expect(dto.items).toHaveLength(2);
  for(const [index,item] of dto.items.entries()){
   if(mode==='SPOKEN')expect(await learning.revealSessionItem(a,session.id,{itemId:item.id,kind:'ANSWER'})).toMatchObject({text:value(index+1).target});
   const answer=await learning.answerSessionItem(a,session.id,{itemId:item.id,eventId:randomUUID(),...(mode==='WRITTEN'?{answer:value(index+1).target}:{selfRating:'GOOD' as const})});
   expect(answer.result).toBe(mode==='WRITTEN'?'CORRECT':'SELF_REPORTED');expect(answer.completed).toBe(index===1);
  }
  expect((await learning.getSession(a,session.id)).status).toBe('COMPLETED');
 });
 it('defaults existing/public content to PUBLIC/null and enforces owner CHECK constraints',async()=>{const sentence=await db.sentence.create({data:{}});extras.push(sentence.id);expect(sentence).toMatchObject({scope:'PUBLIC',ownerId:null});await expect(db.sentence.create({data:{scope:'PERSONAL'}})).rejects.toThrow();await expect(db.studySet.create({data:{title:'invalid',description:'',category:'SITUATION',level:'A1',scope:'PERSONAL',status:'PUBLISHED',ownerId:a}})).rejects.toThrow();});
 it('keeps A content invisible to B, ADMIN, public catalogs and administrative authoring paths',async()=>{const {set,version}=await fixture();expect(await personal.listPersonalSets(b)).toEqual([]);expect(await personal.listPersonalSets(admin)).toEqual([]);for(const owner of [b,admin]){await expect(personal.getPersonalSet(owner,set.id)).rejects.toMatchObject({status:404});await expect(personal.exposePersonalSet(owner,set.id)).rejects.toMatchObject({status:404});await expect(personal.updatePersonalSet(owner,set.id,{expectedRevision:set.revision,title:'hijack'})).rejects.toMatchObject({status:404});await expect(personal.editPersonalSentence(owner,version.sentenceId,{expectedVersionId:version.id,expectedRevision:set.revision,action:'ARCHIVE'})).rejects.toMatchObject({status:404});await expect(learning.enrollSet(owner,set.id)).rejects.toMatchObject({status:404});}
  expect(await content.adminListSets()).not.toEqual(expect.arrayContaining([expect.objectContaining({id:set.id})]));expect(await content.adminListSentences()).not.toEqual(expect.arrayContaining([expect.objectContaining({id:version.id})]));expect(await content.listSets(b)).not.toEqual(expect.arrayContaining([expect.objectContaining({id:set.id})]));await expect(content.getSet(set.id,a)).rejects.toMatchObject({status:404});await expect(content.adminCloneSet(set.id)).rejects.toMatchObject({status:404});await expect(content.adminReviewSet(set.id)).rejects.toMatchObject({status:404});await expect(content.adminPublishSet(set.id)).rejects.toMatchObject({status:404});
  const application=await import('@/server/services/application-questions');await expect(application.adminCreateApplicationQuestion({sentenceVersionId:version.id,prompt:'private',meaning:'meaning',target:'target',acceptedAnswers:['target'],explanation:'explanation'})).rejects.toThrow();await expect(records.createContentReport(a,{sentenceVersionId:version.id,reason:'OTHER',detail:'private'})).rejects.toMatchObject({status:404});
  const metadata=await personal.getPersonalSet(a,set.id);expect(JSON.stringify(metadata)).not.toContain('Answer 1');
 });
 it('appends immutable versions, invalidates PRACTICE, preserves baseline/history/schedule and replays answered events',async()=>{const {set,version}=await fixture();await learning.enrollSet(a,set.id);const session=await learning.createStudySession(a,{setId:set.id,mode:'WRITTEN'});const dto=await learning.getSession(a,session.id);expect(JSON.stringify(dto)).not.toContain('Answer 1');const event={itemId:dto.items[0].id,eventId:randomUUID(),answer:'Answer 1'};const answer=await learning.answerSessionItem(a,session.id,event);const pending=await learning.createStudySession(a,{setId:set.id,mode:'WRITTEN'});const state=await db.userSentenceState.findMany({where:{userId:a}});const history=await db.reviewEvent.findMany({where:{userId:a}});
  await personal.editPersonalSentence(a,version.sentenceId,{expectedVersionId:version.id,expectedRevision:set.revision,action:'EDIT',sentence:{prompt:'수정한 질문',target:'New answer'}});
  expect((await db.studySession.findUniqueOrThrow({where:{id:pending.id}})).status).toBe('ABANDONED');expect((await db.sentenceVersion.findUniqueOrThrow({where:{id:version.id}})).target).toBe('Answer 1');expect(await db.userSentenceState.findMany({where:{userId:a}})).toEqual(state);expect(await db.reviewEvent.findMany({where:{userId:a}})).toEqual(history);expect((await db.assessmentCohort.findFirstOrThrow({where:{userId:a}})).baselineVersionId).toBe(version.id);expect(await learning.answerSessionItem(a,session.id,event)).toMatchObject({target:answer.target,result:answer.result});const current=await personal.exposePersonalSet(a,set.id);expect(current[0]).toMatchObject({target:'New answer',versionNumber:2});await expect(personal.editPersonalSentence(a,version.sentenceId,{expectedVersionId:version.id,expectedRevision:set.revision,action:'ARCHIVE'})).rejects.toMatchObject({status:409});
 });
 it('resets only unanswered assignment links when a private sentence changes',async()=>{const {set,version}=await fixture();await learning.enrollSet(a,set.id);const session=await learning.createStudySession(a,{setId:set.id,mode:'WRITTEN'});const dto=await learning.getSession(a,session.id);const cohort=await db.assessmentCohort.findFirstOrThrow({where:{userId:a}});const now=new Date();const assignment=await db.assessmentAssignment.create({data:{cohortId:cohort.id,kind:'WEEKLY',periodKey:randomUUID(),opensAt:now,dueAt:now,closesAt:now,sessionItemId:dto.items[0].id}});await personal.editPersonalSentence(a,version.sentenceId,{expectedVersionId:version.id,expectedRevision:set.revision,action:'ARCHIVE'});expect(await db.assessmentAssignment.findUniqueOrThrow({where:{id:assignment.id}})).toMatchObject({sessionItemId:null,answeredAt:null});expect(await db.assessmentAssignment.count({where:{cohortId:cohort.id}})).toBe(1);});
 it('archive/restore retains objects and keeps enrollment paused',async()=>{const {set,version}=await fixture();await learning.enrollSet(a,set.id);const archived=await personal.updatePersonalSet(a,set.id,{expectedRevision:set.revision,status:'ARCHIVED'});expect((await scheduling.getTodayQueue(a)).items.some(i=>i.sentenceId===version.sentenceId)).toBe(false);await personal.updatePersonalSet(a,set.id,{expectedRevision:archived.revision,status:'ACTIVE'});expect(await db.enrollment.findUniqueOrThrow({where:{userId_setId:{userId:a,setId:set.id}}})).toMatchObject({paused:true});expect(await db.sentenceVersion.count({where:{sentenceId:version.sentenceId}})).toBe(1);});
 it('uses existing today queue, grading, due state and shared new/review budget for personal sentences',async()=>{const {set,version}=await fixture();await learning.enrollSet(a,set.id);await scheduling.updateStudyPlan(a,{displayName:'개인 학습자',dailyMinutes:5,timezone:'UTC',weekdays:[0,1,2,3,4,5,6],localTime:'00:00'});const queue=await scheduling.getTodayQueue(a);expect(queue.items).toEqual(expect.arrayContaining([expect.objectContaining({sentenceId:version.sentenceId,kind:'NEW',source:'PERSONAL'})]));expect(JSON.stringify(queue)).not.toContain('Answer 1');const session=await scheduling.createTodaySession(a);const dto=await learning.getSession(a,session.id);await learning.answerSessionItem(a,session.id,{itemId:dto.items[0].id,eventId:randomUUID(),answer:'Answer 1'});const state=await db.userSentenceState.findFirstOrThrow({where:{userId:a,sentenceId:version.sentenceId}});expect(state.dueAt).not.toBeNull();expect((await scheduling.getTodayQueue(a)).remainingSeconds).toBe(240);});
 it('records explicit authoring exposure monotonically and GET stays mutation-free',async()=>{const {set,version}=await fixture();const future=new Date(Date.now()+60000);await db.userSentencePreference.update({where:{userId_sentenceId:{userId:a,sentenceId:version.sentenceId}},data:{lastExposedAt:future}});await personal.getPersonalSet(a,set.id);expect((await db.userSentencePreference.findUniqueOrThrow({where:{userId_sentenceId:{userId:a,sentenceId:version.sentenceId}}})).lastExposedAt).toEqual(future);await personal.exposePersonalSet(a,set.id);expect((await db.userSentencePreference.findUniqueOrThrow({where:{userId_sentenceId:{userId:a,sentenceId:version.sentenceId}}})).lastExposedAt).toEqual(future);});
 it('supports text-only SPOKEN self verification without audio',async()=>{const {set}=await fixture();await learning.enrollSet(a,set.id);const session=await learning.createStudySession(a,{setId:set.id,mode:'SPOKEN'});const dto=await learning.getSession(a,session.id);const reveal=await learning.revealSessionItem(a,session.id,{itemId:dto.items[0].id,kind:'ANSWER'});expect(reveal.text).toBe('Answer 1');expect(reveal.audioUrl).toBeUndefined();expect(await learning.answerSessionItem(a,session.id,{itemId:dto.items[0].id,eventId:randomUUID(),selfRating:'GOOD'})).toMatchObject({result:'SELF_REPORTED'});});
 it('does not insert ANY row until all preview errors are fixed or explicitly removed',async()=>{const {set}=await fixture();const p=await preview(set.id,[personalRowSchema.parse({row:1,...value(2)}),personalRowSchema.parse({row:2,target:'Missing question'})]);await expect(imports.commitPersonalPreview(a,set.id,p.id,commitArgs(p))).rejects.toMatchObject({status:422});expect((await personal.getPersonalSet(a,set.id)).sentences).toHaveLength(1);const updated=await imports.editPersonalPreview(a,set.id,p.id,{expectedRevision:p.revision,rows:[p.rows[0]]});await expect(imports.commitPersonalPreview(a,set.id,p.id,commitArgs(p))).rejects.toMatchObject({status:409});expect(await imports.commitPersonalPreview(a,set.id,p.id,commitArgs(updated))).toMatchObject({created:1,skipped:0});});
 it('binds preview to owner/set/revision, expires it and returns same idempotent result',async()=>{const {set}=await fixture();const p=await preview(set.id);const args=commitArgs(p);for(const owner of [b,admin])await expect(imports.commitPersonalPreview(owner,set.id,p.id,args)).rejects.toMatchObject({status:404});const first=await imports.commitPersonalPreview(a,set.id,p.id,args);expect(await imports.commitPersonalPreview(a,set.id,p.id,args)).toEqual(first);expect((await personal.getPersonalSet(a,set.id)).sentences).toHaveLength(2);const next=await preview(set.id,[personalRowSchema.parse({row:3,...value(3)})]);await expect(imports.commitPersonalPreview(a,set.id,next.id,{...commitArgs(next),commitKey:args.commitKey})).rejects.toMatchObject({status:409});await db.personalSentenceImport.update({where:{id:next.id},data:{expiresAt:new Date(0)}});await expect(imports.commitPersonalPreview(a,set.id,next.id,commitArgs(next))).rejects.toMatchObject({status:409});expect((await db.personalSentenceImport.findUniqueOrThrow({where:{id:p.id}})).normalizedRows).toEqual([]);});
 it('deduplicates within file and set under serialized concurrent commits',async()=>{const {set}=await fixture();const p=await preview(set.id,[personalRowSchema.parse({row:1,...value()}),personalRowSchema.parse({row:2,...value(2)}),personalRowSchema.parse({row:3,...value(2)})]);expect(p.counts).toMatchObject({total:3,skipped:2,ready:1});const args=commitArgs(p);const results=await Promise.all([imports.commitPersonalPreview(a,set.id,p.id,args),imports.commitPersonalPreview(a,set.id,p.id,args)]);expect(results[0]).toEqual(results[1]);expect(results[0]).toMatchObject({created:1,skipped:2});expect((await personal.getPersonalSet(a,set.id)).sentences).toHaveLength(2);});
 it('rejects a preview after a concurrent direct edit and leaves all rows untouched',async()=>{const {set}=await fixture();const p=await preview(set.id);await personal.addPersonalSentences(a,set.id,{expectedRevision:set.revision,sentences:[value(5)]});await expect(imports.commitPersonalPreview(a,set.id,p.id,commitArgs(p))).rejects.toMatchObject({status:409});expect((await personal.getPersonalSet(a,set.id)).sentences).toHaveLength(2);});
 it('enforces set 100 and user active 1000 quotas atomically',async()=>{for(let batch=0;batch<10;batch++){const set=await personal.createPersonalSet(a,{title:`Quota ${batch}`});await personal.addPersonalSentences(a,set.id,{expectedRevision:1,sentences:Array.from({length:100},(_,i)=>value(batch*100+i))});if(batch===0)await expect(personal.addPersonalSentences(a,set.id,{expectedRevision:2,sentences:[value(9999)]})).rejects.toMatchObject({status:422});}const overflow=await personal.createPersonalSet(a,{title:'Overflow'});await expect(personal.addPersonalSentences(a,overflow.id,{expectedRevision:1,sentences:[value(9999)]})).rejects.toMatchObject({status:422});expect(await db.sentence.count({where:{ownerId:a,archivedAt:null}})).toBe(1000);expect((await personal.getPersonalSet(a,overflow.id)).sentences).toHaveLength(0);},120000);
});
