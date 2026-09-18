import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client for the process.
 *
 * Next reloads modules on every change in development, and a new client per
 * reload exhausts the database's connection limit within a few minutes.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
