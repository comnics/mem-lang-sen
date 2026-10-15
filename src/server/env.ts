import 'server-only';
export function isConfigured() { return Boolean(process.env.DATABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY); }
// Use the destination address, never the caller's Origin header.
export function appOrigin(request: Request) {
 const url = new URL(request.url);
 const host = request.headers.get('host');
 if (host) {
  const destination = new URL(`${url.protocol}//${host}`);
  if (destination.host !== host || destination.username || destination.password) throw new Error('Invalid request host');
  url.host = destination.host;
 }
 if (process.env.VERCEL === '1') url.protocol = 'https:';
 return url.origin;
}
