import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://congruo:congruo@localhost:5432/congruo";

/** Drops and recreates a per-suite test database, runs migrations, returns a
 * client. Distinct names keep parallel test files from clobbering each other. */
export async function createTestDb(name = "congruo_test") {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`bad test db name: ${name}`);
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  const db = drizzle(pool, { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  return { db, close: () => pool.end() };
}
