import 'server-only';
export function isConfigured() { return Boolean(process.env.DATABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY); }
export function appOrigin() { const value = process.env.APP_ORIGIN; if (!value) throw new Error('APP_ORIGIN is required'); return new URL(value).origin; }
