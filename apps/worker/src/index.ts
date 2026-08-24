import { createDb, FsBlobStore, parseEncKey } from "@congruo/db";
import { PgBoss } from "pg-boss";
import { executeAuditRun } from "./pipeline";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  // production: env comes from the host
}

const databaseUrl = process.env.DATABASE_URL;
const encKeyV1 = process.env.TOKEN_ENC_KEY_V1;
if (!databaseUrl || !encKeyV1) {
  throw new Error("DATABASE_URL and TOKEN_ENC_KEY_V1 must be set");
}

const db = createDb(databaseUrl);
const blobs = new FsBlobStore(process.env.BLOB_DIR ?? ".data/blobs");
const encKeys = { 1: parseEncKey(encKeyV1) };

const boss = new PgBoss({ connectionString: databaseUrl });
boss.on("error", (e) => console.error("pg-boss:", e));
await boss.start();
await boss.createQueue("audit", {
  retryLimit: 2,
  retryDelay: 30,
  expireInSeconds: 7200, // long audits: never expire mid-run at the 15m default
});

await boss.work<{ runId: string }>("audit", async ([job]) => {
  if (!job) return;
  console.log(`audit run ${job.data.runId} starting`);
  const { snapshotId } = await executeAuditRun(
    { db, blobs, encKeys },
    job.data.runId,
  );
  console.log(`audit run ${job.data.runId} sealed snapshot ${snapshotId}`);
});

console.log("congruo worker: listening on queue 'audit'");
