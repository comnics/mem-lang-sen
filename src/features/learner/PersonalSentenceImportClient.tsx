 'use client';
import { useRef,useState } from 'react';
import type { PersonalRow,PersonalRowError } from '@/domain/personal-sentences';
import { PersonalSentenceEditor,usePersonalUnsaved } from './PersonalSentenceEditor';
import { personalRequest } from './personal-api';
type Preview={id:string;revision:number;setRevision:number;payloadHash:string;rows:PersonalRow[];errors:PersonalRowError[];expiresAt:string;counts:{total:number;skipped:number;ready:number;duplicates:number[]}};
export function PersonalSentenceImportClient({setId,onSaved}:{setId:string;onSaved:()=>Promise<void>}){
 const [file,setFile]=useState<File|null>(null),[mode,setMode]=useState('LINES'),[sheet,setSheet]=useState(''),[sheets,setSheets]=useState<string[]>([]);
 const [preview,setPreview]=useState<Preview|null>(null),[rows,setRows]=useState<PersonalRow[]>([]),[dirty,setDirty]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 const commitKey=useRef<string|null>(null);usePersonalUnsaved(dirty||Boolean(preview));
 const base=`/api/v1/personal-sets/${setId}/imports`;
 async function perform(action:()=>Promise<void>){if(pending)return;setPending(true);setMessage('');try{await action();}catch(e){setMessage(e instanceof Error?e.message:'가져오기에 실패했습니다.');}finally{setPending(false);}}
 async function upload(){await perform(async()=>{if(!file)throw new Error('파일을 선택해 주세요.');const form=new FormData();form.set('file',file);form.set('mode',mode);if(sheet)form.set('sheet',sheet);const data=await personalRequest<Preview&{sheets:string[];chooseSheet?:boolean}>(`${base}/preview`,'POST',form);setSheets(data.sheets??[]);if(data.chooseSheet){setMessage('시트를 선택하고 미리보기를 다시 눌러 주세요.');return;}setPreview(data);setRows(data.rows);setDirty(false);commitKey.current=null;});}
 async function revalidate(){await perform(async()=>{if(!preview)return;const data=await personalRequest<Preview>(`${base}/${preview.id}`,'PATCH',{expectedRevision:preview.revision,rows});setPreview(data);setRows(data.rows);setDirty(false);commitKey.current=null;});}
 async function commit(){await perform(async()=>{if(!preview||dirty)return;commitKey.current??=crypto.randomUUID();const data=await personalRequest<{created:number;skipped:number}>(`${base}/${preview.id}/commit`,'POST',{commitKey:commitKey.current,expectedSetRevision:preview.setRevision,expectedRevision:preview.revision,payloadHash:preview.payloadHash});setPreview(null);setRows([]);setDirty(false);setFile(null);setMessage(`저장 ${data.created}개 · 중복 건너뜀 ${data.skipped}개`);await onSaved();});}
 return <section className="card stack" aria-busy={pending}>
  <h2>XLSX / TXT 가져오기</h2><p className="muted">파일 2MiB · 최대 100행 · 미리보기는 30분 후 만료됩니다. 원본 파일은 저장하지 않습니다. XLS/XLSM·수식·링크·병합 셀은 지원하지 않습니다.</p>
  <div className="button-row"><a href="/templates/personal-sentences.xlsx" download>XLSX 예제 받기</a><a href="/templates/personal-sentences.tsv.txt" download>TSV TXT 예제 받기</a><a href="/templates/personal-sentences.lines.txt" download>영어 한 줄 TXT 예제 받기</a></div>
  <label>파일 선택<input type="file" accept=".xlsx,.txt" disabled={pending} onChange={e=>{if(preview&&!window.confirm('현재 미리보기를 버리고 다른 파일을 선택할까요?'))return;setFile(e.target.files?.[0]??null);setSheet('');setSheets([]);setPreview(null);setRows([]);setDirty(false);}}/></label>
  <label>TXT 형식<select value={mode} disabled={pending} onChange={e=>{if(preview&&!window.confirm('형식을 바꾸면 현재 미리보기가 취소됩니다. 계속할까요?'))return;setMode(e.target.value);setPreview(null);setRows([]);setDirty(false);commitKey.current=null;}}><option value="LINES">영어 한 줄씩 (질문은 미리보기에서 입력)</option><option value="TSV">탭 2/3열 (질문 TAB 정답 TAB 선택 보조설명, 헤더 없음)</option></select></label>
  {sheets.length>1?<label>시트 선택<select value={sheet} onChange={e=>{if(preview&&!window.confirm('시트를 바꾸면 현재 미리보기가 취소됩니다. 계속할까요?'))return;setSheet(e.target.value);setPreview(null);setRows([]);setDirty(false);commitKey.current=null;}} disabled={pending}><option value="">선택해 주세요</option>{sheets.map(s=><option key={s}>{s}</option>)}</select></label>:null}
  <button className="button-secondary" type="button" disabled={!file||pending} onClick={upload}>파일 미리보기</button>
  {preview?<><p>전체 {preview.counts.total}행 · 중복 {preview.counts.skipped}행 (건너뜀) · 신규 {preview.counts.ready}행</p>{preview.counts.duplicates.length?<p>중복 행: {preview.counts.duplicates.join(', ')}</p>:null}<p className="muted">오류 행은 수정하거나 직접 제거하세요. 한 행이라도 오류가 있으면 아무 문장도 저장하지 않습니다.</p><PersonalSentenceEditor rows={rows} onChange={next=>{setRows(next);setDirty(true);commitKey.current=null;}} errors={preview.errors} disabled={pending}/><div className="button-row"><button className="button-secondary" type="button" disabled={pending||!rows.length} onClick={revalidate}>수정 내용 서버 재검증</button><button className="button" type="button" disabled={pending||dirty||preview.errors.length>0||!rows.length} onClick={commit}>미리보기 전체 저장</button></div>{dirty?<p role="status">입력이 변경되었습니다. 현재 {rows.length}행 (제거 {Math.max(0,preview.rows.length-rows.length)}행). 서버 재검증 후 저장할 수 있습니다.</p>:null}</>:null}
  <p role="status">{pending?'처리 중…':message}</p>
 </section>;
}
