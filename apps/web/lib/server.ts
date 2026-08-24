import { createDb, type Db, parseEncKey } from "@congruo/db";
import { PgBoss } from "pg-boss";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  // production: env comes from the host
}

const globals = globalThis as unknown as {
  __congruoDb?: Db;
  __congruoBoss?: PgBoss;
};

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return url;
}

export function db(): Db {
  globals.__congruoDb ??= createDb(databaseUrl());
  return globals.__congruoDb;
}

export function encKeys(): Record<number, Buffer> {
  const v1 = process.env.TOKEN_ENC_KEY_V1;
  if (!v1) throw new Error("TOKEN_ENC_KEY_V1 not set");
  return { 1: parseEncKey(v1) };
}

export async function boss(): Promise<PgBoss> {
  if (!globals.__congruoBoss) {
    const b = new PgBoss({ connectionString: databaseUrl() });
    await b.start();
    await b.createQueue("audit", {
      retryLimit: 2,
      retryDelay: 30,
      expireInSeconds: 7200,
    });
    globals.__congruoBoss = b;
  }
  return globals.__congruoBoss;
}
