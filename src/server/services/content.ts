import 'server-only';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseSentenceCsv } from '@/domain/csv-import';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';

const AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET ?? 'sentence-audio';
const allowedAudioTypes = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg']);
const maxAudioSize = 10 * 1024 * 1024;

export const sentenceInputSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  meaning: z.string().trim().min(1).max(500),
  target: z.string().trim().min(1).max(500),
  acceptedAnswers: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  hint: z.string().trim().min(1).max(500),
  explanation: z.string().trim().min(1).max(1000),
  language: z.literal('en'),
  level: z.enum(['A1', 'A2', 'B1']),
  audioAssetId: z.string().cuid().optional(),
});

export const setInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  category: z.enum(['SITUATION', 'PATTERN', 'FUNCTION']),
  level: z.enum(['A1', 'A2', 'B1']),
  sentenceVersionIds: z.array(z.string().cuid()).min(1).max(100),
});

function serializeDate<T extends { createdAt?: Date; updatedAt?: Date; publishedAt?: Date | null; completedAt?: Date | null }>(value: T) {
  return {
    ...value,
    createdAt: value.createdAt?.toISOString(),
    updatedAt: value.updatedAt?.toISOString(),
    publishedAt: value.publishedAt?.toISOString() ?? null,
    completedAt: value.completedAt?.toISOString() ?? null,
  };
}

function adminSetDto(set: {
  id: string;
  title: string;
  description: string;
  category: 'SITUATION' | 'PATTERN' | 'FUNCTION';
  level: 'A1' | 'A2' | 'B1';
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  sentences: { sentenceVersionId: string; order: number }[];
}) {
  const sentenceVersionIds = [...set.sentences].sort((a, b) => a.order - b.order).map((item) => item.sentenceVersionId);
  return {
    ...serializeDate(set),
    sentenceVersionIds,
    sentenceCount: sentenceVersionIds.length,
  };
}

async function requirePublishedSet(setId: string) {
  const set = await db.studySet.findFirst({
    where: { id: setId, status: 'PUBLISHED' },
    include: {
      sentences: {
        orderBy: { order: 'asc' },
        include: { sentenceVersion: true },
      },
    },
  });
  if (!set) throw new HttpError(404, '세트를 찾을 수 없습니다.');
  return set;
}

export async function listSets(userId?: string) {
  const [sets, enrollments] = await Promise.all([
    db.studySet.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { sentences: true } } },
    }),
    userId ? db.enrollment.findMany({ where: { userId }, select: { setId: true } }) : Promise.resolve([]),
  ]);
  const enrolled = new Set(enrollments.map((row) => row.setId));
  return sets.map((set) => ({
    id: set.id,
    title: set.title,
    description: set.description,
    category: set.category,
    level: set.level,
    sentenceCount: set._count.sentences,
    enrolled: enrolled.has(set.id),
  }));
}

export async function getSet(id: string, userId?: string) {
  const set = await requirePublishedSet(id);
  const enrollment = userId
    ? await db.enrollment.findUnique({ where: { userId_setId: { userId, setId: id } } })
    : null;
  return {
    id: set.id,
    title: set.title,
    description: set.description,
    category: set.category,
    level: set.level,
    sentenceCount: set.sentences.length,
    enrolled: Boolean(enrollment),
    paused: enrollment?.paused ?? false,
    items: set.sentences.map((item) => ({
      id: item.sentenceVersion.id,
      prompt: item.sentenceVersion.prompt,
      meaning: item.sentenceVersion.meaning,
      order: item.order,
    })),
  };
}

export async function adminListSets() {
  const sets = await db.studySet.findMany({
    orderBy: [{ updatedAt: 'desc' }],
    include: { sentences: { orderBy: { order: 'asc' } } },
  });
  return sets.map(adminSetDto);
}

export async function adminListSentences() {
  const versions = await db.sentenceVersion.findMany({
    orderBy: [{ createdAt: 'desc' }],
    include: { audioAsset: true },
  });
  return versions.map((version) => serializeDate(version));
}

