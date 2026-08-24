import { isAbsolute, resolve } from "node:path";
import { createDb, FsBlobStore, parseEncKey } from "@congruo/db";
import { PgBoss } from "pg-boss";
import { exportPdf } from "./pdf";
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
const blobDir = process.env.BLOB_DIR ?? ".data/blobs";
const blobs = new FsBlobStore(
  isAbsolute(blobDir) ? blobDir : resolve(process.cwd(), "../..", blobDir),
);
const encKeys = { 1: parseEncKey(encKeyV1) };

// Recovery sweep: a crashed run must not leave source checkouts behind.
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

try {
  for (const entry of await readdir(tmpdir())) {
    if (entry.startsWith("congruo-clone-")) {
      await rm(resolve(tmpdir(), entry), { recursive: true, force: true });
      console.log(`swept orphaned checkout ${entry}`);
    }
  }
} catch (e) {
  console.error("clone sweep failed:", e);
}

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

await boss.createQueue("export-pdf", { retryLimit: 1, expireInSeconds: 600 });
await boss.work<{ snapshotId: string; token: string; tokenHash: string }>(
  "export-pdf",
  async ([job]) => {
    if (!job) return;
    const key = await exportPdf(
      {
        db,
        blobs,
        webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3000",
      },
      job.data,
    );
    console.log(`pdf exported: ${key}`);
  },
);

console.log("congruo worker: listening on queue 'audit'");
