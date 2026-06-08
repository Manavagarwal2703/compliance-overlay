import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 7 uses a Wasm-based "client" engine that requires a driver adapter.
 * The native Rust "library" engine was removed in Prisma 7.
 *
 * We use @prisma/adapter-better-sqlite3 so the client engine can talk to a local
 * SQLite database via the better-sqlite3 driver.
 *
 * DATABASE_URL examples:
 *   SQLite: file:./gateway_db.sqlite
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
        "Add it to .env (SQLite file path)."
    );
  }

  const dbPath = connectionString.startsWith('file:') ? connectionString.replace('file:', '') : connectionString;
  const adapter = new PrismaBetterSqlite3({ url: dbPath });

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
