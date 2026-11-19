import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

config({ path: '.env.local', quiet: true });
const auth = vi.hoisted(() => ({ user: { id: '', email: '' } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: auth.user }, error: null }),
} }) }));
vi.mock('@/server/env', () => ({ isConfigured: () => true }));
type Db = typeof import('@/server/db')['db'];
let db: Db;
let getCurrentUser: typeof import('@/server/auth')['getCurrentUser'];
const ids: string[] = [];
const email = `${randomUUID()}@auth.integration.test`;
function id() { const value = randomUUID(); ids.push(value); return value; }

describe('Auth UUID provisioning with PostgreSQL (Auth boundary mocked)', () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
      throw new Error('Auth integration requires an isolated local DATABASE_URL and applied migrations.');
    }
    ({ db } = await import('@/server/db'));
    ({ getCurrentUser } = await import('@/server/auth'));
    await db.$queryRaw`select 1`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.appUser.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });
  it('has no email uniqueness index; same-email UUIDs remain distinct', async () => {
    const indexes = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname='app' AND tablename='AppUser'
    `;
    expect(indexes.some((row) => /UNIQUE.*\("email"\)/.test(row.indexdef))).toBe(false);
    const oldId = id(); const newId = id();
    await db.appUser.create({ data: { id: oldId, email, role: 'ADMIN', onboarded: true } });
    auth.user = { id: newId, email };
    expect(await getCurrentUser()).toMatchObject({ id: newId, role: 'USER', onboarded: false });
    expect(await db.appUser.findUniqueOrThrow({ where: { id: oldId } })).toMatchObject({ role: 'ADMIN', onboarded: true, email });
  });
  it('updates only the UUID email, even when another UUID already has it', async () => {
    const a = id(); const b = id();
    await db.appUser.createMany({ data: [
      { id: a, email: `old-${email}`, role: 'ADMIN', status: 'SUSPENDED', displayName: 'Keep', onboarded: true },
      { id: b, email },
    ] });
    auth.user = { id: a, email };
    expect(await getCurrentUser()).toMatchObject({ id: a, email, role: 'ADMIN', status: 'SUSPENDED', displayName: 'Keep', onboarded: true });
    expect(await db.appUser.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ id: b, role: 'USER' });
  });
  it('uses atomic UUID upsert for parallel first guards', async () => {
    auth.user = { id: id(), email };
    const results = await Promise.all(Array.from({ length: 12 }, () => getCurrentUser()));
    expect(results.every((row) => row?.id === auth.user.id)).toBe(true);
    expect(await db.appUser.count({ where: { id: auth.user.id } })).toBe(1);
  });
  it('keeps old UUID learning ownership after delete/re-signup instead of restoring it by email', async () => {
    const oldId = id(); const newId = id();
    await db.appUser.create({ data: { id: oldId, email, role: 'ADMIN', onboarded: true,
      studyPlan: { create: { displayName: 'Old plan', dailyMinutes: 10, timezone: 'Asia/Seoul', weekdays: [1], anchorDate: '2026-11-01', startDate: '2026-11-01' } },
    } });
    auth.user = { id: newId, email };
    expect(await getCurrentUser()).toMatchObject({ id: newId, role: 'USER', onboarded: false });
    expect(await db.studyPlan.findUnique({ where: { userId: newId } })).toBeNull();
    expect(await db.studyPlan.findUniqueOrThrow({ where: { userId: oldId } })).toMatchObject({ displayName: 'Old plan' });
  });
});
