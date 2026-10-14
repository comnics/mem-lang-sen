/** Prevent content and platform setup from crossing Supabase projects. */
export function validatePlatformEnvironment(env: Record<string, string | undefined>, remoteProject?: string) {
  const urls = [env.DATABASE_URL, env.DIRECT_URL, env.NEXT_PUBLIC_SUPABASE_URL].map((value) => new URL(value ?? ''));
  const local = (url: URL) => ['localhost', '127.0.0.1'].includes(url.hostname);
  if (urls.every(local) && !remoteProject) return;
  if (!remoteProject || !/^[a-z0-9]{20}$/.test(remoteProject)) {
    throw new Error('Remote setup requires --remote-project=<Supabase project ref>.');
  }
  if (urls[2].hostname !== `${remoteProject}.supabase.co` || urls[2].protocol !== 'https:') {
    throw new Error('Auth/Storage URL does not match the requested remote project.');
  }
  for (const url of urls.slice(0, 2)) {
    const direct = url.hostname === `db.${remoteProject}.supabase.co`;
    const pooler = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).split('.').slice(1).join('.') === remoteProject;
    if ((!direct && !pooler) || url.searchParams.get('sslmode') !== 'verify-full') {
      throw new Error('Database project must match and use sslmode=verify-full.');
    }
  }
}

export function remoteProjectArgument() {
  return process.argv.find((arg) => arg.startsWith('--remote-project='))?.slice('--remote-project='.length);
}
