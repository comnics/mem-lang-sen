import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, HttpError } from '@/server/http';
import { appOrigin } from '@/server/env';
afterEach(() => vi.unstubAllEnvs());
describe('origin-independent API', () => {
  it('accepts any or missing Origin without APP_ORIGIN in production', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_ORIGIN', '');
    const handler = api(async () => Response.json({ ok: true }));
    for (const origin of [null, 'null', 'https://another.example', 'http://localhost:3000']) {
      const response = await handler(new Request('https://site.vercel.app/api/test', { method: 'POST', headers: origin ? { Origin: origin } : {} }), { params: Promise.resolve({}) });
      expect(response.status).toBe(200);
    }
  });
  it('preserves authentication and authorization errors', async () => {
    for (const status of [401, 403]) {
      const handler = api(async () => { throw new HttpError(status, 'denied'); });
      expect((await handler(new Request('https://site.vercel.app/api/test', { method: 'POST' }), { params: Promise.resolve({}) })).status).toBe(status);
    }
  });
});
describe('request destination for auth links', () => {
  it('uses the destination instead of APP_ORIGIN or caller Origin', () => {
    vi.stubEnv('VERCEL', ''); vi.stubEnv('APP_ORIGIN', 'https://obsolete.example');
    expect(appOrigin(new Request('http://localhost:3000/api/auth/signup', { headers: { Host: '127.0.0.1:3000', Origin: 'https://caller.example' } }))).toBe('http://127.0.0.1:3000');
  });
  it('uses HTTPS on Vercel and supports different deployment domains', () => {
    vi.stubEnv('VERCEL', '1');
    for (const host of ['myapp.vercel.app', 'myapp-preview.vercel.app', 'app.example.com']) {
      expect(appOrigin(new Request('http://localhost/api/auth/signup', { headers: { Host: host } }))).toBe(`https://${host}`);
    }
  });
  it('falls back to the request URL and rejects malformed Host', () => {
    vi.stubEnv('VERCEL', '');
    expect(appOrigin(new Request('https://site.example/auth/confirm'))).toBe('https://site.example');
    expect(() => appOrigin(new Request('https://site.example', { headers: { Host: 'evil.example/path' } }))).toThrow();
  });
});