export async function adminCreateSentence(input: z.infer<typeof sentenceInputSchema>) {
  const data = sentenceInputSchema.parse(input);
  if (data.audioAssetId) await requireReadyAudio(data.audioAssetId);
  return db.$transaction(async (tx) => {
    const sentence = await tx.sentence.create({ data: {} });
    return tx.sentenceVersion.create({
      data: {
        ...data,
        acceptedAnswers: Array.from(new Set([data.target, ...data.acceptedAnswers.map((value) => value.trim())])),
        sentenceId: sentence.id,
        versionNumber: 1,
      },
    });
  });
}

export async function adminUpdateSentence(id: string, input: z.infer<typeof sentenceInputSchema>) {
  const data = sentenceInputSchema.parse(input);
  if (data.audioAssetId) await requireReadyAudio(data.audioAssetId);
  return db.$transaction(async (tx) => {
    const current = await tx.sentenceVersion.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, '문장을 찾을 수 없습니다.');
    await lockSentence(tx, current.sentenceId);
    const latest = await tx.sentenceVersion.findFirst({
      where: { sentenceId: current.sentenceId },
      orderBy: { versionNumber: 'desc' },
    });
    return tx.sentenceVersion.create({
      data: {
        ...data,
        acceptedAnswers: Array.from(new Set([data.target, ...data.acceptedAnswers.map((value) => value.trim())])),
        sentenceId: current.sentenceId,
        versionNumber: (latest?.versionNumber ?? current.versionNumber) + 1,
      },
    });
  });
}

export async function adminCreateSet(input: z.infer<typeof setInputSchema>) {
  const data = setInputSchema.parse(input);
  await requireSentenceVersions(data.sentenceVersionIds);
  const set = await db.studySet.create({
    data: {
      title: data.title,
      description: data.description,
      category: data.category,
      level: data.level,
      sentences: {
        create: data.sentenceVersionIds.map((sentenceVersionId, index) => ({
          sentenceVersionId,
          order: index + 1,
        })),
      },
    },
    include: { sentences: { orderBy: { order: 'asc' } } },
  });
  return adminSetDto(set);
}

export async function adminUpdateSet(id: string, input: Partial<z.infer<typeof setInputSchema>> & { status?: 'ARCHIVED' }) {
  if (input.status === 'ARCHIVED') {
    const set = await db.$transaction(async (tx) => {
      const current = await lockSet(tx, id);
      if (current.status === 'ARCHIVED') throw new HttpError(409, '이미 보관된 세트입니다.');
      return tx.studySet.update({
        where: { id },
        data: { status: 'ARCHIVED' },
        include: { sentences: { orderBy: { order: 'asc' } } },
      });
    });
    return adminSetDto(set);
  }

  const data = setInputSchema.parse(input);
  await requireSentenceVersions(data.sentenceVersionIds);
  const set = await db.$transaction(async (tx) => {
    const current = await lockSet(tx, id);
    if (current.status !== 'DRAFT') throw new HttpError(409, '초안 세트만 수정할 수 있습니다.');
    await tx.setSentence.deleteMany({ where: { setId: id } });
    return tx.studySet.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        category: data.category,
        level: data.level,
        status: current.status,
        sentences: {
          create: data.sentenceVersionIds.map((sentenceVersionId, index) => ({
            sentenceVersionId,
            order: index + 1,
          })),
        },
      },
      include: { sentences: { orderBy: { order: 'asc' } } },
    });
  });
  return adminSetDto(set);
}

export async function adminCloneSet(id: string) {
  const set = await db.$transaction(async (tx) => {
    await lockSet(tx, id);
    const current = await tx.studySet.findUnique({
      where: { id },
      include: { sentences: { orderBy: { order: 'asc' } } },
    });
    if (!current) throw new HttpError(404, '세트를 찾을 수 없습니다.');
    return tx.studySet.create({
      data: {
        title: `${current.title} 복사본`,
        description: current.description,
        category: current.category,
        level: current.level,
        status: 'DRAFT',
        sentences: {
          create: current.sentences.map((item) => ({
            sentenceVersionId: item.sentenceVersionId,
            order: item.order,
          })),
        },
      },
      include: { sentences: { orderBy: { order: 'asc' } } },
    });
  });
  return adminSetDto(set);
}

