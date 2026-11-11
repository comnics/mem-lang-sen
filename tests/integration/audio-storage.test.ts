import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audioBucketOptions } from '@/domain/audio-policy';

config({ path: '.env.local', quiet: true });
let db: typeof import('@/server/db')['db'];
let content: typeof import('@/server/services/content');
let storage: ReturnType<typeof createClient>['storage'];
const assets: { id: string; path: string }[] = [];
const bucket = process.env.SUPABASE_AUDIO_BUCKET ?? 'sentence-audio';

// Real SDK/Storage/DB path, never a hosted project. Requires pnpm local:setup.
describe('local Storage audio upload contract', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!databaseUrl || !apiUrl || !key) throw new Error('Local Supabase/DB required. Run pnpm local:setup.');
    for (const value of [databaseUrl, apiUrl]) {
      if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw new Error('Refusing non-local audio integration target.');
    }
    storage = createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
    ({ db } = await import('@/server/db'));
    content = await import('@/server/services/content');
    const { data, error } = await storage.getBucket(bucket);
    expect(error).toBeNull();
    expect(data).toMatchObject({ public: false, file_size_limit: audioBucketOptions().fileSizeLimit });
    expect(data?.allowed_mime_types?.slice().sort()).toEqual(audioBucketOptions().allowedMimeTypes.sort());
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (assets.length) {
        const removed = await storage.from(bucket).remove(assets.map((asset) => asset.path));
        if (removed.error) throw new Error('Local test object cleanup failed; keep DB rows for retry.');
        await db.audioAsset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } });
      }
    } finally { await db.$disconnect(); }
  });

  it.each(['audio/mp3', 'audio/mpeg'])('signs, directly uploads a File, and completes %s', async (type) => {
    // Minimal accepted ID3 magic fixture; not a full decoder/quality test.
    const file = new File([new Uint8Array([73, 68, 51, 0])], 'voice.mp3', { type });
    const signed = await content.signAudioUpload({ fileName: file.name, contentType: file.type, size: file.size });
    assets.push(signed);
    const uploaded = await storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, file);
    expect(uploaded.error).toBeNull();
    await expect(content.completeAudioUpload(signed.id)).resolves.toMatchObject({ status: 'READY', contentType: type });
  });

  it.each(['audio/mp3', 'audio/mpeg'])('refuses forged %s at completion and preserves PENDING', async (type) => {
    const file = new File(['fake'], 'fake.mp3', { type });
    const signed = await content.signAudioUpload({ fileName: file.name, contentType: type, size: file.size });
    assets.push(signed);
    expect((await storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, file)).error).toBeNull();
    await expect(content.completeAudioUpload(signed.id)).rejects.toMatchObject({ status: 400 });
    await expect(db.audioAsset.findUniqueOrThrow({ where: { id: signed.id } })).resolves.toHaveProperty('status', 'PENDING');
  });

  it('does not complete a signed but never uploaded asset', async () => {
    const signed = await content.signAudioUpload({ fileName: 'missing.mp3', contentType: 'audio/mp3', size: 4 });
    assets.push(signed);
    await expect(content.completeAudioUpload(signed.id)).rejects.toMatchObject({ status: 400 });
    await expect(db.audioAsset.findUniqueOrThrow({ where: { id: signed.id } })).resolves.toHaveProperty('status', 'PENDING');
  });
});
