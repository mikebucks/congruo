import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BlobStore } from "@congruo/core";
import { encryptToken, schema } from "@congruo/db";
import { createTestDb } from "@congruo/db/test-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { executeAuditRun } from "./pipeline";

const fixtureRaw = readFileSync(
  new URL("../../../fixtures/figma/polaris-ui-kit.json", import.meta.url),
  "utf8",
);
const acmeRoot = fileURLToPath(
  new URL("../../../fixtures/acme-ds", import.meta.url),
);

const encKey = randomBytes(32);
const blobs: BlobStore = {
  put: async () => {},
  get: async () => new Uint8Array(),
  exists: async () => false,
};

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;

beforeAll(async () => {
  ctx = await createTestDb("congruo_test_pipeline");
  const [ws] = await ctx.db
    .insert(schema.workspaces)
    .values({ name: "pipeline" })
    .returning();
  if (!ws) throw new Error("workspace insert failed");
  workspaceId = ws.id;
  await ctx.db.insert(schema.connections).values([
    {
      workspaceId,
      provider: "figma",
      encryptedToken: encryptToken("fake-pat", encKey, 1),
      keyVersion: 1,
      config: { libraryFileKey: "LIB", consumerFileKeys: ["CONSUMER"] },
    },
    {
      workspaceId,
      provider: "github",
      encryptedToken: encryptToken("unused", encKey, 1),
      keyVersion: 1,
      config: {
        rootDir: acmeRoot,
        repo: "acme/acme-ds",
        sha: "local",
        dsPackage: { name: "@acme/ui", srcGlob: "packages/ui/src/**/*.{ts,tsx}" },
        appGlob: "app/src/**/*.tsx",
      },
    },
  ]);
});
afterAll(() => ctx.close());

const fixtureFetch: typeof fetch = async (url) =>
  String(url).includes("/v1/files/")
    ? new Response(fixtureRaw, { status: 200 })
    : new Response("nope", { status: 404 });

const deps = () => ({
  db: ctx.db,
  blobs,
  encKeys: { 1: encKey },
  figmaFetch: fixtureFetch,
});

async function createRun(id: string) {
  await ctx.db
    .insert(schema.auditRuns)
    .values({ id, workspaceId, status: "queued" });
}

test("full pipeline seals a snapshot with findings from all three analyzers", async () => {
  await createRun("run-1");
  const { snapshotId } = await executeAuditRun(deps(), "run-1");

  const run = await ctx.db.query.auditRuns.findFirst({
    where: eq(schema.auditRuns.id, "run-1"),
  });
  expect(run?.status).toBe("succeeded");

  const findings = await ctx.db.query.findingOccurrences.findMany({
    where: eq(schema.findingOccurrences.snapshotId, snapshotId),
  });
  const types = new Set(findings.map((f) => f.type));
  expect(types).toContain("MISSING_IN_CODE");
  expect(types).toContain("HARDCODED_VALUE_CODE");
  expect(types).toContain("UNUSED_COMPONENT");
  expect(findings.every((f) => f.firstSeenSnapshotId === snapshotId)).toBe(
    true,
  );

  const sources = await ctx.db.query.snapshotSources.findMany({
    where: eq(schema.snapshotSources.snapshotId, snapshotId),
  });
  // LIB + CONSUMER figma files, ds-package + app code artifacts
  expect(sources).toHaveLength(4);
});

test("re-executing a sealed run returns the same snapshot — no duplicates", async () => {
  const first = await executeAuditRun(deps(), "run-1");
  const again = await executeAuditRun(deps(), "run-1");
  expect(again.snapshotId).toBe(first.snapshotId);
  const all = await ctx.db.query.snapshots.findMany({
    where: eq(schema.snapshots.workspaceId, workspaceId),
  });
  expect(all).toHaveLength(1);
});

test("a second audit preserves firstSeenSnapshot for persisting findings", async () => {
  await createRun("run-2");
  const { snapshotId } = await executeAuditRun(deps(), "run-2");
  const firstSnapshot = await ctx.db.query.snapshots.findFirst({
    where: eq(schema.snapshots.runId, "run-1"),
  });
  const findings = await ctx.db.query.findingOccurrences.findMany({
    where: eq(schema.findingOccurrences.snapshotId, snapshotId),
  });
  expect(findings.length).toBeGreaterThan(0);
  expect(
    findings.every((f) => f.firstSeenSnapshotId === firstSnapshot?.id),
  ).toBe(true);
});

test("mid-run failure marks the run failed and seals nothing", async () => {
  const failing: typeof fetch = async () => {
    throw new Error("network died");
  };
  await createRun("run-fail");
  await expect(
    executeAuditRun({ ...deps(), figmaFetch: failing }, "run-fail"),
  ).rejects.toThrow("network died");

  const run = await ctx.db.query.auditRuns.findFirst({
    where: eq(schema.auditRuns.id, "run-fail"),
  });
  expect(run?.status).toBe("failed");
  expect(run?.error).toContain("network died");
  const snapshot = await ctx.db.query.snapshots.findFirst({
    where: eq(schema.snapshots.runId, "run-fail"),
  });
  expect(snapshot).toBeUndefined();
});
