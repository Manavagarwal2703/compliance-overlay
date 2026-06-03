import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 7 uses a Wasm-based "client" engine that requires a driver adapter.
 * The native Rust "library" engine was removed in Prisma 7.
 *
 * We use @prisma/adapter-pg so the client engine can talk to PostgreSQL,
 * whether the database is running on Supabase or Docker — just point
 * DATABASE_URL at the right host.
 *
 * DATABASE_URL examples:
 *   Supabase: postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *   Docker:   postgresql://postgres:<pw>@localhost:5432/postgres
 *
 * Singleton pattern: in development Next.js hot-reloads create new module
 * instances on every save. Without this, each reload leaks a new connection
 * pool. We attach the instance to `globalThis` so it survives reloads.
 */

const globalForPrisma = globalThis as unknown as {
  __prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. " +
        "Add it to .env (Supabase URL or Docker postgres URL)."
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}
