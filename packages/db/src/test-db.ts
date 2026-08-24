import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema.js";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://congruo:congruo@localhost:5432/congruo";

/** Drops and recreates congruo_test, runs migrations, returns a client. */
export async function createTestDb() {
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query("DROP DATABASE IF EXISTS congruo_test");
  await admin.query("CREATE DATABASE congruo_test");
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = "/congruo_test";
  const pool = new Pool({ connectionString: url.toString() });
  const db = drizzle(pool, { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  return { db, close: () => pool.end() };
}
