import 'server-only';

export function devLoginEnabled() {
  return process.env.NODE_ENV === 'development' && !process.env.VERCEL;
}

export function devLoginCredentials(role: 'USER' | 'ADMIN') {
  if (!devLoginEnabled()) return null;
  const email = process.env[`DEV_LOGIN_${role}_EMAIL`];
  const password = process.env[`DEV_LOGIN_${role}_PASSWORD`];
  return email && password ? { email, password } : null;
}
