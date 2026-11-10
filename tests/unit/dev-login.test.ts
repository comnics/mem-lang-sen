import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), user: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } }) }));
vi.mock('@/server/auth', () => ({ getCurrentUser: mocks.user, requireUser: vi.fn() }));
import { POST } from '@/app/api/auth/[action]/route';
import { devLoginEnabled } from '@/server/dev-login';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_ORIGIN', '');
  vi.stubEnv('DATABASE_URL', 'configured');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'configured');
  vi.stubEnv('DEV_LOGIN_ADMIN_EMAIL', 'admin@example.test');
  vi.stubEnv('DEV_LOGIN_ADMIN_PASSWORD', 'server-only-password');
  mocks.signIn.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
const request = (role = 'ADMIN', origin = 'http://127.0.0.1:3100') => POST(new Request('http://127.0.0.1:3100/api/auth/dev-signin', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }), { params: Promise.resolve({ action: 'dev-signin' }) });

describe('development login boundary', () => {
  it('blocks production before authenticating even with credentials present', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(devLoginEnabled()).toBe(false);
    for (const role of ['ADMIN', 'USER']) expect((await request(role)).status).toBe(404);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('blocks hosted development', async () => {
    vi.stubEnv('VERCEL', '1');
    expect(devLoginEnabled()).toBe(false);
    for (const role of ['ADMIN', 'USER']) expect((await request(role)).status).toBe(404);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('uses server credentials and checks the current role', async () => {
    mocks.user.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });
    const response = await request();
    expect(await response.json()).toEqual({ redirectTo: '/admin' });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'admin@example.test', password: 'server-only-password' });
  });
  it.each([true, false])('uses USER credentials and routes onboarded=%s users', async (onboarded) => {
    vi.stubEnv('DEV_LOGIN_USER_EMAIL', 'user@example.test');
    vi.stubEnv('DEV_LOGIN_USER_PASSWORD', 'user-test-password');
    expect(devLoginEnabled()).toBe(true);
    mocks.user.mockResolvedValue({ role: 'USER', status: 'ACTIVE', onboarded });
    const response = await request('USER');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: onboarded ? '/today' : '/onboarding' });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'user@example.test', password: 'user-test-password' });
  });
  it('signs out a mismatched or suspended account without elevating it', async () => {
    for (const user of [{ role: 'USER', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }]) {
      mocks.user.mockResolvedValue(user);
      expect((await request()).status).toBe(403);
    }
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
  });
  it('rejects missing credentials and arbitrary roles', async () => {
    vi.stubEnv('DEV_LOGIN_ADMIN_PASSWORD', '');
    expect((await request()).status).toBe(503);
    expect((await request('SUPERUSER')).status).toBe(400);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
