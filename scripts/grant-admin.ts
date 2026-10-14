import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
config({ path: '.env.local', quiet: true });
config({ quiet: true });
const userId = process.argv[2];
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Usage: pnpm admin:grant <confirmed Supabase Auth user UUID>');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const { data, error } = await supabase.auth.admin.getUserById(userId);
if (error || !data.user?.email || !data.user.email_confirmed_at) throw new Error('A confirmed Supabase Auth user is required.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) });
try {
  await db.appUser.upsert({ where: { id: userId }, create: { id: userId, email: data.user.email, role: 'ADMIN' }, update: { role: 'ADMIN' } });
  console.log('Administrator role granted to the specified verified Auth user.');
} finally { await db.$disconnect(); }
