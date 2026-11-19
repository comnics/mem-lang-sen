import { HttpError } from '@/server/http';
import { personalRowSchema, type PersonalRow } from '@/domain/personal-sentences';
export function parsePersonalTxt(bytes:Uint8Array,mode:'LINES'|'TSV'):PersonalRow[] {
  let text:string;
  try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new HttpError(422,'TXT는 올바른 UTF-8로 저장해 주세요.'); }
  if(text.includes('\0')||/\r(?!\n)/u.test(text)) throw new HttpError(422,'NUL 또는 지원하지 않는 줄바꿈이 있습니다.');
  const rows:PersonalRow[]=[];let columns=0;
  const lines=text.replace(/^\uFEFF/u,'').split(/\r?\n/u);
  if(lines.length>10000) throw new HttpError(422,'빈 행을 포함한 줄 수가 너무 많습니다.');
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim()) continue;
    const cells=lines[i].split('\t');
    if(mode==='TSV') {
      if(![2,3].includes(cells.length)||(columns&&columns!==cells.length)) throw new HttpError(422,`${i+1}행: TSV는 동일한 2열 또는 3열이어야 합니다.`);
      columns=cells.length;
    } else if(cells.length!==1) throw new HttpError(422,`${i+1}행: 한 줄 영어 모드에는 탭을 넣을 수 없습니다.`);
    if(cells.some(c=>c.length>4000)) throw new HttpError(422,`${i+1}행: 셀이 너무 깁니다.`);
    rows.push(personalRowSchema.parse({row:i+1,prompt:mode==='TSV'?cells[0]:'',target:mode==='TSV'?cells[1]:cells[0],meaning:mode==='TSV'?(cells[2]??''):''}));
    if(rows.length>100) throw new HttpError(422,'최대 100행을 가져올 수 있습니다.');
  }
  if(!rows.length) throw new HttpError(422,'가져올 문장이 없습니다.');
  return rows;
}
