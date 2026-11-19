 'use client';
import Link from 'next/link';
import { useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PersonalRow } from '@/domain/personal-sentences';
import { validatePersonalRows } from '@/domain/personal-sentences';
import { PersonalSentenceEditor,emptyPersonalRow,usePersonalUnsaved } from './PersonalSentenceEditor';
import { PersonalSentenceImportClient } from './PersonalSentenceImportClient';
import { EnrollmentControls } from './EnrollmentControls';
import { personalRequest } from './personal-api';
type SetSummary={id:string;title:string;description:string;status:string;revision:number;level:string;category:string;_count:{sentences:number}};
type SetDetail=Omit<SetSummary,'_count'>&{enrollments:{paused:boolean}[];sentences:{order:number;sentenceVersion:{id:string;sentenceId:string;prompt:string;versionNumber:number;sentence:{archivedAt:unknown}}}[]};
type DirectPreview={id:string;revision:number;setRevision:number;payloadHash:string;rows:PersonalRow[];errors:import('@/domain/personal-sentences').PersonalRowError[];counts:{total:number;ready:number;skipped:number}};
type Authored=PersonalRow&{id:string;sentenceId:string;versionNumber:number;sentence:{archivedAt:string|null}};
export function PersonalSetList({initialSets}:{initialSets:SetSummary[]}){
 const router=useRouter();const [title,setTitle]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');usePersonalUnsaved(Boolean(title));
 return <div className="stack-lg"><form className="card stack" onSubmit={async(e)=>{e.preventDefault();if(pending)return;setPending(true);setError('');try{const result=await personalRequest<{id:string}>('/api/v1/personal-sets','POST',{title});setTitle('');router.push(`/sentences/personal/${result.id}`);}catch(e){setError(e instanceof Error?e.message:'세트를 만들지 못했습니다.');}finally{setPending(false);}}}>
 <label>새 개인 세트 이름<input value={title} maxLength={120} required onChange={e=>setTitle(e.target.value)}/></label><button className="button" disabled={pending}>개인 세트 만들기</button>{error?<p role="alert">{error}</p>:null}</form>
 {!initialSets.length?<p className="card">아직 직접 만든 문장이 없습니다. 개인 세트를 만든 뒤 문장을 입력하거나 가져오세요.</p>:null}
 {initialSets.map(set=><article className="card stack" key={set.id}><span className="badge">비공개 개인 · {set.status==='ARCHIVED'?'보관함':set.status==='DRAFT'?'작성 중':'학습 가능'}</span><h2><Link href={`/sentences/personal/${set.id}`}>{set.title}</Link></h2><p>{set.description}</p><p>{set._count.sentences}문장 · {set.level}</p></article>)}
 </div>;
}
export function PersonalSetWorkspace({initialSet}:{initialSet:SetDetail}){
 const [set,setSet]=useState(initialSet),[authored,setAuthored]=useState<Authored[]|null>(null),[editing,setEditing]=useState<string|null>(null),[editRows,setEditRows]=useState<PersonalRow[]>([]);
 const [rows,setRows]=useState<PersonalRow[]>([emptyPersonalRow()]),[title,setTitle]=useState(initialSet.title),[description,setDescription]=useState(initialSet.description);
 const [directPreview,setDirectPreview]=useState<DirectPreview|null>(null);const directCommitKey=useRef<string|null>(null);
 const [pending,setPending]=useState(false),[message,setMessage]=useState(''),[directDirty,setDirectDirty]=useState(false),[editDirty,setEditDirty]=useState(false);
 const dirty=directDirty||editDirty||title!==set.title||description!==set.description;usePersonalUnsaved(dirty);
 const base=`/api/v1/personal-sets/${set.id}`;
 async function refresh(){const current=await personalRequest<SetDetail>(base);setSet(current);if(authored)setAuthored(await personalRequest<Authored[]>(`${base}/authoring`,'POST'));}
 async function perform(action:()=>Promise<void>){if(pending)return;setPending(true);setMessage('');try{await action();}catch(e){setMessage(e instanceof Error?e.message:'저장에 실패했습니다. 입력은 유지됩니다.');}finally{setPending(false);}}
 async function setStatus(status:'ACTIVE'|'ARCHIVED'){if(status==='ARCHIVED'&&!window.confirm('보관하면 진행 중 학습이 만료되고 새 학습이 중지됩니다. 기록은 남습니다. 계속할까요?'))return;await perform(async()=>{await personalRequest(base,'PATCH',{expectedRevision:set.revision,status});await refresh();});}
 const directErrors=directDirty?validatePersonalRows(rows).errors:[];
 return <div className="stack-lg personal-workspace" aria-busy={pending}>
  <div className="button-row"><Link href="/sentences/personal">개인 세트 목록</Link><Link href="/sentences">연습 기록</Link><Link href="/today">오늘 / 복습</Link></div>
  <p className="notice">비공개 개인 문장입니다. 음원 없이 입력 회상·말하기 텍스트 자기확인이 가능합니다. 자동 번역·TTS는 제공하지 않습니다.</p>
  <p className="muted">수정은 새 버전으로 저장하고 기존 진도·일정·기록은 초기화하지 않습니다. 새 학습 주기는 새 문장을 추가하세요. 7/30일 유지 평가는 이전 기준 문장으로 나올 수 있습니다. 정답 편집을 열면 해당 학습일의 평가를 미룹니다.</p>
  <form className="card stack" onSubmit={e=>{e.preventDefault();void perform(async()=>{await personalRequest(base,'PATCH',{expectedRevision:set.revision,title,description});await refresh();setMessage('세트 정보를 저장했습니다.');});}}>
   <label>세트 이름<input value={title} required maxLength={120} onChange={e=>setTitle(e.target.value)}/></label><label>세트 설명<textarea value={description} maxLength={500} onChange={e=>setDescription(e.target.value)}/></label><p>개정 {set.revision} · {set.status==='ARCHIVED'?'보관됨':set.status==='DRAFT'?'작성 중':'학습 가능'}</p><div className="button-row"><button className="button-secondary" disabled={pending}>세트 정보 저장</button><button className="button-secondary" type="button" disabled={pending} onClick={()=>setStatus(set.status==='ARCHIVED'?'ACTIVE':'ARCHIVED')}>{set.status==='ARCHIVED'?'세트 복구':'세트 보관'}</button></div>
  </form>
  {set.status==='ACTIVE'?<EnrollmentControls key={`${set.id}-${set.status}-${set.enrollments[0]?.paused}`} setId={set.id} enrolled={Boolean(set.enrollments.length)} paused={set.enrollments[0]?.paused??false}/>:null}
  <p className="muted">저장과 학습 등록은 별도입니다. 등록한 문장은 공용 문장과 같은 일일 예산·복습 우선 규칙을 사용합니다. 복구해도 등록 일시정지는 자동 해제되지 않습니다.</p>
  <section className="card stack"><h2>저장한 문장</h2>{!set.sentences.length?<p>직접 입력하거나 파일을 가져와 주세요.</p>:null}
   {!authored?<><ul>{set.sentences.map(m=><li key={m.sentenceVersion.id}>{m.sentenceVersion.prompt} · v{m.sentenceVersion.versionNumber}{m.sentenceVersion.sentence.archivedAt?' · 보관됨':''}</li>)}</ul><button type="button" className="button-secondary" disabled={pending} onClick={()=>perform(async()=>setAuthored(await personalRequest<Authored[]>(`${base}/authoring`,'POST')))}>정답을 보고 저장 문장 편집 열기</button></>:authored.map(sentence=><article className="card stack" key={sentence.id}><span className="badge">개인 · v{sentence.versionNumber}{sentence.sentence.archivedAt?' · 보관됨':''}</span><h3>{sentence.prompt}</h3><p>{sentence.target}</p><div className="button-row"><button className="button-secondary" type="button" disabled={pending} onClick={()=>{if(editDirty&&!window.confirm('현재 수정 내용을 버릴까요?'))return;setEditing(sentence.sentenceId);setEditRows([{row:1,prompt:sentence.prompt,target:sentence.target,meaning:sentence.meaning,hint:sentence.hint,explanation:sentence.explanation,acceptedAnswers:sentence.acceptedAnswers,level:sentence.level}]);setEditDirty(false);}}>문장 수정</button><button className="button-secondary" type="button" disabled={pending} onClick={()=>perform(async()=>{await personalRequest(`/api/v1/personal-sentences/${sentence.sentenceId}`,'PATCH',{expectedVersionId:sentence.id,expectedRevision:set.revision,action:sentence.sentence.archivedAt?'RESTORE':'ARCHIVE'});await refresh();})}>{sentence.sentence.archivedAt?'문장 복구':'문장 보관'}</button></div>
    {editing===sentence.sentenceId?<div className="stack"><PersonalSentenceEditor rows={editRows} onChange={next=>{setEditRows(next);setEditDirty(true);}} disabled={pending}/><button className="button" type="button" disabled={pending||editRows.length!==1} onClick={()=>perform(async()=>{const {row:_row,...value}=editRows[0];void _row;await personalRequest(`/api/v1/personal-sentences/${sentence.sentenceId}`,'PATCH',{expectedVersionId:sentence.id,expectedRevision:set.revision,action:'EDIT',sentence:value});setEditDirty(false);setEditing(null);await refresh();setMessage('새 버전으로 수정했습니다. 구버전 진행 중 세션은 만료되었습니다.');})}>새 버전 저장</button></div>:null}
   </article>)}
  </section>
  {set.status!=='ARCHIVED'?<><section className="card stack"><h2>문장 직접 입력</h2><p className="muted">질문과 영어 정답 각각 1~500자. 정답을 질문으로 자동 복제하지 않습니다. 같은 질문+정답은 중복으로 건너뜁니다.</p><PersonalSentenceEditor rows={rows} onChange={next=>{setRows(next);setDirectDirty(true);setDirectPreview(null);directCommitKey.current=null;}} errors={directPreview?.errors??directErrors} disabled={pending}/><button className="button-secondary" type="button" disabled={pending||!rows.length} onClick={()=>perform(async()=>{setDirectDirty(true);const data=await personalRequest<DirectPreview>(`${base}/imports/preview`,'POST',{rows});setDirectPreview(data);setRows(data.rows);directCommitKey.current=null;})}>직접 입력 서버 미리보기</button>{directPreview?<p>서버 미리보기: 전체 {directPreview.counts.total}행 · 신규 {directPreview.counts.ready}행 · 중복 건너뜀 {directPreview.counts.skipped}행</p>:<p className="muted">입력을 마친 뒤 서버 미리보기로 오류·중복을 확인하고 전체 저장하세요.</p>}<button className="button" type="button" disabled={pending||!directPreview||Boolean(directPreview.errors.length)} onClick={()=>perform(async()=>{if(!directPreview)return;directCommitKey.current??=crypto.randomUUID();const result=await personalRequest<{created:number;skipped:number}>(`${base}/imports/${directPreview.id}/commit`,'POST',{commitKey:directCommitKey.current,expectedSetRevision:directPreview.setRevision,expectedRevision:directPreview.revision,payloadHash:directPreview.payloadHash});setRows([emptyPersonalRow()]);setDirectPreview(null);setDirectDirty(false);await refresh();setMessage(`저장 ${result.created}개 · 중복 건너뜀 ${result.skipped}개`);})}>직접 입력 전체 저장</button></section><PersonalSentenceImportClient setId={set.id} onSaved={refresh}/></>:null}
  <p role="status" className="notice">{pending?'저장 중…':message}</p><button type="button" className="button-secondary" disabled={pending} onClick={()=>perform(refresh)}>최신 상태 다시 불러오기 (입력 유지)</button>
 </div>;
}
