import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

config({ path: '.env.local', quiet: true });

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://audio.test/${path}` }, error: null }),
      }),
    },
  }),
}));

type Db = typeof import('@/server/db')['db'];
type ContentServices = typeof import('@/server/services/content');
type LearningServices = typeof import('@/server/services/learning');

let db: Db;
let content: ContentServices;
let learning: LearningServices;

const runId = randomUUID();
const emailDomain = `${runId}.integration.test`;
const createdUserIds = new Set<string>();
const createdSetIds = new Set<string>();
const createdSentenceIds = new Set<string>();
const createdAudioAssetIds = new Set<string>();

describe('backend service integration', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required. Run pnpm local:setup before integration tests.');
    const hostname = new URL(databaseUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(hostname)) {
      throw new Error(`Refusing to run integration tests against non-local database host: ${hostname}`);
    }

    ({ db } = await import('@/server/db'));
    content = await import('@/server/services/content');
    learning = await import('@/server/services/learning');
    await db.$queryRaw`select 1`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.appUser.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    await db.setSentence.deleteMany({ where: { setId: { in: [...createdSetIds] } } });
    await db.studySet.deleteMany({ where: { id: { in: [...createdSetIds] } } });
    await db.sentenceVersion.deleteMany({ where: { sentenceId: { in: [...createdSentenceIds] } } });
    await db.sentence.deleteMany({ where: { id: { in: [...createdSentenceIds] } } });
    await db.audioAsset.deleteMany({ where: { id: { in: [...createdAudioAssetIds] } } });
    await db.$disconnect();
  });

  it('uses a non-DDL runtime role and denies Data API roles access to app schema', async () => {
    const roles = await db.$queryRaw<{ current_user: string; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean; can_create: boolean; anon_usage: boolean; authenticated_usage: boolean }[]>`
      SELECT current_user, rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,
      has_schema_privilege(current_user,'app','CREATE') AS can_create,
      has_schema_privilege('anon','app','USAGE') AS anon_usage,
      has_schema_privilege('authenticated','app','USAGE') AS authenticated_usage
      FROM pg_roles WHERE rolname=current_user
    `;
    expect(roles[0]).toEqual({ current_user: 'app_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, can_create: false, anon_usage: false, authenticated_usage: false });
  });

  it('does not import any CSV rows when one committed row is invalid', async () => {
    const marker = `rollback-${runId}`;
    const csv = [
      'prompt,meaning,target,acceptedAnswers,hint,explanation,level',
      `${marker}-valid,Meaning,Target one,Target one,Hint,Explanation,A1`,
      `${marker}-invalid,Meaning,Target two,Target two,Hint,Explanation,C2`,
    ].join('\n');

    const result = await content.importSentences(csv, true);
    const imported = await db.sentenceVersion.count({ where: { prompt: { startsWith: marker } } });

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(imported).toBe(0);
  });

  it('rejects publishing reviewed sets when a sentence has no ready audio', async () => {
    const sentence = await content.adminCreateSentence(sentenceInput('publish-without-audio'));
    trackSentence(sentence.sentenceId);
    const set = await content.adminCreateSet(setInput('publish-without-audio', [sentence.id]));
    trackSet(set.id);
    await content.adminReviewSet(set.id);

    await expect(content.adminPublishSet(set.id)).rejects.toMatchObject({ status: 400 });
    await expect(db.studySet.findUniqueOrThrow({ where: { id: set.id } })).resolves.toMatchObject({ status: 'REVIEW' });
  });

  it('creates a new sentence version when an existing sentence is edited', async () => {
    const audio = await createReadyAudio('immutable-edit-v1');
    const sentence = await content.adminCreateSentence(sentenceInput('immutable-edit-v1', audio.id));
    trackSentence(sentence.sentenceId);
    const nextAudio = await createReadyAudio('immutable-edit-v2');

    const updated = await content.adminUpdateSentence(sentence.id, {
      ...sentenceInput('immutable-edit-v2', nextAudio.id),
      target: 'Updated immutable target.',
      acceptedAnswers: ['Updated immutable target.'],
    });
    const original = await db.sentenceVersion.findUniqueOrThrow({ where: { id: sentence.id } });

    expect(updated.id).not.toBe(sentence.id);
    expect(updated.sentenceId).toBe(sentence.sentenceId);
    expect(updated.versionNumber).toBe(sentence.versionNumber + 1);
    expect(original.target).toBe(sentence.target);
  });

  it('reports shared sentence counts per published set', async () => {
    const audio = await createReadyAudio('shared-counts');
    const sentence = await content.adminCreateSentence(sentenceInput('shared-counts', audio.id));
    trackSentence(sentence.sentenceId);
    const firstSet = await publishSet('shared-counts-one', [sentence.id]);
    const secondSet = await publishSet('shared-counts-two', [sentence.id]);

    const sets = await content.listSets();
    const counts = new Map(sets.filter((set) => [firstSet.id, secondSet.id].includes(set.id)).map((set) => [set.id, set.sentenceCount]));

    expect(counts).toEqual(
      new Map([
        [firstSet.id, 1],
        [secondSet.id, 1],
      ]),
    );
  });

  it('hides answer fields from set and session DTOs', async () => {
    const user = await createUser('hide-answer');
    const audio = await createReadyAudio('hide-answer');
    const sentence = await content.adminCreateSentence(sentenceInput('hide-answer', audio.id));
    trackSentence(sentence.sentenceId);
    const set = await publishSet('hide-answer', [sentence.id]);
    await learning.enrollSet(user.id, set.id);
    const session = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });

    const setDto = await content.getSet(set.id, user.id);
    const sessionDto = await learning.getSession(user.id, session.id);

    expect(setDto.items[0]).not.toHaveProperty('target');
    expect(setDto.items[0]).not.toHaveProperty('acceptedAnswers');
    expect(sessionDto.items[0]).not.toHaveProperty('target');
    expect(sessionDto.items[0]).not.toHaveProperty('acceptedAnswers');
  });

  it('denies session reads from users who do not own the session', async () => {
    const owner = await createUser('owner');
    const other = await createUser('other');
    const { set } = await createPublishedLearningSet('owned-read');
    await learning.enrollSet(owner.id, set.id);
    const session = await learning.createStudySession(owner.id, { setId: set.id, mode: 'WRITTEN' });

    await expect(learning.getSession(other.id, session.id)).rejects.toMatchObject({ status: 404 });
  });

  it('returns the first answer result when the same event and payload are submitted again', async () => {
    const user = await createUser('idempotent');
    const { set } = await createPublishedLearningSet('idempotent');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;
    const eventId = randomUUID();

    const first = await learning.answerSessionItem(user.id, sessionId, { itemId, eventId, answer: 'Integration target idempotent.' });
    const second = await learning.answerSessionItem(user.id, sessionId, { itemId, eventId, answer: 'Integration target idempotent.' });

    expect(second).toEqual(first);
  });

  it('returns the first answer result when identical simultaneous submits use the same event', async () => {
    const user = await createUser('same-event-race');
    const { set } = await createPublishedLearningSet('same-event-race');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;
    const eventId = randomUUID();

    const results = await Promise.allSettled([
      learning.answerSessionItem(user.id, sessionId, { itemId, eventId, answer: 'Integration target same-event-race.' }),
      learning.answerSessionItem(user.id, sessionId, { itemId, eventId, answer: 'Integration target same-event-race.' }),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(results[1]).toEqual(results[0]);
  });

  it('rejects a replayed event when the answer payload changes', async () => {
    const user = await createUser('changed-replay');
    const { set } = await createPublishedLearningSet('changed-replay');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;
    const eventId = randomUUID();

    await learning.answerSessionItem(user.id, sessionId, { itemId, eventId, answer: 'Integration target changed-replay.' });

    await expect(
      learning.answerSessionItem(user.id, sessionId, { itemId, eventId, answer: 'A changed retry payload.' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects one answer with 409 when different events race for one item', async () => {
    const user = await createUser('different-event-race');
    const { set } = await createPublishedLearningSet('different-event-race');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;

    const results = await Promise.allSettled([
      learning.answerSessionItem(user.id, sessionId, { itemId, eventId: randomUUID(), answer: 'Integration target different-event-race.' }),
      learning.answerSessionItem(user.id, sessionId, { itemId, eventId: randomUUID(), answer: 'Integration target different-event-race.' }),
    ]);
    const persisted = await db.reviewEvent.count({ where: { sessionItemId: itemId } });
    const rejected = results.find((result) => result.status === 'rejected');

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toMatchObject({ reason: { status: 409 } });
    expect(persisted).toBe(1);
  });

  it('completes a session when concurrent answers cover different items', async () => {
    const user = await createUser('different-items');
    const { set } = await createPublishedLearningSet('different-items', ['different-items-one', 'different-items-two']);
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const items = (await learning.getSession(user.id, sessionId)).items;

    const results = await Promise.allSettled([
      learning.answerSessionItem(user.id, sessionId, {
        itemId: items[0]!.id,
        eventId: randomUUID(),
        answer: 'Integration target different-items-one.',
      }),
      learning.answerSessionItem(user.id, sessionId, {
        itemId: items[1]!.id,
        eventId: randomUUID(),
        answer: 'Integration target different-items-two.',
      }),
    ]);
    const session = await learning.getSession(user.id, sessionId);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(session).toMatchObject({ status: 'COMPLETED', completedCount: 2 });
  });

  it('marks a written answer as assisted after an answer reveal', async () => {
    const user = await createUser('assisted');
    const { set } = await createPublishedLearningSet('assisted');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;

    const reveal = await learning.revealSessionItem(user.id, sessionId, { itemId, kind: 'ANSWER' });
    const answer = await learning.answerSessionItem(user.id, sessionId, {
      itemId,
      eventId: randomUUID(),
      answer: 'Integration target assisted.',
    });

    expect(reveal.text).toBe('Integration target assisted.');
    expect(answer.result).toBe('ASSISTED');
  });

  it('marks a raced written answer as assisted when reveal commits before the answer', async () => {
    const user = await createUser('assisted-race');
    const { set } = await createPublishedLearningSet('assisted-race');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;

    const reveal = learning.revealSessionItem(user.id, sessionId, { itemId, kind: 'ANSWER' });
    await reveal;
    const answer = await learning.answerSessionItem(user.id, sessionId, {
      itemId,
      eventId: randomUUID(),
      answer: 'Integration target assisted-race.',
    });

    expect(answer.result).toBe('ASSISTED');
  });

  it('sums shared sentence counters across two concurrent sessions', async () => {
    const user = await createUser('shared-state');
    const { set, sentence } = await createPublishedLearningSet('shared-state');
    await learning.enrollSet(user.id, set.id);
    const firstSession = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const secondSession = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const firstItemId = (await learning.getSession(user.id, firstSession.id)).items[0]!.id;
    const secondItemId = (await learning.getSession(user.id, secondSession.id)).items[0]!.id;

    const results = await Promise.allSettled([
      learning.answerSessionItem(user.id, firstSession.id, {
        itemId: firstItemId,
        eventId: randomUUID(),
        answer: 'Integration target shared-state.',
      }),
      learning.answerSessionItem(user.id, secondSession.id, {
        itemId: secondItemId,
        eventId: randomUUID(),
        answer: 'Integration target shared-state.',
      }),
    ]);
    const state = await db.userSentenceState.findUniqueOrThrow({
      where: { userId_sentenceId_mode: { userId: user.id, sentenceId: sentence.sentenceId, mode: 'WRITTEN' } },
    });

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(state.correctCount).toBe(2);
  });

  it('records spoken self reports without verified correctness', async () => {
    const user = await createUser('spoken');
    const { set } = await createPublishedLearningSet('spoken');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'SPOKEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;

    await expect(learning.answerSessionItem(user.id, sessionId, { itemId, eventId: randomUUID(), selfRating: 'GOOD' })).rejects.toMatchObject({ status: 400 });
    await learning.revealSessionItem(user.id, sessionId, { itemId, kind: 'ANSWER' });
    const answer = await learning.answerSessionItem(user.id, sessionId, { itemId, eventId: randomUUID(), selfRating: 'GOOD' });

    expect(answer.correct).toBeNull();
    expect(answer.result).toBe('SELF_REPORTED');
  });

  it('does not increment the spoken good counter for AGAIN self reports', async () => {
    const user = await createUser('spoken-again');
    const { set, sentence } = await createPublishedLearningSet('spoken-again');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'SPOKEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;

    await learning.revealSessionItem(user.id, sessionId, { itemId, kind: 'ANSWER' });
    await learning.answerSessionItem(user.id, sessionId, { itemId, eventId: randomUUID(), selfRating: 'AGAIN' });
    const state = await db.userSentenceState.findUniqueOrThrow({
      where: { userId_sentenceId_mode: { userId: user.id, sentenceId: sentence.sentenceId, mode: 'SPOKEN' } },
    });

    expect(state.selfReportedGood).toBe(0);
  });

  it('excludes assisted answers from history correct counts', async () => {
    const user = await createUser('history-assisted');
    const { set } = await createPublishedLearningSet('history-assisted');
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;

    await learning.revealSessionItem(user.id, sessionId, { itemId, kind: 'HINT' });
    await learning.answerSessionItem(user.id, sessionId, {
      itemId,
      eventId: randomUUID(),
      answer: 'Integration target history-assisted.',
    });
    const history = await learning.getHistory(user.id);

    expect(history.find((session) => session.id === sessionId)).toMatchObject({ correctCount: 0, totalCount: 1 });
  });

  it('shows the practiced published sentence in my sentences when a newer draft version exists', async () => {
    const user = await createUser('my-sentence-draft');
    const audio = await createReadyAudio('my-sentence-draft-v1');
    const sentence = await content.adminCreateSentence(sentenceInput('my-sentence-draft-v1', audio.id));
    trackSentence(sentence.sentenceId);
    const set = await publishSet('my-sentence-draft', [sentence.id]);
    await learning.enrollSet(user.id, set.id);
    const { id: sessionId } = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const itemId = (await learning.getSession(user.id, sessionId)).items[0]!.id;
    await learning.answerSessionItem(user.id, sessionId, {
      itemId,
      eventId: randomUUID(),
      answer: 'Integration target my-sentence-draft-v1.',
    });
    const draftAudio = await createReadyAudio('my-sentence-draft-v2');
    await content.adminUpdateSentence(sentence.id, sentenceInput('my-sentence-draft-v2', draftAudio.id));

    const sentences = await learning.getMySentences(user.id);

    expect(sentences.find((item) => item.sentenceId === sentence.sentenceId)).toMatchObject({ prompt: 'Prompt my-sentence-draft-v1' });
  });

  it('does not allow an archived formerly published set to be edited back to draft', async () => {
    const { set, sentence } = await createPublishedLearningSet('archive-published');
    await content.adminUpdateSet(set.id, { status: 'ARCHIVED' });

    await expect(content.adminUpdateSet(set.id, setInput('archive-published-revive', [sentence.id]))).rejects.toMatchObject({ status: 409 });
    await expect(db.studySet.findUniqueOrThrow({ where: { id: set.id } })).resolves.toMatchObject({ status: 'ARCHIVED' });
  });

  it('does not allow a reviewed set to be edited in place', async () => {
    const audio = await createReadyAudio('reviewed-guard');
    const sentence = await content.adminCreateSentence(sentenceInput('reviewed-guard', audio.id));
    trackSentence(sentence.sentenceId);
    const set = await content.adminCreateSet(setInput('reviewed-guard', [sentence.id]));
    trackSet(set.id);
    await content.adminReviewSet(set.id);

    await expect(content.adminUpdateSet(set.id, setInput('reviewed-guard-edit', [sentence.id]))).rejects.toMatchObject({ status: 409 });
  });
});

async function createPublishedLearningSet(slug: string, sentenceSlugs = [slug]) {
  const sentences = [];
  for (const sentenceSlug of sentenceSlugs) {
    const audio = await createReadyAudio(sentenceSlug);
    const sentence = await content.adminCreateSentence(sentenceInput(sentenceSlug, audio.id));
    trackSentence(sentence.sentenceId);
    sentences.push(sentence);
  }
  const set = await publishSet(slug, sentences.map((sentence) => sentence.id));
  return { set, sentence: sentences[0]!, sentences };
}

async function publishSet(slug: string, sentenceVersionIds: string[]) {
  const set = await content.adminCreateSet(setInput(slug, sentenceVersionIds));
  trackSet(set.id);
  await content.adminReviewSet(set.id);
  return content.adminPublishSet(set.id);
}

async function createUser(slug: string) {
  const user = await db.appUser.create({
    data: {
      id: randomUUID(),
      email: `${slug}-${emailDomain}`,
      displayName: `Integration ${slug}`,
      onboarded: true,
    },
  });
  createdUserIds.add(user.id);
  return user;
}

async function createReadyAudio(slug: string) {
  const asset = await db.audioAsset.create({
    data: {
      path: `integration/${runId}/${slug}.wav`,
      contentType: 'audio/wav',
      size: 1,
      status: 'READY',
      completedAt: new Date(),
    },
  });
  createdAudioAssetIds.add(asset.id);
  return asset;
}

function sentenceInput(slug: string, audioAssetId?: string) {
  const target = `Integration target ${slug}.`;
  return {
    prompt: `Prompt ${slug}`,
    meaning: `Meaning ${slug}`,
    target,
    acceptedAnswers: [target],
    hint: `Hint ${slug}`,
    explanation: `Explanation ${slug}`,
    language: 'en' as const,
    level: 'A1' as const,
    audioAssetId,
  };
}

function setInput(slug: string, sentenceVersionIds: string[]) {
  return {
    title: `Integration set ${slug} ${runId}`,
    description: `Description ${slug}`,
    category: 'SITUATION' as const,
    level: 'A1' as const,
    sentenceVersionIds,
  };
}

function trackSet(id: string) {
  createdSetIds.add(id);
}

function trackSentence(id: string) {
  createdSentenceIds.add(id);
}
