import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { gradeWrittenAnswer } from '@/domain/grading';
import { computeReview, REVIEW_POLICY_VERSION } from '@/domain/review';
import { localDate } from '@/domain/scheduling';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';
import { signedAudioUrl } from './content';
import { isDailySessionUsable } from './daily-session';

export { getStudyPlan, updateStudyPlan } from './scheduling';

type StudyMode = 'WRITTEN' | 'SPOKEN';
type ReviewResult = 'CORRECT' | 'INCORRECT' | 'ASSISTED' | 'SELF_REPORTED';
type SelfRating = 'AGAIN' | 'GOOD';

export async function getDashboard(userId: string) {
  const [enrolledSets, completedSessions, answeredCount, recentSessions] = await Promise.all([
    db.enrollment.count({ where: { userId } }),
    db.studySession.count({ where: { userId, status: 'COMPLETED' } }),
    db.reviewEvent.count({ where: { userId } }),
    db.studySession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { set: true, items: { include: { reviewEvent: true } } },
    }),
  ]);

  return {
    enrolledSets,
    completedSessions,
    answeredCount,
    recentSessions: recentSessions.map(historyDto),
  };
}

export async function getHistory(userId: string) {
  const sessions = await db.studySession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { set: true, items: { include: { reviewEvent: true } } },
  });
  return sessions.map(historyDto);
}

export async function getMySentences(userId: string) {
  const [states, events] = await Promise.all([
    db.userSentenceState.findMany({
      where: { userId },
      orderBy: { lastPracticedAt: 'desc' },
    }),
    db.reviewEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { item: { include: { session: true, sentenceVersion: true } } },
    }),
  ]);
  const practicedVersionByState = new Map<string, { prompt: string; meaning: string }>();
  for (const event of events) {
    const key = sentenceStateKey(event.item.sentenceId, event.item.session.mode);
    if (!practicedVersionByState.has(key)) {
      practicedVersionByState.set(key, {
        prompt: event.item.sentenceVersion.prompt,
        meaning: event.item.sentenceVersion.meaning,
      });
    }
  }
  return states.map((state) => {
    const version = practicedVersionByState.get(sentenceStateKey(state.sentenceId, state.mode));
    return {
      id: sentenceStateKey(state.sentenceId, state.mode),
      sentenceId: state.sentenceId,
      mode: state.mode,
      prompt: version?.prompt ?? '',
      meaning: version?.meaning ?? '',
      lastResult: state.lastResult,
      lastPracticedAt: state.lastPracticedAt.toISOString(),
      dueAt: state.dueAt?.toISOString() ?? null,
      reviewStep: state.reviewStep,
      qualifiedRecallCount: state.qualifiedRecallCount,
    };
  });
}

