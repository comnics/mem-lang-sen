 'use client';
import { useEffect, useId } from 'react';
import type { PersonalRow,PersonalRowError } from '@/domain/personal-sentences';
export function emptyPersonalRow(row=1):PersonalRow{return {row,prompt:'',target:'',meaning:'',hint:'',explanation:'',acceptedAnswers:[],level:'A1'};}
export function usePersonalUnsaved(dirty:boolean){useEffect(()=>{if(!dirty)return;const handler=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',handler);const click=(event:MouseEvent)=>{const anchor=(event.target as Element)?.closest('a');if(anchor&&anchor.href!==location.href&&!window.confirm('저장하지 않은 입력이 있습니다. 이동할까요?')){event.preventDefault();event.stopPropagation();}};document.addEventListener('click',click,true);return()=>{window.removeEventListener('beforeunload',handler);document.removeEventListener('click',click,true);};},[dirty]);}
export function PersonalSentenceEditor({rows,onChange,errors=[],disabled=false}:{rows:PersonalRow[];onChange:(rows:PersonalRow[])=>void;errors?:PersonalRowError[];disabled?:boolean}){
 const prefix=useId();
 function update(index:number,field:keyof PersonalRow,value:string){onChange(rows.map((row,i)=>i===index?{...row,[field]:field==='acceptedAnswers'?value.split('|').map(v=>v.trim()).filter(Boolean):value}:row));}
 function move(index:number,delta:number){const next=[...rows];[next[index],next[index+delta]]=[next[index+delta],next[index]];onChange(next);}
 return <div className="stack personal-editor" aria-busy={disabled}>
  {errors.length>0?<div role="alert" className="notice notice-error"><strong>오류 {errors.length}개 · 아직 저장되지 않았습니다.</strong><ul>{errors.map((e,i)=><li key={i}><a href={`#${prefix}-${rows.findIndex(r=>r.row===e.row)}-${e.field}`}>{e.row}행 {e.field}: {e.message}</a></li>)}</ul></div>:null}
  {rows.map((row,index)=><fieldset className="card stack" key={`${prefix}-${row.row}`} disabled={disabled}>
   <legend>{row.row}행</legend>
   {(['prompt','target'] as const).map(field=><label key={field} htmlFor={`${prefix}-${index}-${field}`}>{field==='prompt'?'한국어 질문/상황 (필수)':'영어 정답 (필수)'}<textarea id={`${prefix}-${index}-${field}`} value={row[field]} maxLength={4000} rows={2} aria-invalid={errors.some(e=>e.row===row.row&&e.field===field)} onChange={e=>update(index,field,e.target.value)}/></label>)}
   <details><summary>보조 설명·허용 답안·힌트·해설·난도</summary><div className="stack">
    {(['meaning','acceptedAnswers','hint','explanation'] as const).map(field=><label key={field} htmlFor={`${prefix}-${index}-${field}`}>{{meaning:'학습 중 보이는 보조 설명 (선택, 500자)',acceptedAnswers:'허용 답안 (선택, | 구분, 정답 포함 최대 12개)',hint:'공개 요청 시 보이는 힌트 (선택, 500자)',explanation:'제출 후 해설 (선택, 1,000자)'}[field]}<textarea id={`${prefix}-${index}-${field}`} value={field==='acceptedAnswers'?row.acceptedAnswers.join('|'):row[field]} maxLength={field==='acceptedAnswers'?7000:4000} onChange={e=>update(index,field,e.target.value)}/></label>)}
    <label htmlFor={`${prefix}-${index}-level`}>난도<select id={`${prefix}-${index}-level`} value={row.level} onChange={e=>update(index,'level',e.target.value)}>{['A1','A2','B1'].map(level=><option key={level}>{level}</option>)}</select></label>
   </div></details>
   <div className="button-row"><button type="button" className="button-secondary" disabled={index===0} onClick={()=>move(index,-1)}>위로</button><button type="button" className="button-secondary" disabled={index===rows.length-1} onClick={()=>move(index,1)}>아래로</button><button type="button" className="button-secondary" onClick={()=>{onChange(rows.filter((_,i)=>i!==index));queueMicrotask(()=>document.getElementById(`${prefix}-add`)?.focus());}}>행 제거</button></div>
  </fieldset>)}
  <button id={`${prefix}-add`} type="button" className="button-secondary" disabled={disabled||rows.length>=100} onClick={()=>onChange([...rows,emptyPersonalRow(Math.max(0,...rows.map(r=>r.row))+1)])}>행 추가</button>
 </div>;
}
