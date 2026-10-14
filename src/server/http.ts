import 'server-only';
import { ZodError, type ZodType } from 'zod';
import { appOrigin } from './env';
import { devLoginEnabled } from './dev-login';

function isAllowedOrigin(request: Request) {
 const origin = request.headers.get('origin');
 if (origin === appOrigin()) return true;
 if (!origin || !devLoginEnabled()) return false;
 try {
  const source = new URL(origin);
  // Next dev may normalize request.url's hostname. Host retains the browser's
  // actual destination; require an exact match, including the port.
  return source.origin === origin
   && ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)
   && source.protocol === new URL(request.url).protocol
   && source.host === request.headers.get('host');
 } catch { return false; }
}
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
type Context = {params:Promise<Record<string,string>>};
export function api(handler:(request:Request,context:Context)=>Promise<Response>){return async(request:Request,context:Context)=>{
 try{
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   if(!isAllowedOrigin(request)) throw new HttpError(403,'허용되지 않은 요청입니다. 페이지를 새로 열어 주세요.');
  }
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
