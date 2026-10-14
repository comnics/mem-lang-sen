import { describe, expect, it } from 'vitest';
import { validatePlatformEnvironment } from '../../scripts/platform/environment';

const project = 'abcdefghijklmnopqrst';
const remote = {
  DATABASE_URL: `postgresql://app_runtime.${project}:password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
  DIRECT_URL: `postgresql://postgres:password@db.${project}.supabase.co/postgres?sslmode=verify-full`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
};

describe('platform environment boundary', () => {
  it('allows a fully local environment', () => {
    expect(() => validatePlatformEnvironment({ DATABASE_URL: 'postgresql://localhost/db', DIRECT_URL: 'postgresql://localhost/db', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })).not.toThrow();
  });
  it('requires an explicit matching remote project', () => {
    expect(() => validatePlatformEnvironment(remote)).toThrow();
    expect(() => validatePlatformEnvironment(remote, project)).not.toThrow();
  });
  it('rejects mixed projects, local APIs and unverified TLS', () => {
    for (const patch of [
      { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
      { DIRECT_URL: remote.DIRECT_URL.replace(project, 'zyxwvutsrqponmlkjihg') },
      { DATABASE_URL: remote.DATABASE_URL.replace('verify-full', 'require') },
    ]) expect(() => validatePlatformEnvironment({ ...remote, ...patch }, project)).toThrow();
  });
});
