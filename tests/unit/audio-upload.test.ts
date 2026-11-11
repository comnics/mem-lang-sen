import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sign: vi.fn(), list: vi.fn(), download: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => ({
  createSignedUploadUrl: mocks.sign, list: mocks.list, download: mocks.download,
}) } }) }));
vi.mock('@/server/db', () => ({ db: { audioAsset: { create: mocks.create, findUnique: mocks.find, update: mocks.update } } }));
import { completeAudioUpload, signAudioUpload } from '@/server/services/content';
import { audioBucketOptions } from '@/domain/audio-policy';

const validMp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
const input = (contentType = 'audio/mp3', size = validMp3.length) => ({ fileName: 'voice.mp3', contentType, size });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sign.mockResolvedValue({ data: { token: 'test-token', signedUrl: 'https://storage.test/upload' }, error: null });
  mocks.create.mockImplementation(async ({ data }) => ({ id: 'asset', ...data }));
  mocks.find.mockResolvedValue({ id: 'asset', path: 'sentences/test.mp3', contentType: 'audio/mp3', size: validMp3.length, status: 'PENDING' });
  mocks.list.mockResolvedValue({ data: [{ name: 'test.mp3', metadata: { size: validMp3.length } }], error: null });
  mocks.download.mockResolvedValue({ data: new Blob([validMp3], { type: 'audio/mp3' }), error: null });
  mocks.update.mockResolvedValue({ id: 'asset', status: 'READY' });
});

describe('admin audio upload contract', () => {
  it.each(['scripts/local-setup.ts', 'scripts/platform-setup.ts'])('%s permits every API audio MIME', async (script) => {
    const source = readFileSync(script, 'utf8');
    const literal = source.match(/allowedMimeTypes: \[([^\]]+)\]/)?.[1];
    // Inspect old inline configurations too, so restoring either pre-fix entrypoint fails.
    const bucketTypes = literal ? [...literal.matchAll(/'([^']+)'/g)].map((match) => match[1]) : audioBucketOptions().allowedMimeTypes;
    if (!literal) {
      expect(source).toContain("import { audioBucketOptions } from '../src/domain/audio-policy'");
      expect(source).toMatch(/const (?:bucketOptions|options) = audioBucketOptions\(\)/);
    }
    expect(audioBucketOptions()).toEqual({ public: false, fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'] });
    expect([...bucketTypes].sort()).toEqual([...audioBucketOptions().allowedMimeTypes].sort());
    for (const type of ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg']) {
      await expect(signAudioUpload(input(type))).resolves.toHaveProperty('id', 'asset');
      expect(bucketTypes).toContain(type);
    }
  });

  it.each(['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg'])('preserves %s when signing', async (type) => {
    await signAudioUpload(input(type));
    expect(mocks.create).toHaveBeenCalledWith({ data: { path: expect.any(String), contentType: type, size: validMp3.length } });
  });

  it.each(['audio/mp3', 'audio/mpeg'])('validates real completion function for %s ID3 and frame headers', async (type) => {
    for (const bytes of [validMp3, new Uint8Array([73, 68, 51, 0])]) {
      mocks.find.mockResolvedValue({ id: 'asset', path: 'sentences/test.mp3', contentType: type, size: bytes.length });
      mocks.download.mockResolvedValue({ data: new Blob([bytes], { type }), error: null });
      await expect(completeAudioUpload('asset')).resolves.toHaveProperty('status', 'READY');
    }
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'asset' }, data: { status: 'READY', completedAt: expect.any(Date) } });
  });

  it.each(['audio/mp3', 'audio/mpeg'])('rejects forged %s without marking READY', async (type) => {
    mocks.find.mockResolvedValue({ id: 'asset', path: 'sentences/test.mp3', contentType: type, size: 4 });
    mocks.download.mockResolvedValue({ data: new Blob(['fake'], { type }), error: null });
    await expect(completeAudioUpload('asset')).rejects.toThrow('파일 형식');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/octet-stream', 'audio/flac'])('rejects unsupported %s before creating pending state', async (type) => {
    await expect(signAudioUpload(input(type))).rejects.toThrow('mp3, wav, ogg');
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 10 * 1024 * 1024 + 1])('rejects invalid size %s before signing', async (size) => {
    await expect(signAudioUpload(input('audio/mp3', size))).rejects.toThrow('10MB');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('accepts exactly the size limit', async () => {
    await expect(signAudioUpload(input('audio/mp3', 10 * 1024 * 1024))).resolves.toHaveProperty('id', 'asset');
  });

  it('does not create an asset when URL signing fails', async () => {
    mocks.sign.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(signAudioUpload(input())).rejects.toThrow('업로드 URL');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps a missing/failed direct upload pending and permits completion retry', async () => {
    await signAudioUpload(input());
    mocks.list.mockResolvedValueOnce({ data: [], error: null });
    await expect(completeAudioUpload('asset')).rejects.toThrow('객체를 확인');
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(completeAudioUpload('asset')).resolves.toHaveProperty('status', 'READY');
  });

  it('rejects MIME mismatch, size mismatch, and download failure without READY', async () => {
    mocks.download.mockResolvedValueOnce({ data: new Blob([validMp3], { type: 'audio/wav' }), error: null });
    await expect(completeAudioUpload('asset')).rejects.toThrow('MIME');
    mocks.download.mockResolvedValueOnce({ data: new Blob(['too long'], { type: 'audio/mp3' }), error: null });
    await expect(completeAudioUpload('asset')).rejects.toThrow('크기');
    mocks.download.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(completeAudioUpload('asset')).rejects.toThrow('검증할 수');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