export async function adminReviewSet(id: string) {
  const reviewed = await db.$transaction(async (tx) => {
    const set = await lockSet(tx, id);
    const sentences = await tx.setSentence.findMany({ where: { setId: id } });
    if (set.status !== 'DRAFT') throw new HttpError(409, '초안 세트만 검수 요청할 수 있습니다.');
    if (sentences.length === 0) throw new HttpError(400, '문장이 없는 세트는 검수할 수 없습니다.');
    return tx.studySet.update({
      where: { id },
      data: { status: 'REVIEW' },
      include: { sentences: { orderBy: { order: 'asc' } } },
    });
  });
  return adminSetDto(reviewed);
}

export async function adminPublishSet(id: string) {
  const published = await db.$transaction(async (tx) => {
    const locked = await lockSet(tx, id);
    const set = await tx.studySet.findUnique({
      where: { id },
      include: { sentences: { include: { sentenceVersion: { include: { audioAsset: true } } } } },
    });
    if (!set) throw new HttpError(404, '세트를 찾을 수 없습니다.');
    if (locked.status !== 'REVIEW') throw new HttpError(409, '검수 상태의 세트만 발행할 수 있습니다.');
    if (set.sentences.length === 0) throw new HttpError(400, '문장이 없는 세트는 발행할 수 없습니다.');
    for (const item of set.sentences) {
      const version = item.sentenceVersion;
      if (!version.target || version.acceptedAnswers.length === 0 || !version.hint || !version.explanation) {
        throw new HttpError(400, '모든 문장에 정답, 힌트, 설명이 필요합니다.');
      }
      if (!version.audioAsset || version.audioAsset.status !== 'READY') {
        throw new HttpError(400, '모든 문장에 검증된 음원이 필요합니다.');
      }
    }
    return tx.studySet.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { sentences: { orderBy: { order: 'asc' } } },
    });
  });
  return adminSetDto(published);
}

export async function importSentences(csv: string, commit: boolean) {
  const parsed = parseSentenceCsv(csv);
  if (parsed.errors.length > 0 || !commit) return { ...parsed, imported: commit ? 0 : undefined };

  const imported = await db.$transaction(async (tx) => {
    let count = 0;
    for (const row of parsed.rows) {
      const sentence = await tx.sentence.create({ data: {} });
      await tx.sentenceVersion.create({
        data: {
          sentenceId: sentence.id,
          versionNumber: 1,
          prompt: row.prompt,
          meaning: row.meaning,
          target: row.target,
          acceptedAnswers: row.acceptedAnswers,
          hint: row.hint,
          explanation: row.explanation,
          language: 'en',
          level: row.level,
        },
      });
      count += 1;
    }
    return count;
  });
  return { rows: parsed.rows, errors: [], imported };
}

export async function signAudioUpload(input: { fileName: string; contentType: string; size: number }) {
  if (!allowedAudioTypes.has(input.contentType)) throw new HttpError(400, 'mp3, wav, ogg 음원만 업로드할 수 있습니다.');
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > maxAudioSize) {
    throw new HttpError(400, '음원은 10MB 이하만 업로드할 수 있습니다.');
  }
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'audio';
  const id = crypto.randomUUID().replaceAll('-', '');
  const path = `sentences/${id}-${safeName}`;
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path);
  if (error) throw new HttpError(500, '업로드 URL을 만들지 못했습니다.');
  const asset = await db.audioAsset.create({
    data: { path, contentType: input.contentType, size: input.size },
  });
  return { id: asset.id, path, token: data.token, signedUrl: data.signedUrl };
}

