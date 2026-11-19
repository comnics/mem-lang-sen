import 'server-only';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { HttpError } from '@/server/http';
import { personalRowsSchema, type PersonalRow } from '@/domain/personal-sentences';
import { XLSX_WORKER_SOURCE } from './xlsx-worker-source';
const resolve=createRequire(import.meta.url);
let active=0;
export async function parsePersonalXlsx(bytes:Uint8Array,sheet?:string|null):Promise<{sheets:string[];sheet?:string;rows:PersonalRow[]}> {
  if(active>=2)throw new HttpError(429,'파일 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  active++;
  try{return await new Promise((accept,reject)=>{
    const worker=new Worker(XLSX_WORKER_SOURCE,{eval:true,workerData:{bytes,sheet,saxPath:resolve.resolve('sax')},resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    let settled=false;
    const finish=(error?:Error,value?:{sheets:string[];sheet?:string;rows:PersonalRow[]})=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate().finally(()=>{if(error)reject(error);else accept(value!);});};
    const timer=setTimeout(()=>finish(new HttpError(422,'파일 처리 시간이 초과되었습니다. 더 작은 파일로 다시 시도해 주세요.')),5000);
    worker.once('message',(message)=>{
      if(!message.ok)return finish(new HttpError(422, typeof message.error==='string'?message.error:'XLSX 파일 오류입니다.'));
      try{const value=message.value;finish(undefined,{sheets:value.sheets,sheet:value.sheet,rows:value.rows.length?personalRowsSchema.parse(value.rows):[]});}catch{finish(new HttpError(422,'XLSX 행 형식이 잘못되었습니다.'));}
    });
    worker.once('error',()=>finish(new HttpError(422,'XLSX를 읽지 못했습니다.')));
    worker.once('exit',()=>{if(!settled)finish(new HttpError(422,'XLSX 처리가 중단되었습니다.'));});
  });}finally{active--;}
}
