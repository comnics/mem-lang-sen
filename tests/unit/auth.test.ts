import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  configured: true,
  user: null as null | { id: string; email?: string; user_metadata?: Record<string, unknown> },
  error: null as null | Error,
}));
const database = vi.hoisted(() => ({
  appUser: { findUnique: vi.fn(), createMany: vi.fn(), findUniqueOrThrow: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: auth.user }, error: auth.error }),
} }) }));
vi.mock('@/server/env', () => ({ isConfigured: () => auth.configured }));
vi.mock('@/server/db', () => ({ db: database }));

import { getCurrentUser, requireAdmin, requireUser } from '@/server/auth';

type Row = { id: string; email: string; displayName: string | null; role: string; status: string; onboarded: boolean };
const rows = new Map<string, Row>();
// This double models both schemas so running against pre-fix code actually reproduces the collision.
const uniqueEmail = /email\s+String\s+@unique/.test(readFileSync('prisma/schema.prisma', 'utf8'));
function insert(data: Partial<Row> & { id: string; email: string }) {
  const row: Row = { displayName: null, role: 'USER', status: 'ACTIVE', onboarded: false, ...data };
  rows.set(row.id, row);
  return row;
}
function duplicate(data: { id: string; email: string }) {
  return rows.has(data.id) || (uniqueEmail && [...rows.values()].some((row) => row.email === data.email));
}
beforeEach(() => {
  vi.clearAllMocks(); rows.clear(); auth.configured = true; auth.error = null;
  auth.user = { id: 'uuid-B', email: 'shared@example.test', user_metadata: { displayName: 'New user', role: 'ADMIN' } };
  database.appUser.findUnique.mockImplementation(async ({ where }) => rows.get(where.id) ?? null);
  database.appUser.findUniqueOrThrow.mockImplementation(async ({ where }) => {
    const row = rows.get(where.id); if (!row) throw new Error('UUID not found'); return row;
  });
  database.appUser.createMany.mockImplementation(async ({ data }) => {
    let count = 0;
    for (const row of data) if (!duplicate(row)) { insert(row); count++; }
    return { count };
  });
  database.appUser.upsert.mockImplementation(async ({ where, create, update }) => {
    const existing = rows.get(where.id);
    if (existing) {
      if (uniqueEmail && [...rows.values()].some((row) => row.id !== where.id && row.email === update.email)) throw new Error('email unique violation');
      return insert({ ...existing, ...update });
    }
    if (duplicate(create)) throw new Error('email unique violation');
    return insert(create);
  });
});

describe('UUID-only Auth provisioning and email lifecycle', () => {
  it('provisions B even if A has not logged in to sync its changed email', async () => {
    const original = insert({ id: 'uuid-A', email: 'shared@example.test', role: 'ADMIN', onboarded: true });
    const result = await getCurrentUser();
    expect(result).toMatchObject({ id: 'uuid-B', email: 'shared@example.test', role: 'USER', onboarded: false });
    expect(rows.get('uuid-A')).toEqual(original);
    expect(rows.size).toBe(2);
  });
  it('syncs an existing UUID email while preserving role, suspension and profile', async () => {
    insert({ id: 'uuid-B', email: 'old@example.test', role: 'ADMIN', status: 'SUSPENDED', onboarded: true, displayName: 'App profile' });
    expect(await getCurrentUser()).toEqual({ id: 'uuid-B', email: 'shared@example.test', role: 'ADMIN', status: 'SUSPENDED', onboarded: true, displayName: 'App profile' });
  });
  it('treats deletion and re-signup as a new UUID, never restores previous admin access', async () => {
    insert({ id: 'deleted-auth-uuid', email: 'shared@example.test', role: 'ADMIN', onboarded: true });
    expect(await requireUser()).toMatchObject({ id: 'uuid-B', role: 'USER', onboarded: false });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    expect(rows.get('deleted-auth-uuid')).toMatchObject({ role: 'ADMIN', onboarded: true });
  });
  it('syncs A later without changing B', async () => {
    insert({ id: 'uuid-A', email: 'shared@example.test' });
    await getCurrentUser();
    auth.user = { id: 'uuid-A', email: 'changed@example.test' };
    expect(await getCurrentUser()).toMatchObject({ id: 'uuid-A', email: 'changed@example.test' });
    expect(rows.get('uuid-B')).toMatchObject({ email: 'shared@example.test' });
  });
  it('is idempotent for concurrent first requests of the same UUID', async () => {
    const result = await Promise.all(Array.from({ length: 12 }, () => getCurrentUser()));
    expect(result.every((row) => row?.id === 'uuid-B')).toBe(true);
    expect(rows.size).toBe(1);
  });
  it('permits different UUIDs with no email without linking them', async () => {
    insert({ id: 'uuid-A', email: '' });
    auth.user = { id: 'uuid-B' };
    expect(await getCurrentUser()).toMatchObject({ id: 'uuid-B', email: '', role: 'USER' });
    expect(rows.size).toBe(2);
  });
  it('bounds displayName only on creation and ignores metadata privileges', async () => {
    auth.user!.user_metadata = { displayName: 'x'.repeat(100), role: 'ADMIN', status: 'ACTIVE' };
    expect(await getCurrentUser()).toMatchObject({ displayName: 'x'.repeat(80), role: 'USER' });
  });
  it('still rejects suspended accounts after email synchronization', async () => {
    insert({ id: 'uuid-B', email: 'old@example.test', status: 'SUSPENDED' });
    await expect(requireUser()).rejects.toMatchObject({ status: 403 });
  });
  it.each(['unconfigured', 'no-user', 'auth-error'])('does not provision when %s', async (mode) => {
    if (mode === 'unconfigured') auth.configured = false;
    if (mode === 'no-user') auth.user = null;
    if (mode === 'auth-error') auth.error = new Error('invalid token');
    expect(await getCurrentUser()).toBeNull();
    expect(rows.size).toBe(0);
    expect(database.appUser.upsert).not.toHaveBeenCalled();
  });
  it('propagates DB failures instead of silently returning another email owner', async () => {
    database.appUser.upsert.mockRejectedValue(new Error('database unavailable'));
    database.appUser.createMany.mockRejectedValue(new Error('database unavailable'));
    await expect(getCurrentUser()).rejects.toThrow('database unavailable');
  });
});
