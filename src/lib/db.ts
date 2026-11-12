/**
 * PURPOSE
 * A single shared Prisma client. In development Next.js hot-reloads modules, which would open a
 * new database connection pool on every edit; caching the client on `globalThis` prevents that
 * (important on Render's free Postgres, which has a low connection limit).
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
