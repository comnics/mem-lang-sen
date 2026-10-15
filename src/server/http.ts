import 'server-only';
import { ZodError, type ZodType } from 'zod';
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
type Context = {params:Promise<Record<string,string>>};
export function api(handler:(request:Request,context:Context)=>Promise<Response>){return async(request:Request,context:Context)=>{
 try{
  const response=await handler(request,context);response.headers.set('Cache-Control','private, no-store');return response;
 }catch(error){
  if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
  if(error instanceof ZodError)return Response.json({error:error.issues[0]?.message ?? '입력값을 확인해 주세요.'},{status:400,headers:{'Cache-Control':'no-store'}});
  if(error instanceof SyntaxError)return Response.json({error:'요청 형식을 확인해 주세요.'},{status:400});
  console.error('request_failed',{name:error instanceof Error?error.name:'UnknownError'});
  return Response.json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:500,headers:{'Cache-Control':'no-store'}});
 }
};}
export async function jsonBody<T>(request:Request,schema:ZodType<T>):Promise<T>{
 if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'JSON 형식의 요청이 필요합니다.');
 const max=1024*1024;const declared=Number(request.headers.get('content-length')??0);
 if(declared>max)throw new HttpError(413,'요청이 너무 큽니다.');
 const reader=request.body?.getReader(); if(!reader)throw new HttpError(400,'입력값이 없습니다.');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new HttpError(413,'요청이 너무 큽니다.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
