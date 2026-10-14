import { config } from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { remoteProjectArgument, validatePlatformEnvironment } from './platform/environment';
config({ path: '.env.local', quiet: true });
config({ quiet: true });
const databaseOnly = process.argv.includes('--database-only');
if (!databaseOnly) validatePlatformEnvironment(process.env, remoteProjectArgument());
const runtime = new URL(process.env.DATABASE_URL!);
if (decodeURIComponent(runtime.username).split('.')[0] !== 'app_runtime') throw new Error('DATABASE_URL must use the dedicated app_runtime role.');
const password = decodeURIComponent(runtime.password);
if (password.length < 24) throw new Error('Use a random runtime DB password of at least 24 characters.');
const client = new Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  const existingRole = (await client.query("SELECT 1 FROM pg_roles WHERE rolname='app_runtime'")).rowCount === 1;
  let passwordAlreadyValid = false;
  if (existingRole) {
    const checkUrl = new URL(process.env.DIRECT_URL!);
    checkUrl.username = checkUrl.username.includes('.') ? `app_runtime.${checkUrl.username.split('.').slice(1).join('.')}` : 'app_runtime';
    checkUrl.password = password;
    const check = new Client({ connectionString: checkUrl.toString(), connectionTimeoutMillis: 5000 });
    try { await check.connect(); passwordAlreadyValid = true; } catch { /* Provision a new password below. */ } finally { await check.end(); }
  }
  await client.query('BEGIN');
  await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN CREATE ROLE app_runtime LOGIN; END IF; END $$;");
  // Password is quoted as an SQL literal; never interpolate arbitrary role identifiers.
  const role = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='app_runtime'")).rows[0];
  if (Object.values(role).some(Boolean)) throw new Error('Existing app_runtime has elevated privileges; use a restricted role.');
  if (!passwordAlreadyValid) await client.query(`ALTER ROLE app_runtime WITH PASSWORD '${password.replaceAll("'", "''")}'`);
  await client.query('REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated; GRANT USAGE ON SCHEMA app TO app_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;');
  await client.query('COMMIT');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
if (databaseOnly) {
  console.log('Restricted app_runtime role configured; Storage was not changed.');
  process.exit(0);
}
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } }).storage;
const { data, error } = await storage.listBuckets();
if (error) throw error;
const options = { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'] };
const result = data.some((bucket) => bucket.id === 'sentence-audio') ? await storage.updateBucket('sentence-audio', options) : await storage.createBucket('sentence-audio', options);
if (result.error) throw result.error;
console.log('Restricted app_runtime role and private sentence-audio bucket configured.');
