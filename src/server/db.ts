import 'server-only';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalForDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForDb.prisma ?? new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL, max:3, connectionTimeoutMillis:5000, idleTimeoutMillis:10000})});
if (process.env.NODE_ENV !== 'production') globalForDb.prisma = db;
