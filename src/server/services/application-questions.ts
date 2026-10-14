import 'server-only';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';

export const applicationQuestionInputSchema = z.object({
  sentenceVersionId: z.string().cuid(),
  prompt: z.string().trim().min(1).max(500),
  meaning: z.string().trim().min(1).max(500),
  target: z.string().trim().min(1).max(500),
  acceptedAnswers: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  explanation: z.string().trim().min(1).max(1000),
});

export async function adminListApplicationQuestions() {
  return db.applicationQuestion.findMany({
    orderBy: [{ updatedAt: 'desc' }],
    include: { sentenceVersion: { select: { prompt: true, target: true } } },
  });
}

export async function adminCreateApplicationQuestion(input: z.infer<typeof applicationQuestionInputSchema>) {
  const data = applicationQuestionInputSchema.parse(input);
  await requireSentenceVersion(data.sentenceVersionId);
  return db.applicationQuestion.create({
    data: { ...data, acceptedAnswers: Array.from(new Set([data.target, ...data.acceptedAnswers])) },
  });
}

export async function adminUpdateApplicationQuestion(id: string, input: z.infer<typeof applicationQuestionInputSchema> | { status: 'REVIEW' | 'PUBLISHED' | 'ARCHIVED' }) {
  return db.$transaction(async (tx) => {
    const current = await lockApplicationQuestion(tx, id);
    if ('status' in input) {
      if (input.status === 'PUBLISHED' && current.status !== 'REVIEW') throw new HttpError(409, '검수 상태의 응용 문항만 발행할 수 있습니다.');
      if (input.status === 'REVIEW' && current.status !== 'DRAFT') throw new HttpError(409, '초안 문항만 검수 요청할 수 있습니다.');
      if (input.status === 'ARCHIVED' && current.status === 'ARCHIVED') throw new HttpError(409, '이미 보관된 문항입니다.');
      return tx.applicationQuestion.update({ where: { id }, data: { status: input.status } });
    }
    if (current.status !== 'DRAFT') throw new HttpError(409, '초안 응용 문항만 수정할 수 있습니다.');
    const data = applicationQuestionInputSchema.parse(input);
    await requireSentenceVersion(data.sentenceVersionId, tx);
    return tx.applicationQuestion.update({
      where: { id },
      data: { ...data, acceptedAnswers: Array.from(new Set([data.target, ...data.acceptedAnswers])) },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function requireSentenceVersion(id: string, tx: Prisma.TransactionClient | typeof db = db) {
  const version = await tx.sentenceVersion.findUnique({ where: { id }, select: { id: true } });
  if (!version) throw new HttpError(400, '존재하지 않는 문장 버전입니다.');
}

async function lockApplicationQuestion(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string; status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED' }[]>`
    SELECT id, status
    FROM app."ApplicationQuestion"
    WHERE id = ${id}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new HttpError(404, '응용 문항을 찾을 수 없습니다.');
  return row;
}
