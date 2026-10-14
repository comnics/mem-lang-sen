import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

// Only the local Supabase CLI is a source for credentials. Never provision demo users remotely.
const status = JSON.parse(execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as Record<string, string>;
const apiUrl = status.API_URL;
const directUrl = status.DB_URL;
if (!apiUrl || !directUrl || !['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(directUrl).hostname)) throw new Error('Local Supabase is required. Run pnpm local:start.');
const secret = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
if (!secret || !publicKey) throw new Error('Supabase local keys are unavailable.');
const previous = existsSync('.env.local') ? parse(readFileSync('.env.local')) : {};
const previousUrl = previous.DATABASE_URL ? new URL(previous.DATABASE_URL) : null;
const reusePassword = previousUrl && previousUrl.username.split('.')[0] === 'app_runtime' && ['127.0.0.1', 'localhost'].includes(previousUrl.hostname) && decodeURIComponent(previousUrl.password).length >= 24;
const password = reusePassword
  ? decodeURIComponent(previousUrl.password) : randomBytes(32).toString('hex');
const runtimeUrl = new URL(directUrl);
runtimeUrl.username = 'app_runtime.pooler-dev';
runtimeUrl.port = '54329';
runtimeUrl.password = password;
// The pinned local Supabase CLI uses the pooler-dev tenant; hosted tenant is the project ref.
const env = { APP_ORIGIN: 'http://127.0.0.1:3100', NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secret, DATABASE_URL: runtimeUrl.toString(), DIRECT_URL: directUrl };
writeFileSync('.env.local', Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
chmodSync('.env.local', 0o600);
Object.assign(process.env, env);
execFileSync('pnpm', ['exec', 'prisma', 'generate'], { stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
const client = new Client({ connectionString: directUrl });
await client.connect();
try {
  const roleAlreadyExists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname='app_runtime'")).rowCount === 1;
  await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN CREATE ROLE app_runtime LOGIN; END IF; END $$;");
  const role = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='app_runtime'")).rows[0];
  if (Object.values(role).some(Boolean)) throw new Error('Existing app_runtime has elevated privileges; use a restricted role.');
  if (!roleAlreadyExists || !reusePassword) {
    await client.query(`ALTER ROLE app_runtime WITH PASSWORD '${password.replaceAll("'", "''")}';`);
  }
  await client.query('REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated; GRANT USAGE ON SCHEMA app TO app_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;');
  const supabase = createClient(apiUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  const bucketOptions = { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'] };
  const bucketResult = buckets?.some((bucket) => bucket.id === 'sentence-audio')
    ? await supabase.storage.updateBucket('sentence-audio', bucketOptions)
    : await supabase.storage.createBucket('sentence-audio', bucketOptions);
  if (bucketResult.error) throw bucketResult.error;
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const [email, role, name] of [['admin@example.test', 'ADMIN', '정원 관리자'], ['learner@example.test', 'USER', '학습자'], ['other@example.test', 'USER', '다른 학습자']] as const) {
    let user = data.users.find((candidate) => candidate.email === email);
    if (!user) {
      const created = await supabase.auth.admin.createUser({ email, password: 'LocalStudy!2026', email_confirm: true, user_metadata: { displayName: name } });
      if (created.error || !created.data.user) throw created.error ?? new Error('User creation failed.');
      user = created.data.user;
    }
    await client.query('INSERT INTO app."AppUser" (id,email,"displayName",role,status,"onboarded","createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'ACTIVE\',false,now(),now()) ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role', [user.id, email, name, role]);
  }
} finally { await client.end(); }
execFileSync('pnpm', ['db:seed'], { stdio: 'inherit' });
console.log('Local environment ready. Credentials are in .env.local (not printed). Demo accounts: admin@example.test / learner@example.test / other@example.test; local-only password: LocalStudy!2026');