export async function completeAudioUpload(id: string) {
  const asset = await db.audioAsset.findUnique({ where: { id } });
  if (!asset) throw new HttpError(404, '음원을 찾을 수 없습니다.');
  if (!allowedAudioTypes.has(asset.contentType) || asset.size <= 0 || asset.size > maxAudioSize) {
    throw new HttpError(400, '음원 메타데이터가 허용 범위를 벗어났습니다.');
  }
  const supabase = createAdminClient();
  const dir = asset.path.slice(0, asset.path.lastIndexOf('/'));
  const name = asset.path.slice(asset.path.lastIndexOf('/') + 1);
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).list(dir, { search: name, limit: 1 });
  const listedObject = data?.find((object) => object.name === name);
  if (error || !listedObject) throw new HttpError(400, '업로드된 음원 객체를 확인할 수 없습니다.');
  const listedSize = storageObjectSize(listedObject);
  if (listedSize !== undefined && listedSize !== asset.size) throw new HttpError(400, '업로드된 음원 크기가 요청값과 다릅니다.');
  if (listedSize !== undefined && listedSize > maxAudioSize) throw new HttpError(400, '음원은 10MB 이하만 업로드할 수 있습니다.');

  const { data: blob, error: downloadError } = await supabase.storage.from(AUDIO_BUCKET).download(asset.path);
  if (downloadError || !blob) throw new HttpError(400, '업로드된 음원을 검증할 수 없습니다.');
  if (blob.size !== asset.size) throw new HttpError(400, '업로드된 음원 크기가 요청값과 다릅니다.');
  if (blob.size > maxAudioSize) throw new HttpError(400, '음원은 10MB 이하만 업로드할 수 있습니다.');
  if (blob.type && blob.type !== asset.contentType) throw new HttpError(400, '업로드된 음원 MIME 유형이 요청값과 다릅니다.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!matchesAudioMagic(bytes, asset.contentType)) throw new HttpError(400, '업로드된 음원 파일 형식이 올바르지 않습니다.');
  return db.audioAsset.update({ where: { id }, data: { status: 'READY', completedAt: new Date() } });
}

async function requireReadyAudio(id: string) {
  const asset = await db.audioAsset.findUnique({ where: { id } });
  if (!asset || asset.status !== 'READY') throw new HttpError(400, '검증된 음원만 연결할 수 있습니다.');
  return asset;
}

async function requireSentenceVersions(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new HttpError(400, '중복된 문장이 포함되어 있습니다.');
  const versions = await db.sentenceVersion.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (versions.length !== new Set(ids).size) throw new HttpError(400, '존재하지 않는 문장이 포함되어 있습니다.');
}

export async function signedAudioUrl(path: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new HttpError(503, '음원 재생 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data.signedUrl;
}

async function lockSentence(tx: Prisma.TransactionClient, sentenceId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM app."Sentence"
    WHERE id = ${sentenceId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw new HttpError(404, '문장을 찾을 수 없습니다.');
}

async function lockSet(tx: Prisma.TransactionClient, setId: string) {
  const rows = await tx.$queryRaw<
    {
      id: string;
      title: string;
      description: string;
      category: 'SITUATION' | 'PATTERN' | 'FUNCTION';
      level: 'A1' | 'A2' | 'B1';
      status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
      createdAt: Date;
      updatedAt: Date;
      publishedAt: Date | null;
    }[]
  >`
    SELECT id, title, description, category, level, status, "createdAt", "updatedAt", "publishedAt"
    FROM app."StudySet"
    WHERE id = ${setId}
    FOR UPDATE
  `;
  const set = rows[0];
  if (!set) throw new HttpError(404, '세트를 찾을 수 없습니다.');
  return set;
}

function storageObjectSize(object: { metadata?: unknown }): number | undefined {
  if (!object.metadata || typeof object.metadata !== 'object') return undefined;
  const metadata = object.metadata as Record<string, unknown>;
  const rawSize = metadata.size ?? metadata.contentLength ?? metadata.content_length;
  return typeof rawSize === 'number' ? rawSize : undefined;
}

function matchesAudioMagic(bytes: Uint8Array, contentType: string) {
  if (contentType === 'audio/wav') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE';
  }
  if (contentType === 'audio/ogg') {
    return ascii(bytes, 0, 4) === 'OggS';
  }
  if (contentType === 'audio/mpeg' || contentType === 'audio/mp3') {
    return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  return false;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
