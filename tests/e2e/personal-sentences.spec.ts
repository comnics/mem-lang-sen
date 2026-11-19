import { test,expect,type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
const ids:string[]=[];
const origin=process.env.APP_ORIGIN??'http://127.0.0.1:3100';
if(new URL(origin).hostname!=='127.0.0.1'||!process.env.DIRECT_URL||!['localhost','127.0.0.1'].includes(new URL(process.env.DIRECT_URL).hostname))throw new Error('Personal E2E requires disposable LOCAL Supabase.');
async function login(page:Page,email='learner@example.test'){
 await page.goto('/login');await page.getByLabel('이메일',{exact:true}).fill(email);await page.getByLabel('비밀번호',{exact:true}).fill('LocalStudy!2026');await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).toHaveURL(/\/(today|admin|onboarding)$/);
 if(page.url().endsWith('/onboarding')){await page.getByLabel('표시 이름').fill('개인 문장 학습자');await page.getByRole('button',{name:'오늘 학습으로 이동'}).click();}
}
async function makeSet(page:Page){await page.goto('/sentences');await page.getByRole('link',{name:'직접 만든 문장',exact:true}).click();await page.getByLabel('새 개인 세트 이름').fill(`개인 문장 E2E ${randomUUID()}`);await page.getByRole('button',{name:'개인 세트 만들기'}).click();await expect(page).toHaveURL(/\/sentences\/personal\/[^/]+$/);const id=new URL(page.url()).pathname.split('/').at(-1)!;ids.push(id);return id;}
function direct(page:Page){return page.locator('section').filter({has:page.getByRole('heading',{name:'문장 직접 입력',exact:true})});}
function importer(page:Page){return page.locator('section').filter({has:page.getByRole('heading',{name:'XLSX / TXT 가져오기',exact:true})});}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}
test.afterAll(async()=>{
 if(!ids.length)return;const db=new Client({connectionString:process.env.DIRECT_URL});await db.connect();
 try{const {rows}=await db.query<{id:string}>('SELECT DISTINCT v."sentenceId" AS id FROM app."SetSentence" m JOIN app."SentenceVersion" v ON v.id=m."sentenceVersionId" WHERE m."setId"=ANY($1::text[])',[ids]);const sentences=rows.map(r=>r.id);
 await db.query('DELETE FROM app."PersonalSentenceImport" WHERE "setId"=ANY($1::text[])',[ids]);
 // Fixture teardown only. Production archive never deletes sessions or history.
 await db.query('DELETE FROM app."StudySession" WHERE "setId"=ANY($1::text[])',[ids]);
 await db.query('DELETE FROM app."AssessmentCohort" WHERE "sentenceId"=ANY($1::text[])',[sentences]);
 await db.query('DELETE FROM app."UserSentenceState" WHERE "sentenceId"=ANY($1::text[])',[sentences]);
 await db.query('DELETE FROM app."UserSentencePreference" WHERE "sentenceId"=ANY($1::text[])',[sentences]);
 await db.query('DELETE FROM app."SetSentence" WHERE "setId"=ANY($1::text[])',[ids]);
 await db.query('DELETE FROM app."StudySet" WHERE id=ANY($1::text[])',[ids]);
 await db.query('DELETE FROM app."SentenceVersion" WHERE "sentenceId"=ANY($1::text[])',[sentences]);await db.query('DELETE FROM app."Sentence" WHERE id=ANY($1::text[])',[sentences]);
 }finally{await db.end();}
});
test('360px direct multi-input → saved edit → existing recall → records; ADMIN isolation and CSRF',async({page,browser})=>{
 await login(page);const id=await makeSet(page);const form=direct(page);
 await form.getByLabel('한국어 질문/상황 (필수)').fill('처음 인사한다');await form.getByLabel('영어 정답 (필수)').fill('Hello there!');await form.getByRole('button',{name:'행 추가',exact:true}).click();await form.getByLabel('한국어 질문/상황 (필수)').nth(1).fill('작별 인사한다');await form.getByLabel('영어 정답 (필수)').nth(1).fill('See you soon.');await form.getByRole('button',{name:'직접 입력 서버 미리보기'}).click();await form.getByRole('button',{name:'직접 입력 전체 저장'}).click();await expect(page.getByText('저장 2개 · 중복 건너뜀 0개',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'정답을 보고 저장 문장 편집 열기'}).click();await page.getByRole('button',{name:'문장 수정',exact:true}).first().click();const edited=page.locator('article').filter({has:page.getByRole('heading',{name:'처음 인사한다',exact:true})});await edited.getByLabel('영어 정답 (필수)').fill('Hello again!');await edited.getByRole('button',{name:'새 버전 저장'}).click();await expect(edited.getByText('Hello again!',{exact:true})).toBeVisible();await noOverflow(page);
 const token=await (await page.request.get('/api/v1/personal-csrf')).json();expect((await page.request.post('/api/v1/personal-sets',{data:{title:'csrf blocked'}})).status()).toBe(403);expect((await page.request.post('/api/v1/personal-sets',{headers:{'x-personal-csrf':token.token},data:{title:'injected',ownerId:randomUUID()}})).status()).toBe(400);
 const other=await browser.newContext();const admin=await other.newPage();await login(admin,'admin@example.test');expect((await admin.request.get(`/api/v1/personal-sets/${id}`)).status()).toBe(404);const listed=await (await admin.request.get('/api/v1/admin/sentences')).json();expect(JSON.stringify(listed)).not.toContain('Hello again!');await other.close();
 await page.getByRole('button',{name:'내 세트로 등록',exact:true}).click();await page.getByRole('button',{name:'입력 회상',exact:true}).click();await expect(page).toHaveURL(/\/study\//);expect(await page.content()).not.toContain('Hello again!');await expect(page.getByText('개인 문장 · 음원 없이 텍스트로 비교합니다.')).toBeVisible();await page.getByLabel('내가 떠올린 영어 문장').fill('Hello again!');await page.getByRole('button',{name:'제출',exact:true}).click();await expect(page.getByText('Hello again!',{exact:true})).toBeVisible();await page.goto('/sentences');await expect(page.getByRole('heading',{name:'처음 인사한다',exact:true})).toBeVisible();
});
test('TXT English lines → missing-question errors → preview edit/revalidate → atomic save → archive/restore',async({page})=>{
 await login(page);await makeSet(page);const section=importer(page);await section.getByLabel('파일 선택').setInputFiles({name:'lines.txt',mimeType:'text/plain',buffer:Buffer.from('Can I get a receipt?\nCould I have some water?\n')});await section.getByRole('button',{name:'파일 미리보기'}).click();await expect(section.getByRole('alert')).toBeVisible();await expect(section.getByRole('button',{name:'미리보기 전체 저장'})).toBeDisabled();await section.getByLabel('한국어 질문/상황 (필수)').nth(0).fill('영수증을 요청한다');await section.getByLabel('한국어 질문/상황 (필수)').nth(1).fill('물을 부탁한다');await section.getByRole('button',{name:'수정 내용 서버 재검증'}).click();await expect(section.getByRole('button',{name:'미리보기 전체 저장'})).toBeEnabled();await noOverflow(page);await section.getByRole('button',{name:'미리보기 전체 저장'}).click();await expect(section.getByText('저장 2개 · 중복 건너뜀 0개',{exact:true})).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'세트 보관',exact:true}).click();await expect(page.getByRole('button',{name:'세트 복구',exact:true})).toBeVisible();await page.getByRole('button',{name:'세트 복구',exact:true}).click();await expect(page.getByText('영수증을 요청한다',{exact:false}).first()).toBeVisible();await noOverflow(page);
});
test('real XLSX template → editable preview → all saved → text-only spoken practice',async({page})=>{
 await login(page);await makeSet(page);const section=importer(page);await section.getByLabel('파일 선택').setInputFiles('public/templates/personal-sentences.xlsx');await section.getByRole('button',{name:'파일 미리보기'}).click();await expect(section.getByLabel('영어 정답 (필수)').first()).toHaveValue('Can I get a receipt?');await section.getByLabel('한국어 질문/상황 (필수)').first().fill('レシート・영수증 요청');await section.getByRole('button',{name:'수정 내용 서버 재검증'}).click();await section.getByRole('button',{name:'미리보기 전체 저장'}).click();await expect(section.getByText('저장 2개 · 중복 건너뜀 0개',{exact:true})).toBeVisible();await page.getByRole('button',{name:'내 세트로 등록',exact:true}).click();await page.getByRole('button',{name:'말하기 자기확인',exact:true}).click();await expect(page).toHaveURL(/\/study\//);await expect(page.getByText('レシート・영수증 요청',{exact:true})).toBeVisible();await noOverflow(page);
});
