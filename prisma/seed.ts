import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ quiet: true });
config({ path: '.env.local', override: false, quiet: true });

const bucket = 'sentence-audio';
const fixtureDir = join(process.cwd(), 'fixtures/audio');

const targets = [
  {
    prompt: '다시 말씀해 주시겠어요?',
    meaning: '상대방에게 다시 말해 달라고 정중히 요청합니다.',
    target: 'Could you say that again?',
    acceptedAnswers: ['Could you say that again?', 'Can you say that again?', 'Could you repeat that?'],
    hint: '정중한 요청은 “Could you”로 시작해 보세요.',
    explanation: '잘 못 들었을 때 자연스럽게 다시 말해 달라고 요청하는 표현입니다.',
    level: 'A1' as const,
  },
  {
    prompt: '커피 한 잔 주세요.',
    meaning: '커피 한 잔을 정중하게 주문합니다.',
    target: 'I would like a cup of coffee.',
    acceptedAnswers: ['I would like a cup of coffee.', "I'd like a cup of coffee."],
    hint: '주문할 때는 “I would like”가 공손합니다.',
    explanation: '카페나 식당에서 원하는 것을 말할 때 쓰는 기본 주문 표현입니다.',
    level: 'A1' as const,
  },
  {
    prompt: '가장 가까운 지하철역이 어디인가요?',
    meaning: '가장 가까운 지하철역 위치를 묻습니다.',
    target: 'Where is the nearest subway station?',
    acceptedAnswers: ['Where is the nearest subway station?', 'Where is the closest subway station?'],
    hint: '가장 가까운 장소는 “the nearest”로 묻습니다.',
    explanation: '길을 물을 때 목적지 앞에 “nearest”를 붙이면 가장 가까운 곳을 묻는 뜻이 됩니다.',
    level: 'A1' as const,
  },
  {
    prompt: '민 이름으로 예약했어요.',
    meaning: '민이라는 이름으로 예약했다고 말합니다.',
    target: 'I have a reservation under Min.',
    acceptedAnswers: ['I have a reservation under Min.', 'I have a booking under Min.'],
    hint: '예약자 이름 앞에는 “under”를 씁니다.',
    explanation: '식당이나 호텔에서 예약자 이름을 말할 때 자주 쓰는 표현입니다.',
    level: 'A2' as const,
  },
  {
    prompt: '카드로 결제할 수 있나요?',
    meaning: '카드 결제가 가능한지 묻습니다.',
    target: 'Can I pay by card?',
    acceptedAnswers: ['Can I pay by card?', 'May I pay by card?'],
    hint: '결제 수단은 “pay by card”로 말합니다.',
    explanation: '상점이나 식당에서 카드 결제가 되는지 확인할 때 쓰는 짧은 표현입니다.',
    level: 'A1' as const,
  },
  {
    prompt: '준비되면 불러 주세요.',
    meaning: '준비가 되면 불러 달라고 요청합니다.',
    target: 'Please call me when it is ready.',
    acceptedAnswers: ['Please call me when it is ready.', "Please call me when it's ready."],
    hint: '“준비되면”은 “when it is ready”로 말합니다.',
    explanation: '카페, 병원, 서비스 카운터에서 대기할 때 유용한 요청 표현입니다.',
    level: 'A2' as const,
  },
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for seed');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 1 }),
});

async function main() {
  for (const value of [connectionString!, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '']) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw new Error('Demo seed is restricted to local Supabase.');
  }
  const fixtureAudio = await uploadFixtureAudioIfPresent();
  const sentenceVersionIds: string[] = [];

  for (const [index, item] of targets.entries()) {
    const audio = fixtureAudio[index];
    const audioAsset = audio
      ? await prisma.audioAsset.upsert({
          where: { path: audio.path },
          update: { status: 'READY', contentType: 'audio/wav', size: audio.size, completedAt: new Date() },
          create: { path: audio.path, contentType: 'audio/wav', size: audio.size, status: 'READY', completedAt: new Date() },
        })
      : null;

    const sentenceId = `cmemseed0000000000000000${index + 1}`;
    const existing = await prisma.sentenceVersion.findFirst({ where: { sentenceId }, orderBy: { versionNumber: 'desc' } });
    if (existing) {
      sentenceVersionIds.push(existing.id);
      continue;
    }

    const sentence = await prisma.sentence.create({ data: { id: sentenceId } });
    const version = await prisma.sentenceVersion.create({
      data: {
        sentenceId: sentence.id,
        versionNumber: 1,
        prompt: item.prompt,
        meaning: item.meaning,
        target: item.target,
        acceptedAnswers: item.acceptedAnswers,
        hint: item.hint,
        explanation: item.explanation,
        language: 'en',
        level: item.level,
        audioAssetId: audioAsset?.id,
      },
    });
    sentenceVersionIds.push(version.id);
  }

  const publishSamples = fixtureAudio.length === targets.length;
  await ensureSet('cmemseedset000000000000001', '여행 기본 표현', '길 찾기와 매장 이용에 바로 쓰는 짧은 표현입니다.', 'SITUATION', 'A1', sentenceVersionIds.slice(0, 3), publishSamples);
  await ensureSet('cmemseedset000000000000002', '서비스 요청 표현', '예약, 결제, 대기 상황에서 공손하게 요청하는 표현입니다.', 'FUNCTION', 'A2', sentenceVersionIds.slice(3, 6), publishSamples);
}

async function uploadFixtureAudioIfPresent() {
  const fixturePaths = targets.map((_, index) => join(fixtureDir, `seed-${index + 1}.wav`));
  const existing = fixturePaths.filter((path) => existsSync(path));
  if (existing.length === 0) throw new Error('Seed WAV fixtures are required.');
  if (existing.length !== targets.length) throw new Error(`Expected ${targets.length} seed WAV fixtures, found ${existing.length}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase URL and secret key are required to upload seed audio');


  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const uploaded: { path: string; size: number }[] = [];
  for (const [index, filePath] of fixturePaths.entries()) {
    const path = `seed/seed-${index + 1}.wav`;
    const file = await readFile(filePath);
    const size = statSync(filePath).size;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: 'audio/wav',
    });
    if (error) throw new Error(`Failed to upload ${path}: ${error.message}`);

    const { data, error: listError } = await supabase.storage.from(bucket).list('seed', { search: `seed-${index + 1}.wav`, limit: 1 });
    if (listError || !data?.some((object) => object.name === `seed-${index + 1}.wav`)) {
      throw new Error(`Uploaded audio object was not visible in storage listing: ${path}`);
    }
    uploaded.push({ path, size });
  }
  return uploaded;
}

async function ensureSet(
  id: string,
  title: string,
  description: string,
  category: 'SITUATION' | 'PATTERN' | 'FUNCTION',
  level: 'A1' | 'A2' | 'B1',
  sentenceVersionIds: string[],
  publishSamples: boolean,
) {
  const existing = await prisma.studySet.findUnique({ where: { id } });
  const data = {
    title,
    description,
    category,
    level,
    status: publishSamples ? ('PUBLISHED' as const) : ('DRAFT' as const),
    publishedAt: publishSamples ? new Date() : null,
  };
  if (existing) return;
  await prisma.studySet.create({
    data: {
      id,
      ...data,
      sentences: {
        create: sentenceVersionIds.map((sentenceVersionId, index) => ({
          sentenceVersionId,
          order: index + 1,
        })),
      },
    },
  });
}

try { await main(); } finally { await prisma.$disconnect(); }
