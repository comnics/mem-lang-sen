> 이 문서는 M0–M3 당시 계약입니다. 일정과 복습의 현재 동작은 [M4 계약](m4-review-scheduling.md)을 참고하세요.

# M0–M3 shared implementation contract

All collaborators share filesystem. Do not revert others' changes. Root owns package/config/auth/db integration/tests setup. Backend owns Prisma schema, seed, domain, services, API routes EXCEPT auth. Learner UI owns root app layout/globals plus (public)/(learner) route groups and shared components. Admin UI owns app/admin and features/admin. APIs return JSON directly, errors {error:string}, no data envelope. DTO dates serialized strings for client.

Root provides:
- src/server/db.ts: `db` PrismaClient singleton, generated import '@/generated/prisma/client'.
- src/server/auth.ts: `getCurrentUser(): Promise<AppUser|null>`, `requireUser(): Promise<AppUser>` throws HttpError401, `requireAdmin(): Promise<AppUser>` throws403. AppUser{id UUID,email,displayName nullable,role USER|ADMIN,status ACTIVE|SUSPENDED,onboarded boolean}.
- src/server/http.ts: `HttpError(status,message)`, `api(handler): (request:Request,context:any)=>Promise<Response>` catches errors and validates Origin on non-GET; agent can use api(async(req,ctx)=>Response.json(...)). ctx params is Promise. `jsonBody(req,schema)` validates bounded JSON with Zod. `requirePageUser(admin?:boolean)` redirects or denies for page layouts.
- src/lib/supabase/server.ts createClient(), client.ts createClient(), admin.ts createAdminClient().
- /api/auth/[action] POST actions signin/signup/signout/forgot/update-password; request {email,password,displayName?}; response {redirectTo?,message?}; signin redirects /admin for admin else /onboarding or /today. confirm /auth/confirm, callback /auth/callback.

Backend agent provides typed services in src/server/services:
- content.ts: listSets(userId?:string), getSet(id,userId?), adminListSets(), adminListSentences(); other internal exports chosen by backend. list DTO: {id,title,description,category,level,sentenceCount,enrolled}; detail add items [{id,prompt,meaning,order}] (NO answers), status on admin DTO. Define exported return types by inference.
- learning.ts: getDashboard(userId), getSession(userId,id), getHistory(userId), getMySentences(userId). getDashboard {enrolledSets,completedSessions,answeredCount,recentSessions}; session public {id,setTitle,mode:'WRITTEN'|'SPOKEN',status,items:[{id,prompt,meaning,position,answered:boolean}], completedCount}; no target/acceptedAnswers/hint in initial payload. history items {id,createdAt,setTitle,mode,correctCount,totalCount,status}. my sentences {id,prompt,meaning,lastResult,lastPracticedAt}. User UI can use inferred data once implementation arrives; coordinate mismatches.

Endpoints (API paths /api/v1):
- GET /sets; GET /sets/[id]
- POST /enrollments {setId}; DELETE /enrollments {setId}
- PUT /study-plan {displayName, dailyMinutes:3|5|10|15|20, timezone, weekdays:number[]} (M3 preference only, scheduler M4); marks onboarded.
- POST /study-sessions {setId,mode:'WRITTEN'|'SPOKEN'} -> {id}; requires enrollment.
- GET /study-sessions/[id] -> session above
- POST /study-sessions/[id]/answers {itemId,eventId(UUID),answer?:string,selfRating?:'AGAIN'|'GOOD'} -> {correct:boolean|null,result:'CORRECT'|'INCORRECT'|'ASSISTED'|'SELF_REPORTED',target,acceptedAnswers,explanation,audioUrl?,completed:boolean}. WRITTEN answer first then comparison. SPOKEN user presses reveal, compares then self-rates. Never convert spoken to written correct.
- POST /study-sessions/[id]/reveals {itemId,kind:'HINT'|'ANSWER'} -> {text,audioUrl?}; persists exposure. Hint means later correct is assisted.
- GET /history; GET /sentences
- GET/POST /admin/sentences; POST input {prompt,meaning,target,acceptedAnswers:string[],hint,explanation,language:'en',level:'A1'|'A2'|'B1',audioAssetId?}. PATCH /admin/sentences/[id] same fields -> creates new immutable version; old sessions preserved.
- GET/POST /admin/sets; POST {title,description,category:'SITUATION'|'PATTERN'|'FUNCTION',level,sentenceVersionIds:string[]}.
- PATCH /admin/sets/[id] updates draft same fields, or {status:'ARCHIVED'}; published edit prohibited; POST /admin/sets/[id]/clone -> new draft.
- POST /admin/sets/[id]/review (moves draft→REVIEW); POST /admin/sets/[id]/publish checks reviewed fields and audio; development seed sample audio available. Admin can publish if valid audio metadata stored.
- POST /admin/imports {csv,commit:boolean} -> {rows:[...],errors:[{row,message}],imported?:number}; parse quoted CSV correctly, all-or-nothing. CSV columns prompt,meaning,target,acceptedAnswers (pipe-separated),hint,explanation,level.
- POST /admin/audio {action:'sign',fileName,contentType,size} -> {id,path,token,signedUrl}; {action:'complete',id} -> {id}; admin UI uploads directly with signedUrl/token via supabase uploadToSignedUrl if needed. Allowed mp3/wav/ogg <=10MB; verify remote storage object metadata at completion. Attach id when creating sentence.

Schema principles: app schema only; immutable SentenceVersion; sets store versions via SetSentence; published sets cannot edited in place; session item stores version and original prompt; unique first answer per item and event key, per-user sentence state. Atomic concurrent answer/reveal via item lock; owned queries. M3 no due scheduler or mastery badges. Tests must prove no target fields in initial session, cross-user forbidden, hints assisted, spoken self-report, duplicate/concurrent submits no double count.

## 최종 DTO 보완

내 문장은 입력 회상/말하기 능력별 기록이다. `id`는 `${sentenceId}:${mode}`인 안정적인 행 키이며 별도 `sentenceId`, `mode`를 포함한다. 표시 문장은 최신 초안이 아니라 그 능력에서 마지막으로 실제 연습한 버전이다. `history.correctCount`는 `CORRECT`만 집계하며 `ASSISTED`와 `SELF_REPORTED`를 제외한다. 말하기 자기확인은 서버에서도 먼저 ANSWER 노출 기록이 있어야 허용한다. 준비된 음원의 서명 발급이 실패하면 503으로 재시도를 알리고 제출 eventId는 유지한다.
