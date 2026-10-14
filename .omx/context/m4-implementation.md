# M4 execution contract
Scope: approved M4 from plans. No push/Cron/PWA/mastery assessments (M5+). Direct native-agent work, no OMX CLI runtime mode activated.
Root owns schema/migration/server services/routes, integration, E2E, docs. Engine executor owns pure domain review/scheduling + unit tests. UI executor owns learner UI only. Review signoff later.

Policy: relative-v1, intervals1/3/7/14/30 days after qualified recall, initial success1day. >=24h latest cross-mode exposure + due required for delayed written qualification. Early practice no advancement. Hard keeps stage. Assisted/wrong resets1day. Spoken independently scheduled, never qualified. Old M3 history retained and conservatively migrated (stage0; due lastpractice+1day; exposure max known event).

Schedule: weekdays OR anchored everyNlocaldays (1..30), startDate, optional informational targetDate, localTime, IANA timezone, ADD/SKIP exceptions <=100 unique dates. Paused global; enrollmentpaused per-set. Exceptions override recurrence afterstart. DueUTC separate allocatedscheduledUTC separate actualperformedUTC and actual localdate/timezone snapshot. No retroactive changes to old snapshots.

GET /api/v1/today?mode=WRITTEN|SPOKEN -> TodayQueueDTO (src/domain/m4-types.ts).
POST /api/v1/today {mode} -> {id}, server selects queue only, locksAppUser and reuses active same-day same-mode session. Mixedsets session.setId null, purpose DAILY; normal set sessions PRACTICE. Older unfinished DAILY sessions expire (ABANDONED) when next issued; reject new submission to expired session. No browser accepted clock/date.
PUT /api/v1/study-plan existing fields + optional ruleType,intervalDays,anchorDate,startDate,targetDate,localTime,paused,exceptions. Full returned plan via getStudyPlan includes these.
PATCH /api/v1/enrollments {setId,paused:boolean}; enrolledset DTO adds paused.
Answer input adds hard?:boolean; result adds nextDueAt:string|null,reviewStep,qualified,reviewReason. Events persist these snapshots so replay exact.
Queue budget: estimated review30s/new60s; sum actual today events + reserved pending DAILY items across modes. Reviews earliestdue first; new usesremaining budget; recovery after>=7days away cap3min for whole returnlocalday. Active shared sentence only once per mode; no new SPOKEN automatically until practiced? Both modes allow new via own mode choice, separate states but exposures shared. Upcoming calendar14days shows allowed dates, current due assignments, real completioncounts; not future memory predictions.
