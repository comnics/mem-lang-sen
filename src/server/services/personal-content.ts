import 'server-only';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';
import { personalSetSchema, personalSetPatchSchema, personalSentenceSchema, personalDuplicateKey, type PersonalSentenceValue } from '@/domain/personal-sentences';
import { registerCohort } from './assessments';

export async function lockPersonalUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM app."AppUser" WHERE id=${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
}
export async function lockPersonalSet(tx: Prisma.TransactionClient, userId: string, setId: string, revision?: number) {
  await tx.$queryRaw`SELECT id FROM app."StudySet" WHERE id=${setId} AND "ownerId"=${userId}::uuid AND scope='PERSONAL' FOR UPDATE`;
  const set = await tx.studySet.findFirst({ where: { id: setId, ownerId: userId, scope: 'PERSONAL' } });
  if (!set) throw new HttpError(404, '개인 세트를 찾을 수 없습니다.');
  if (revision !== undefined && set.revision !== revision) throw new HttpError(409, '다른 화면에서 변경되었습니다. 입력을 보관하고 다시 불러와 주세요.');
  return set;
}
export async function listPersonalSets(userId: string) {
  return db.studySet.findMany({ where: { ownerId: userId, scope: 'PERSONAL' }, orderBy: { updatedAt: 'desc' }, select: { id:true,title:true,description:true,status:true,revision:true,level:true,category:true,_count:{select:{sentences:true}} } });
}
// No answers on GET. Explicit POST authoring action records exposure before returning them.
export async function getPersonalSet(userId: string, id: string) {
  const set = await db.studySet.findFirst({ where: { id, ownerId:userId,scope:'PERSONAL' }, select: {id:true,title:true,description:true,level:true,category:true,status:true,revision:true,sentences:{orderBy:{order:'asc'},select:{order:true,sentenceVersion:{select:{id:true,sentenceId:true,prompt:true,versionNumber:true,sentence:{select:{archivedAt:true}}}}}},enrollments:{where:{userId},select:{paused:true}}} });
  if (!set) throw new HttpError(404,'개인 세트를 찾을 수 없습니다.');
  return set;
}
export async function exposePersonalSet(userId:string,id:string) {
  return db.$transaction(async(tx)=>{
    await lockPersonalUser(tx,userId); await lockPersonalSet(tx,userId,id);
    const members=await tx.setSentence.findMany({where:{setId:id},orderBy:{order:'asc'},include:{sentenceVersion:{include:{sentence:{select:{archivedAt:true}}}}}});
    const now=new Date();
    for(const member of members) await recordAuthorExposure(tx,userId,member.sentenceVersion.sentenceId,now);
    return members.map(m=>({...m.sentenceVersion,order:m.order}));
  });
}
export async function createPersonalSet(userId:string,input:z.input<typeof personalSetSchema>) {
  const data=personalSetSchema.parse(input);
  return db.$transaction(async(tx)=>{await lockPersonalUser(tx,userId);return tx.studySet.create({data:{...data,scope:'PERSONAL',ownerId:userId,status:'DRAFT'}});});
}
export const updatePersonalSetSchema=personalSetPatchSchema.extend({expectedRevision:z.number().int().positive(),status:z.enum(['ACTIVE','ARCHIVED']).optional()}).strict();
export async function updatePersonalSet(userId:string,id:string,input:z.input<typeof updatePersonalSetSchema>) {
  const {expectedRevision,...data}=updatePersonalSetSchema.parse(input);
  return db.$transaction(async(tx)=>{
    await lockPersonalUser(tx,userId); const set=await lockPersonalSet(tx,userId,id,expectedRevision);
    const members=await tx.setSentence.findMany({where:{setId:id},include:{sentenceVersion:{include:{sentence:true}}}});
    let status: 'DRAFT'|'ACTIVE'|'ARCHIVED'|undefined=data.status;
    if(data.status==='ACTIVE') {
      if(!members.some(m=>!m.sentenceVersion.sentence.archivedAt)) status='DRAFT';
      await assertPersonalQuota(tx,userId,set.status==='ARCHIVED'?members.filter(m=>!m.sentenceVersion.sentence.archivedAt).length:0);
    }
    if(data.status==='ARCHIVED') {
      await invalidatePersonalSessions(tx,userId,members.map(m=>m.sentenceVersion.sentenceId));
      await tx.enrollment.updateMany({where:{userId,setId:id},data:{paused:true}});
    }
    return tx.studySet.update({where:{id},data:{...data,status,revision:{increment:1}}});
  });
}
export async function assertPersonalQuota(tx:Prisma.TransactionClient,userId:string,adding:number) {
  const count=await tx.sentence.count({where:{ownerId:userId,scope:'PERSONAL',archivedAt:null,versions:{some:{setSentences:{some:{set:{status:{not:'ARCHIVED'}}}}}}}});
  if(count+adding>1000) throw new HttpError(422,'활성 개인 문장은 사용자당 최대 1,000개입니다.');
}
export async function appendPersonalRows(tx:Prisma.TransactionClient,userId:string,setId:string,values:PersonalSentenceValue[]) {
  const set=await lockPersonalSet(tx,userId,setId);
  if(set.status==='ARCHIVED') throw new HttpError(409,'보관한 세트를 먼저 복구해 주세요.');
  const members=await tx.setSentence.findMany({where:{setId},include:{sentenceVersion:true},orderBy:{order:'asc'}});
  const keys=new Set(members.map(m=>personalDuplicateKey(m.sentenceVersion)));
  const fresh=values.filter(v=>{const key=personalDuplicateKey(v);if(keys.has(key))return false;keys.add(key);return true;});
  if(members.length+fresh.length>100) throw new HttpError(422,'세트에는 보관한 문장을 포함해 최대 100개를 저장할 수 있습니다.');
  await assertPersonalQuota(tx,userId,fresh.length);
  let order=members.at(-1)?.order??0; const ids:string[]=[]; const now=new Date();
  for(const value of fresh) {
    const sentence=await tx.sentence.create({data:{scope:'PERSONAL',ownerId:userId}});
    const version=await tx.sentenceVersion.create({data:{...value,sentenceId:sentence.id,versionNumber:1,status:'ACTIVE'}});
    await tx.setSentence.create({data:{setId,sentenceVersionId:version.id,order:++order}});
    await recordAuthorExposure(tx,userId,sentence.id,now); ids.push(sentence.id);
  }
  if(fresh.length) {
    await tx.studySet.update({where:{id:setId},data:{revision:{increment:1},status:'ACTIVE'}});
    if(await tx.enrollment.findUnique({where:{userId_setId:{userId,setId}}})) await registerCohort(tx,userId,ids,now);
  }
  return {created:fresh.length,skipped:values.length-fresh.length,revision:set.revision+(fresh.length?1:0)};
}
export const addPersonalSentencesSchema=z.object({expectedRevision:z.number().int().positive(),sentences:z.array(personalSentenceSchema).min(1).max(100)}).strict();
export async function addPersonalSentences(userId:string,setId:string,input:z.input<typeof addPersonalSentencesSchema>) {
  const data=addPersonalSentencesSchema.parse(input);
  return db.$transaction(async(tx)=>{await lockPersonalUser(tx,userId);await lockPersonalSet(tx,userId,setId,data.expectedRevision);return appendPersonalRows(tx,userId,setId,data.sentences);},{timeout:20000});
}
export const editPersonalSentenceSchema=z.object({expectedVersionId:z.string().cuid(),expectedRevision:z.number().int().positive(),action:z.enum(['EDIT','ARCHIVE','RESTORE']),sentence:personalSentenceSchema.optional()}).strict();
export async function editPersonalSentence(userId:string,id:string,input:z.input<typeof editPersonalSentenceSchema>) {
  const data=editPersonalSentenceSchema.parse(input);
  return db.$transaction(async(tx)=>{
    await lockPersonalUser(tx,userId);
    const membership=await tx.setSentence.findFirst({where:{sentenceVersion:{sentenceId:id,sentence:{ownerId:userId,scope:'PERSONAL'}},set:{ownerId:userId,scope:'PERSONAL'}},include:{sentenceVersion:true}});
    if(!membership) throw new HttpError(404,'문장을 찾을 수 없습니다.');
    const set=await lockPersonalSet(tx,userId,membership.setId,data.expectedRevision);
    await tx.$queryRaw`SELECT id FROM app."Sentence" WHERE id=${id} FOR UPDATE`;
    if(membership.sentenceVersionId!==data.expectedVersionId) throw new HttpError(409,'문장이 변경되었습니다. 다시 불러와 주세요.');
    const current=await tx.sentence.findUniqueOrThrow({where:{id}});
    if(data.action==='EDIT') {
      if(!data.sentence) throw new HttpError(422,'수정할 문장을 입력해 주세요.');
      const others=await tx.setSentence.findMany({where:{setId:set.id,sentenceVersion:{sentenceId:{not:id}}},include:{sentenceVersion:true}});
      if(others.some(m=>personalDuplicateKey(m.sentenceVersion)===personalDuplicateKey(data.sentence!))) throw new HttpError(409,'이미 같은 질문과 정답의 문장이 있습니다.');
      const next=await tx.sentenceVersion.create({data:{...data.sentence,sentenceId:id,versionNumber:membership.sentenceVersion.versionNumber+1,status:'ACTIVE'}});
      await tx.setSentence.update({where:{setId_sentenceVersionId:{setId:set.id,sentenceVersionId:membership.sentenceVersionId}},data:{sentenceVersionId:next.id}});
      await recordAuthorExposure(tx,userId,id,new Date());
    } else {
      if(data.action==='RESTORE'&&current.archivedAt&&set.status!=='ARCHIVED') await assertPersonalQuota(tx,userId,1);
      await tx.sentence.update({where:{id},data:{archivedAt:data.action==='ARCHIVE'?new Date():null}});
    }
    await invalidatePersonalSessions(tx,userId,[id]);
    return tx.studySet.update({where:{id:set.id},data:{revision:{increment:1},...(data.action==='RESTORE'&&set.status==='DRAFT'?{status:'ACTIVE' as const}:{})}});
  });
}
export async function invalidatePersonalSessions(tx:Prisma.TransactionClient,userId:string,sentenceIds:string[]) {
  const sessions=await tx.studySession.findMany({where:{userId,status:'ACTIVE',items:{some:{sentenceId:{in:sentenceIds}}}},select:{id:true}});
  const ids=sessions.map(s=>s.id);
  await tx.assessmentAssignment.updateMany({where:{answeredAt:null,item:{sessionId:{in:ids}},cohort:{userId}},data:{sessionItemId:null}});
  await tx.studySession.updateMany({where:{userId,id:{in:ids},status:'ACTIVE'},data:{status:'ABANDONED'}});
}
export async function recordAuthorExposure(tx:Prisma.TransactionClient,userId:string,sentenceId:string,now:Date) {
  await tx.userSentencePreference.upsert({where:{userId_sentenceId:{userId,sentenceId}},create:{userId,sentenceId,lastExposedAt:now},update:{}});
  await tx.userSentencePreference.updateMany({where:{userId,sentenceId,OR:[{lastExposedAt:null},{lastExposedAt:{lt:now}}]},data:{lastExposedAt:now}});
}
