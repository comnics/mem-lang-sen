import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Page } from '@playwright/test';

const localHosts = ['127.0.0.1', 'localhost'];
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const directUrl = process.env.DIRECT_URL;
if (!supabaseUrl || !directUrl || ![origin, supabaseUrl, directUrl].every((url) => localHosts.includes(new URL(url).hostname))) {
  throw new Error('Auth lifecycle E2E requires isolated local app, Supabase Auth and PostgreSQL.');
}
const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const password = 'LocalAuthLifecycle!2026';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/(today|onboarding|admin)$/);
}

for (const lifecycle of ['email-change', 'delete-rejoin'] as const) {
  test(`Auth ${lifecycle}: reused email never transfers UUID privileges or learning data`, async ({ browser }) => {
    const email = `${randomUUID()}@auth.e2e.test`;
    const ids: string[] = [];
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    const sql = new Client({ connectionString: directUrl });
    await sql.connect();
    async function createUser(address: string) {
      const { data, error } = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
      expect(error).toBeNull(); expect(data.user).not.toBeNull();
      ids.push(data.user!.id); return data.user!.id;
    }
    try {
      const a = await createUser(email);
      const first = await browser.newContext(); contexts.push(first);
      await login(await first.newPage(), email);
      // Give A a distinctive role/profile and a real owned plan; B must inherit none of them.
      await sql.query('UPDATE app."AppUser" SET role=\'ADMIN\', onboarded=true, "displayName"=\'Original A\' WHERE id=$1', [a]);
      await sql.query('INSERT INTO app."StudyPlan" ("userId","displayName","dailyMinutes",timezone,weekdays,"anchorDate","startDate","updatedAt") VALUES ($1,\'Original plan\',10,\'Asia/Seoul\',ARRAY[1],\'2026-11-01\',\'2026-11-01\',now())', [a]);
      if (lifecycle === 'email-change') {
        const changed = await admin.auth.admin.updateUserById(a, { email: `changed-${email}`, email_confirm: true });
        expect(changed.error).toBeNull();
      } else {
        expect((await admin.auth.admin.deleteUser(a)).error).toBeNull();
      }
      // A intentionally does not refresh after the lifecycle event: its AppUser email is stale.
      const b = await createUser(email);
      expect(b).not.toBe(a);
      const second = await browser.newContext(); contexts.push(second);
      const page = await second.newPage();
      await login(page, email);
      const current = await sql.query('SELECT id,email,role,status,onboarded FROM app."AppUser" WHERE id=$1', [b]);
      expect(current.rows).toEqual([{ id: b, email, role: 'USER', status: 'ACTIVE', onboarded: false }]);
      expect((await sql.query('SELECT "userId" FROM app."StudyPlan" WHERE "userId"=ANY($1::uuid[])', [[a,b]])).rows).toEqual([{ userId: a }]);
      expect((await sql.query('SELECT role,onboarded FROM app."AppUser" WHERE id=$1', [a])).rows).toEqual([{ role: 'ADMIN', onboarded: true }]);
      expect((await page.request.get('/api/v1/admin/sets')).status()).toBe(403);
      await page.goto('/admin');
      await expect(page).not.toHaveURL(/\/admin/);
      if (lifecycle === 'email-change') {
        const third = await browser.newContext(); contexts.push(third);
        await login(await third.newPage(), `changed-${email}`);
        expect((await sql.query('SELECT email FROM app."AppUser" WHERE id=$1', [a])).rows).toEqual([{ email: `changed-${email}` }]);
      }
    } finally {
      for (const context of contexts) await context.close();
      try {
        for (const id of ids) {
          const result = await admin.auth.admin.deleteUser(id);
          if (result.error && result.error.status !== 404) throw result.error;
        }
      } finally {
        try { await sql.query('DELETE FROM app."AppUser" WHERE id=ANY($1::uuid[])', [ids]); }
        finally { await sql.end(); }
      }
    }
  });
}
