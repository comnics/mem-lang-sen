import 'server-only';

export function devLoginEnabled() {
  if (process.env.NODE_ENV !== 'development' || process.env.VERCEL) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.APP_ORIGIN ?? '').hostname);
  } catch {
    return false;
  }
}

export function devLoginCredentials(role: 'USER' | 'ADMIN') {
  if (!devLoginEnabled()) return null;
  const email = process.env[`DEV_LOGIN_${role}_EMAIL`];
  const password = process.env[`DEV_LOGIN_${role}_PASSWORD`];
  return email && password ? { email, password } : null;
}
