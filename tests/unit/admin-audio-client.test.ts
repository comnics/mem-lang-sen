import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.upload }) } }) }));
import { uploadAudio } from '@/features/admin/api';
let request: ReturnType<typeof vi.fn>;
const file = new File([new Uint8Array([73, 68, 51, 0])], 'voice.mp3', { type: 'audio/mp3' });
beforeEach(() => {
  vi.resetAllMocks();
  request = vi.fn().mockResolvedValueOnce(Response.json({ id: 'asset', path: 'sentences/voice.mp3', token: 'test-token', signedUrl: 'https://storage.test/upload' }))
    .mockResolvedValueOnce(Response.json({ id: 'asset' }));
  vi.stubGlobal('fetch', request);
  mocks.upload.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('sends the original MIME and File through sign, direct upload and complete', async () => {
  expect(await uploadAudio(file)).toBe('asset');
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ action: 'sign', fileName: file.name, contentType: 'audio/mp3', size: file.size });
  expect(mocks.upload).toHaveBeenCalledWith('sentences/voice.mp3', 'test-token', file);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ action: 'complete', id: 'asset' });
});
it('returns direct upload errors without attempting completion', async () => {
  mocks.upload.mockResolvedValue({ error: { message: 'Storage rejected the upload' } });
  await expect(uploadAudio(file)).rejects.toThrow('Storage rejected the upload');
  expect(request).toHaveBeenCalledTimes(1);
});
it('returns the API validation message before contacting Storage', async () => {
  request.mockReset().mockResolvedValue(Response.json({ error: 'mp3, wav, ogg 음원만 업로드할 수 있습니다.' }, { status: 400 }));
  await expect(uploadAudio(file)).rejects.toThrow('mp3, wav, ogg');
  expect(mocks.upload).not.toHaveBeenCalled();
});
it('does not hide completion errors', async () => {
  request.mockReset().mockResolvedValueOnce(Response.json({ id: 'asset', path: 'sentences/voice.mp3', token: 'test-token' }))
    .mockResolvedValueOnce(Response.json({ error: '업로드된 음원 파일 형식이 올바르지 않습니다.' }, { status: 400 }));
  await expect(uploadAudio(file)).rejects.toThrow('파일 형식');
});
