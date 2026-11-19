import { api, HttpError, jsonBody } from '@/server/http';
import { z } from 'zod';
import { personalRowsSchema } from '@/domain/personal-sentences';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { getPersonalSet } from '@/server/services/personal-content';
import { createPersonalPreview } from '@/server/services/personal-imports';
import { readPersonalUpload } from '@/server/imports/read-upload';
import { parsePersonalTxt } from '@/server/imports/txt';
import { parsePersonalXlsx } from '@/server/imports/xlsx';
export const runtime='nodejs';
const attempts=new Map<string,{start:number;count:number}>();
function throttle(userId:string){const now=Date.now();for(const [id,entry] of attempts)if(now-entry.start>60000)attempts.delete(id);let entry=attempts.get(userId);if(!entry){if(attempts.size>=1000)throw new HttpError(429,'잠시 후 다시 시도해 주세요.');entry={start:now,count:0};attempts.set(userId,entry);}if(++entry.count>10)throw new HttpError(429,'파일 처리는 분당 10회까지 가능합니다.');}
export const POST=api(async(request,context)=>{
 const user=await requireUser();await assertPersonalCsrf(request,user.id);const {id}=await context.params;
 await getPersonalSet(user.id,id);throttle(user.id);
 if(request.headers.get('content-type')?.includes('application/json')){const body=await jsonBody(request,z.object({rows:personalRowsSchema}).strict());return Response.json(await createPersonalPreview(user.id,id,'DIRECT',body.rows));}
 const upload=await readPersonalUpload(request);
 const parsed=upload.format==='xlsx'?await parsePersonalXlsx(upload.bytes,upload.sheet):{rows:parsePersonalTxt(upload.bytes,upload.mode),sheets:[]};
 if(!parsed.rows.length)return Response.json({sheets:parsed.sheets,chooseSheet:true});
 return Response.json({...await createPersonalPreview(user.id,id,upload.format+(upload.format==='xlsx'?':'+upload.sheet:':'+upload.mode),parsed.rows),sheets:parsed.sheets});
});
