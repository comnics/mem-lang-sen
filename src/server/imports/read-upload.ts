import 'server-only';
import { HttpError } from '@/server/http';
export const MAX_PERSONAL_FILE=2*1024*1024;
export async function readPersonalUpload(request:Request) {
  const type=request.headers.get('content-type')??'';
  if(!type.startsWith('multipart/form-data;')) throw new HttpError(415,'파일 업로드 형식이 필요합니다.');
  const cap=MAX_PERSONAL_FILE+64*1024;
  if(Number(request.headers.get('content-length')??0)>cap) throw new HttpError(413,'파일은 최대 2MiB입니다.');
  const reader=request.body?.getReader();if(!reader) throw new HttpError(400,'파일이 없습니다.');
  const chunks:Uint8Array[]=[];let total=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>cap)throw new HttpError(413,'파일은 최대 2MiB입니다.');chunks.push(value);} } catch(e){await reader.cancel();throw e;}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  // Allocation/parsing occurs only AFTER a hard actual-byte bound.
  let form:FormData;
  try { form=await new Request('http://upload.invalid',{method:'POST',headers:{'content-type':type},body:bytes}).formData(); } catch { throw new HttpError(422,'파일 업로드 요청이 손상되었습니다.'); }
  const entries=[...form.entries()];
  if(entries.some(([key])=>!['file','mode','sheet'].includes(key))||new Set(entries.map(([key])=>key)).size!==entries.length) throw new HttpError(422,'지원하지 않는 업로드 필드입니다.');
  const file=form.get('file');
  if(!(file instanceof File)||file.size===0) throw new HttpError(422,'파일 하나를 선택해 주세요.');
  if(file.size>MAX_PERSONAL_FILE) throw new HttpError(413,'파일은 최대 2MiB입니다.');
  const extension=file.name.toLowerCase().split('.').at(-1);
  if(extension!=='xlsx'&&extension!=='txt') throw new HttpError(415,'XLS/XLSM은 지원하지 않습니다. .xlsx 또는 UTF-8 .txt로 저장해 주세요.');
  const mode=form.get('mode')??'LINES';const sheet=form.get('sheet');
  if(typeof mode!=='string'||!['LINES','TSV'].includes(mode)||sheet!==null&&(typeof sheet!=='string'||sheet.length>120)) throw new HttpError(422,'가져오기 옵션을 확인해 주세요.');
  return {bytes:new Uint8Array(await file.arrayBuffer()),format:extension,mode:mode as 'LINES'|'TSV',sheet:sheet as string|null};
}
