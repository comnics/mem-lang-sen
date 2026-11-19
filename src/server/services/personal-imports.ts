import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';
import { personalRowsSchema, personalSentenceSchema, validatePersonalRows, personalDuplicateKey, type PersonalRow } from '@/domain/personal-sentences';
import { lockPersonalUser,lockPersonalSet,appendPersonalRows } from './personal-content';
const ttl=30*60*1000;
function digest(userId:string,setId:string,format:string,revision:number,rows:PersonalRow[]) {return createHash('sha256').update(JSON.stringify({userId,setId,format,revision,rows})).digest('hex');}
async function cleanup(tx:Prisma.TransactionClient,userId:string,now:Date) {
  const stale=await tx.personalSentenceImport.findMany({where:{expiresAt:{lt:now},NOT:{normalizedRows:{equals:[]}}},select:{id:true},take:20});
  await tx.personalSentenceImport.updateMany({where:{id:{in:stale.map(p=>p.id)}},data:{normalizedRows:[],errors:[]}});
  const old=await tx.personalSentenceImport.findMany({where:{ownerId:userId,createdAt:{lt:new Date(now.getTime()-7*86400000)}},select:{id:true},take:20});
  await tx.personalSentenceImport.deleteMany({where:{id:{in:old.map(p=>p.id)}}});
}
async function previewCounts(tx:Prisma.TransactionClient,setId:string,rows:PersonalRow[]) {
  const members=await tx.setSentence.findMany({where:{setId},include:{sentenceVersion:true}});
  const keys=new Set(members.map(m=>personalDuplicateKey(m.sentenceVersion)));const duplicates:number[]=[];
  for(const row of rows){const key=personalDuplicateKey(row);if(keys.has(key))duplicates.push(row.row);else keys.add(key);}
  return {total:rows.length,duplicates,skipped:duplicates.length,ready:rows.length-duplicates.length};
}
export async function createPersonalPreview(userId:string,setId:string,format:string,input:PersonalRow[]) {
  const parsed=validatePersonalRows(personalRowsSchema.parse(input));
  return db.$transaction(async(tx)=>{
    await lockPersonalUser(tx,userId);const set=await lockPersonalSet(tx,userId,setId);const now=new Date();
    if(set.status==='ARCHIVED')throw new HttpError(409,'보관한 세트를 먼저 복구해 주세요.');
    await cleanup(tx,userId,now);
    if(await tx.personalSentenceImport.count({where:{ownerId:userId,createdAt:{gte:new Date(now.getTime()-60000)}}})>=10)throw new HttpError(429,'분당 10회까지 미리보기를 만들 수 있습니다.');
    const preview=await tx.personalSentenceImport.create({data:{ownerId:userId,setId,format,normalizedRows:parsed.rows,errors:parsed.errors,setRevision:set.revision,payloadHash:digest(userId,setId,format,set.revision,parsed.rows),expiresAt:new Date(now.getTime()+ttl)}});
    return {...preview,rows:parsed.rows,counts:await previewCounts(tx,setId,parsed.rows)};
  });
}
export const editPersonalPreviewSchema=z.object({expectedRevision:z.number().int().positive(),rows:personalRowsSchema}).strict();
export async function editPersonalPreview(userId:string,setId:string,id:string,input:z.input<typeof editPersonalPreviewSchema>) {
  const data=editPersonalPreviewSchema.parse(input);const parsed=validatePersonalRows(data.rows);
  return db.$transaction(async(tx)=>{
    await lockPersonalUser(tx,userId);const set=await lockPersonalSet(tx,userId,setId);
    const preview=await tx.personalSentenceImport.findFirst({where:{id,setId,ownerId:userId}});
    if(!preview)throw new HttpError(404,'미리보기를 찾을 수 없습니다.');
    if(preview.status!=='PREVIEW'||preview.expiresAt<new Date()||preview.revision!==data.expectedRevision)throw new HttpError(409,'미리보기가 변경되었거나 만료되었습니다.');
    const updated=await tx.personalSentenceImport.update({where:{id},data:{normalizedRows:parsed.rows,errors:parsed.errors,revision:{increment:1},setRevision:set.revision,payloadHash:digest(userId,setId,preview.format,set.revision,parsed.rows)}});
    return {...updated,rows:parsed.rows,counts:await previewCounts(tx,setId,parsed.rows)};
  });
}
export const commitPersonalPreviewSchema=z.object({commitKey:z.string().uuid(),expectedSetRevision:z.number().int().positive(),expectedRevision:z.number().int().positive(),payloadHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function commitPersonalPreview(userId:string,setId:string,id:string,input:z.input<typeof commitPersonalPreviewSchema>) {
  const data=commitPersonalPreviewSchema.parse(input);
  return db.$transaction(async(tx)=>{
    await lockPersonalUser(tx,userId);await lockPersonalSet(tx,userId,setId);
    const replay=await tx.personalSentenceImport.findUnique({where:{ownerId_commitKey:{ownerId:userId,commitKey:data.commitKey}}});
    if(replay){if(replay.id!==id||replay.setId!==setId||replay.payloadHash!==data.payloadHash||replay.revision!==data.expectedRevision||replay.setRevision!==data.expectedSetRevision)throw new HttpError(409,'저장 키가 다른 내용으로 사용되었습니다.');return replay.result;}
    const preview=await tx.personalSentenceImport.findFirst({where:{id,setId,ownerId:userId}});
    if(!preview)throw new HttpError(404,'미리보기를 찾을 수 없습니다.');
    if(preview.status!=='PREVIEW'||preview.expiresAt<new Date()||preview.revision!==data.expectedRevision||preview.payloadHash!==data.payloadHash||preview.setRevision!==data.expectedSetRevision)throw new HttpError(409,'미리보기가 변경되었거나 만료되었습니다. 다시 검증해 주세요.');
    await lockPersonalSet(tx,userId,setId,data.expectedSetRevision);
    const rows=personalRowsSchema.parse(preview.normalizedRows);const parsed=validatePersonalRows(rows);
    if(parsed.errors.length)throw new HttpError(422,'오류가 있는 행을 수정하거나 제거해 주세요. 아무 문장도 저장하지 않았습니다.');
    if(digest(userId,setId,preview.format,preview.setRevision,rows)!==preview.payloadHash)throw new HttpError(409,'미리보기 내용이 일치하지 않습니다.');
    const values=rows.map(({row:_row,...row})=>{void _row;return personalSentenceSchema.parse(row);});
    const result=await appendPersonalRows(tx,userId,setId,values);
    await tx.personalSentenceImport.update({where:{id},data:{status:'COMMITTED',commitKey:data.commitKey,result,normalizedRows:[],errors:[],committedAt:new Date()}});
    return result;
  },{timeout:20000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
