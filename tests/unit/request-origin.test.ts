import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/server/http';
const handler = api(async () => Response.json({ ok: true }));
const send = (origin: string | null, host = 'localhost:3000') => handler(new Request('http://localhost:3000/api/test', { method: 'POST', headers: { Host: host, ...(origin === null ? {} : { Origin: origin }) } }), { params: Promise.resolve({}) });
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3100'); });
afterEach(() => vi.unstubAllEnvs());
describe('request origin validation', () => {
  it('allows the configured origin', async () => { expect((await send('http://127.0.0.1:3100')).status).toBe(200); });
  it('allows same-origin loopback requests on the actual dev port', async () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) expect((await send(`http://${host}`, host)).status).toBe(200);
  });
  it('rejects missing, malformed, external, cross-host and cross-port origins', async () => {
    for (const origin of [null, 'null', 'invalid', 'https://evil.example', 'http://localhost:4000', 'http://127.0.0.1:3000']) expect((await send(origin)).status).toBe(403);
    expect((await send('http://evil.example', 'evil.example')).status).toBe(403);
  });
  it('does not relax origin validation in production or hosted development', async () => {
    vi.stubEnv('NODE_ENV', 'production'); expect((await send('http://localhost:3000')).status).toBe(403);
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', '1'); expect((await send('http://localhost:3000')).status).toBe(403);
    vi.stubEnv('VERCEL', ''); vi.stubEnv('APP_ORIGIN', 'https://app.example'); expect((await send('http://localhost:3000')).status).toBe(403);
  });
});