export async function enrollSet(userId: string, setId: string) {
  const set = await db.studySet.findFirst({ where: { id: setId, status: 'PUBLISHED' } });
  if (!set) throw new HttpError(404, '발행된 세트를 찾을 수 없습니다.');
  return db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      return tx.enrollment.upsert({
        where: { userId_setId: { userId, setId } },
        update: {},
        create: { userId, setId },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

export async function unenrollSet(userId: string, setId: string) {
  await db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      await tx.enrollment.deleteMany({ where: { userId, setId } });
      await tx.studySession.updateMany({ where: { userId, purpose: 'DAILY', status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  return { ok: true };
}

export async function setEnrollmentPaused(userId: string, setId: string, paused: boolean) {
  return db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      const result = await tx.enrollment.updateMany({ where: { userId, setId }, data: { paused } });
      if (result.count === 0) throw new HttpError(404, '선택한 세트 등록을 찾을 수 없습니다.');
      if (paused) await tx.studySession.updateMany({ where: { userId, purpose: 'DAILY', status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
      return { ok: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

export async function createStudySession(userId: string, input: { setId: string; mode: StudyMode }, now?: Date) {
  const session = await db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      const createdAt = now ?? new Date();
      const plan = await tx.studyPlan.findUnique({ where: { userId }, select: { timezone: true } });
      const timezone = plan?.timezone ?? 'Asia/Seoul';
      const studyDate = localDate(createdAt, timezone);
      const enrollment = await tx.enrollment.findUnique({
        where: { userId_setId: { userId, setId: input.setId } },
        include: {
          set: {
            include: {
              sentences: {
                orderBy: { order: 'asc' },
                include: { sentenceVersion: true },
              },
            },
          },
        },
      });
      if (!enrollment || enrollment.set.status !== 'PUBLISHED') throw new HttpError(403, '선택한 세트만 학습할 수 있습니다.');
      if (enrollment.set.sentences.length === 0) throw new HttpError(400, '학습할 문장이 없습니다.');

      return tx.studySession.create({
        data: {
          userId,
          setId: input.setId,
          purpose: 'PRACTICE',
          studyDate,
          timezone,
          mode: input.mode,
          createdAt,
          items: {
            create: enrollment.set.sentences.map((item, index) => ({
              sentenceVersionId: item.sentenceVersionId,
              sentenceId: item.sentenceVersion.sentenceId,
              prompt: item.sentenceVersion.prompt,
              meaning: item.sentenceVersion.meaning,
              position: index + 1,
            })),
          },
        },
        select: { id: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  return { id: session.id };
}

export async function getSession(userId: string, id: string, now = new Date()) {
  const session = await db.studySession.findFirst({
    where: { id, userId },
    include: {
      set: true,
      items: { orderBy: { position: 'asc' }, include: { reviewEvent: true } },
    },
  });
  if (!session) throw new HttpError(404, '학습 세션을 찾을 수 없습니다.');
  const usable = session.status !== 'ACTIVE' || await isDailySessionUsable(db, userId, session, session.items.filter((item) => !item.reviewEvent).map((item) => item.sentenceId), now);
  return {
    id: session.id,
    setTitle: session.set?.title ?? '오늘 복습',
    mode: session.mode,
    status: usable ? session.status : 'ABANDONED',
    studyDate: session.studyDate,
    timezone: session.timezone,
    items: session.items.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      meaning: item.meaning,
      position: item.position,
      answered: Boolean(item.reviewEvent),
    })),
    completedCount: session.items.filter((item) => item.reviewEvent).length,
  };
}

export async function revealSessionItem(
  userId: string,
  sessionId: string,
  input: { itemId: string; kind: 'HINT' | 'ANSWER' },
  now?: Date,
) {
  const result = await db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      await lockOwnedSession(tx, userId, sessionId);
      const exposedAt = now ?? new Date();
      const item = await tx.sessionItem.findFirst({
        where: { id: input.itemId, sessionId },
        include: { session: true, sentenceVersion: { include: { audioAsset: true } } },
      });
      if (!item) throw new HttpError(404, '문항을 찾을 수 없습니다.');
      if (item.session.status === 'ABANDONED' || !await isDailySessionUsable(tx, userId, item.session, [item.sentenceId], exposedAt)) throw new HttpError(409, '만료된 학습 세션입니다. 오늘 화면에서 다시 시작해 주세요.');

      const text = input.kind === 'HINT' ? item.sentenceVersion.hint : item.sentenceVersion.target;
      await tx.exposureEvent.create({ data: { userId, sessionItemId: item.id, kind: input.kind, text, createdAt: exposedAt } });
      await upsertLastExposureAt(tx, userId, item.sentenceId, exposedAt);
      return {
        text,
        audioPath:
          input.kind === 'ANSWER' && item.sentenceVersion.audioAsset?.status === 'READY'
            ? item.sentenceVersion.audioAsset.path
            : undefined,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  const audioUrl = result.audioPath ? await signedAudioUrl(result.audioPath) : undefined;
  return { text: result.text, audioUrl };
}

export async function answerSessionItem(
  userId: string,
  sessionId: string,
  input: { itemId: string; eventId: string; answer?: string; selfRating?: SelfRating; hard?: boolean },
  now?: Date,
) {
  const result = await db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      await lockOwnedSession(tx, userId, sessionId);
      const performedAt = now ?? new Date();

      const existing = await tx.reviewEvent.findUnique({
        where: { userId_eventId: { userId, eventId: input.eventId } },
        include: { item: { include: { session: true, sentenceVersion: { include: { audioAsset: true } } } } },
      });
      if (existing) {
        if (existing.item.sessionId !== sessionId || existing.sessionItemId !== input.itemId) {
          throw new HttpError(409, '같은 eventId가 다른 제출에 사용되었습니다.');
        }
        assertSameReplay(existing, input);
        const completed = await isSessionCompletedTx(tx, existing.item.sessionId);
        return answerDto(existing, existing.item.sentenceVersion, completed);
      }

      const item = await tx.sessionItem.findFirst({
        where: { id: input.itemId, sessionId },
        include: {
          session: true,
          sentenceVersion: { include: { audioAsset: true } },
          exposures: true,
          reviewEvent: true,
        },
      });
      if (!item) throw new HttpError(404, '문항을 찾을 수 없습니다.');
      if (item.session.status === 'ABANDONED' || !await isDailySessionUsable(tx, userId, item.session, [item.sentenceId], performedAt)) throw new HttpError(409, '만료된 학습 세션입니다. 오늘 화면에서 다시 시작해 주세요.');
      if (item.reviewEvent) throw new HttpError(409, '이미 제출된 문항입니다.');

      const previousState = await tx.userSentenceState.findUnique({
        where: { userId_sentenceId_mode: { userId, sentenceId: item.sentenceId, mode: item.session.mode } },
      });
      const preference = await tx.userSentencePreference.findUnique({
        where: { userId_sentenceId: { userId, sentenceId: item.sentenceId } },
      });

      if (item.session.mode === 'SPOKEN' && !item.exposures.some((event) => event.kind === 'ANSWER')) {
        throw new HttpError(400, '답을 열어 비교한 뒤 말하기 자기확인을 남겨 주세요.');
      }
      const assisted = item.exposures.some((event) => event.kind === 'HINT' || event.kind === 'ANSWER');
      const grading =
        item.session.mode === 'WRITTEN'
          ? gradeWrittenInput(input.answer, item.sentenceVersion.acceptedAnswers, assisted)
          : gradeSpokenInput(input.selfRating);
      const review = computeReview({
        now: performedAt,
        mode: item.session.mode,
        result: grading.result,
        selfRating: input.selfRating,
        hard: input.hard ?? false,
        previous: previousState
          ? {
              reviewStep: previousState.reviewStep,
              dueAt: previousState.dueAt,
              qualifiedRecallCount: previousState.qualifiedRecallCount,
              lastQualifiedAt: previousState.lastQualifiedAt,
            }
          : null,
        lastExposureAt: preference?.lastExposedAt ?? null,
      });
      const timezone = await currentTimezone(tx, userId);
      const studyDate = localDate(performedAt, timezone);

      const event = await tx.reviewEvent.create({
        data: {
          userId,
          sessionItemId: item.id,
          eventId: input.eventId,
          answer: input.answer,
          selfRating: input.selfRating,
          result: grading.result,
          correct: grading.correct,
          assisted,
          hard: input.hard ?? false,
          qualified: review.qualified,
          policyVersion: REVIEW_POLICY_VERSION,
          reviewStep: review.reviewStep,
          reviewReason: review.reason,
          dueAt: item.dueAt ?? previousState?.dueAt ?? null,
          scheduledAt: item.scheduledAt,
          nextDueAt: review.dueAt,
          performedAt,
          studyDate,
          timezone,
          createdAt: performedAt,
          targetSnapshot: item.sentenceVersion.target,
          acceptedAnswers: item.sentenceVersion.acceptedAnswers,
          explanation: item.sentenceVersion.explanation,
        },
      });

      await updateSentenceState(tx, userId, item.sentenceId, item.session.mode, grading.result, review, performedAt, input.selfRating);
      await upsertLastExposureAt(tx, userId, item.sentenceId, performedAt);

      const remaining = await tx.sessionItem.count({ where: { sessionId, reviewEvent: null } });
      const completed = remaining === 0;
      if (completed) await tx.studySession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });

      return answerDto(event, item.sentenceVersion, completed);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  return withSignedAudio(result);
}

function gradeWrittenInput(answer: string | undefined, acceptedAnswers: string[], assisted: boolean) {
  if (!answer) throw new HttpError(400, '답안을 입력해 주세요.');
  const grade = gradeWrittenAnswer(answer, acceptedAnswers);
  if (!grade.correct) return { correct: false, result: 'INCORRECT' as const };
  return { correct: true, result: assisted ? ('ASSISTED' as const) : ('CORRECT' as const) };
}

function gradeSpokenInput(selfRating: SelfRating | undefined) {
  if (!selfRating) throw new HttpError(400, '말하기 학습은 자기평가가 필요합니다.');
  return { correct: null, result: 'SELF_REPORTED' as const };
}

async function updateSentenceState(
  tx: Prisma.TransactionClient,
  userId: string,
  sentenceId: string,
  mode: StudyMode,
  result: ReviewResult,
  review: {
    reviewStep: number;
    dueAt: Date;
    qualifiedRecallCount: number;
    lastQualifiedAt: Date | null;
  },
  now: Date,
  selfRating?: SelfRating,
) {
  const selfReportedGoodIncrement = result === 'SELF_REPORTED' && selfRating === 'GOOD' ? 1 : 0;
  await tx.userSentenceState.upsert({
    where: { userId_sentenceId_mode: { userId, sentenceId, mode } },
    create: {
      userId,
      sentenceId,
      mode,
      lastResult: result,
      lastPracticedAt: now,
      correctCount: result === 'CORRECT' ? 1 : 0,
      incorrectCount: result === 'INCORRECT' ? 1 : 0,
      assistedCount: result === 'ASSISTED' ? 1 : 0,
      selfReportedGood: selfReportedGoodIncrement,
      policyVersion: REVIEW_POLICY_VERSION,
      reviewStep: review.reviewStep,
      dueAt: review.dueAt,
      qualifiedRecallCount: review.qualifiedRecallCount,
      lastQualifiedAt: review.lastQualifiedAt,
    },
    update: {
      lastResult: result,
      lastPracticedAt: now,
      version: { increment: 1 },
      policyVersion: REVIEW_POLICY_VERSION,
      reviewStep: review.reviewStep,
      dueAt: review.dueAt,
      qualifiedRecallCount: review.qualifiedRecallCount,
      lastQualifiedAt: review.lastQualifiedAt,
      correctCount: result === 'CORRECT' ? { increment: 1 } : undefined,
      incorrectCount: result === 'INCORRECT' ? { increment: 1 } : undefined,
      assistedCount: result === 'ASSISTED' ? { increment: 1 } : undefined,
      selfReportedGood: selfReportedGoodIncrement ? { increment: 1 } : undefined,
    },
  });
}

async function upsertLastExposureAt(tx: Prisma.TransactionClient, userId: string, sentenceId: string, lastExposedAt: Date) {
  await tx.$executeRaw`
    INSERT INTO app."UserSentencePreference" AS preference ("userId", "sentenceId", "lastExposedAt", "createdAt", "updatedAt")
    VALUES (${userId}::uuid, ${sentenceId}, ${lastExposedAt}, ${lastExposedAt}, ${lastExposedAt})
    ON CONFLICT ("userId", "sentenceId") DO UPDATE
    SET
      "lastExposedAt" = GREATEST(
        COALESCE(preference."lastExposedAt", EXCLUDED."lastExposedAt"),
        EXCLUDED."lastExposedAt"
      ),
      "updatedAt" = CASE
        WHEN preference."lastExposedAt" IS NULL
          OR EXCLUDED."lastExposedAt" > preference."lastExposedAt"
        THEN EXCLUDED."lastExposedAt"
        ELSE preference."updatedAt"
      END
  `;
}

async function currentTimezone(tx: Prisma.TransactionClient, userId: string) {
  const plan = await tx.studyPlan.findUnique({ where: { userId }, select: { timezone: true } });
  return plan?.timezone ?? 'Asia/Seoul';
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM app."AppUser"
    WHERE id = ${userId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) throw new HttpError(401, '로그인이 필요합니다.');
}

async function lockOwnedSession(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM app."StudySession"
    WHERE id = ${sessionId} AND "userId" = ${userId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) throw new HttpError(404, '학습 세션을 찾을 수 없습니다.');
}

async function isSessionCompletedTx(tx: Prisma.TransactionClient, sessionId: string) {
  const remaining = await tx.sessionItem.count({ where: { sessionId, reviewEvent: null } });
  return remaining === 0;
}

function answerDto(
  event: {
    answer?: string | null;
    selfRating?: SelfRating | null;
    correct: boolean | null;
    result: ReviewResult;
    targetSnapshot: string;
    acceptedAnswers: string[];
    explanation: string;
    qualified?: boolean | null;
    reviewStep?: number | null;
    reviewReason?: string | null;
    nextDueAt?: Date | null;
  },
  version: { audioAsset?: { status: 'PENDING' | 'READY'; path: string } | null },
  completed: boolean,
) {
  return {
    correct: event.correct,
    result: event.result,
    target: event.targetSnapshot,
    acceptedAnswers: event.acceptedAnswers,
    explanation: event.explanation,
    nextDueAt: event.nextDueAt?.toISOString() ?? null,
    qualified: event.qualified ?? false,
    reviewStep: event.reviewStep ?? 0,
    reviewReason: event.reviewReason ?? null,
    audioPath: version.audioAsset?.status === 'READY' ? version.audioAsset.path : undefined,
    completed,
  };
}

async function withSignedAudio<T extends { audioPath?: string }>(result: T) {
  const audioUrl = result.audioPath ? await signedAudioUrl(result.audioPath) : undefined;
  const response = { ...result };
  delete response.audioPath;
  return { ...response, audioUrl };
}

function assertSameReplay(
  existing: { answer?: string | null; selfRating?: SelfRating | null; hard?: boolean | null },
  input: { answer?: string; selfRating?: SelfRating; hard?: boolean },
) {
  if (
    (existing.answer ?? undefined) !== (input.answer ?? undefined) ||
    (existing.selfRating ?? undefined) !== (input.selfRating ?? undefined) ||
    (existing.hard ?? false) !== (input.hard ?? false)
  ) {
    throw new HttpError(409, '같은 eventId가 다른 제출 내용으로 재사용되었습니다.');
  }
}

function historyDto(session: {
  id: string;
  createdAt: Date;
  mode: StudyMode;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  set: { title: string } | null;
  studyDate?: string | null;
  timezone?: string | null;
  items: { reviewEvent: { correct: boolean | null; result: string; studyDate?: string | null; timezone?: string | null } | null }[];
}) {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    setTitle: session.set?.title ?? '오늘 복습',
    mode: session.mode,
    correctCount: session.items.filter((item) => item.reviewEvent?.result === 'CORRECT').length,
    answeredCount: session.items.filter((item) => item.reviewEvent).length,
    totalCount: session.items.length,
    status: session.status,
    studyDate: session.studyDate ?? session.items.find((item) => item.reviewEvent?.studyDate)?.reviewEvent?.studyDate ?? null,
    timezone: session.timezone ?? session.items.find((item) => item.reviewEvent?.timezone)?.reviewEvent?.timezone ?? null,
  };
}

function sentenceStateKey(sentenceId: string, mode: StudyMode) {
  return `${sentenceId}:${mode}`;
}
