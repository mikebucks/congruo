import { rm } from "node:fs/promises";
import type { CanonicalGraph, MappingSetRevision } from "@congruo/core";
import { FINGERPRINT_VERSION } from "@congruo/core";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { FsBlobStore } from "./blob-store.js";
import * as schema from "./schema.js";
import { createTestDb } from "./test-db.js";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(() => ctx.close());

const emptyExtract = {
  artifacts: [],
  definitions: [],
  usages: [],
  tokens: [],
  diagnostics: [],
  rawPayloadRefs: [],
};

const mappingSetV1: MappingSetRevision = {
  revision: 1,
  mappings: [
    {
      figmaRef: { kind: "figma", fileKey: "f1", componentKey: "k1" },
      codeRef: {
        kind: "code",
        repo: "acme/ui",
        pkg: "@acme/ui",
        exportSymbol: "Button",
        filePath: "src/Button.tsx",
      },
      confidence: 1,
      source: "user",
      propMappings: [],
    },
  ],
  statuses: [],
  tokenMappings: [],
};

async function sealSnapshot(runId: string) {
  const { db } = ctx;
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: "test" })
    .returning();
  if (!ws) throw new Error("workspace insert failed");

  await db.insert(schema.mappingSetRevisions).values({
    workspaceId: ws.id,
    revision: 1,
    data: mappingSetV1,
  });

  await db.insert(schema.auditRuns).values({
    id: runId,
    workspaceId: ws.id,
    status: "succeeded",
  });

  const graph: CanonicalGraph = { figma: emptyExtract, code: emptyExtract };
  const [snap] = await db
    .insert(schema.snapshots)
    .values({
      runId,
      workspaceId: ws.id,
      schemaVersion: 1,
      fingerprintVersion: FINGERPRINT_VERSION,
      mappingSet: mappingSetV1,
      analyzerConfig: {},
      rubric: {},
    })
    .returning();
  if (!snap) throw new Error("snapshot insert failed");
  await db.insert(schema.snapshotGraphs).values({ snapshotId: snap.id, graph });
  return { ws, snap, graph };
}

test("snapshot round-trip: graph and frozen mapping set deep-equal", async () => {
  const { snap, graph } = await sealSnapshot("run-roundtrip");
  const loaded = await ctx.db.query.snapshots.findFirst({
    where: eq(schema.snapshots.id, snap.id),
  });
  const loadedGraph = await ctx.db.query.snapshotGraphs.findFirst({
    where: eq(schema.snapshotGraphs.snapshotId, snap.id),
  });
  expect(loaded?.mappingSet).toEqual(mappingSetV1);
  expect(loadedGraph?.graph).toEqual(graph);
});

test("self-containment: editing the working mapping set never alters a sealed snapshot", async () => {
  const { ws, snap } = await sealSnapshot("run-selfcontained");
  const frozen = structuredClone(
    (
      await ctx.db.query.snapshots.findFirst({
        where: eq(schema.snapshots.id, snap.id),
      })
    )?.mappingSet,
  );

  const mappingSetV2: MappingSetRevision = {
    ...mappingSetV1,
    revision: 2,
    mappings: [],
    statuses: [
      {
        ref: { kind: "figma", fileKey: "f1", componentKey: "k1" },
        status: "deprecated",
      },
    ],
  };
  await ctx.db.insert(schema.mappingSetRevisions).values({
    workspaceId: ws.id,
    revision: 2,
    data: mappingSetV2,
  });

  const current = await ctx.db.query.mappingSetRevisions.findFirst({
    where: eq(schema.mappingSetRevisions.workspaceId, ws.id),
    orderBy: desc(schema.mappingSetRevisions.revision),
  });
  expect(current?.data).toEqual(mappingSetV2);

  const sealed = await ctx.db.query.snapshots.findFirst({
    where: eq(schema.snapshots.id, snap.id),
  });
  expect(sealed?.mappingSet).toEqual(frozen);
  expect(sealed?.mappingSet).toEqual(mappingSetV1);
});

test("blob store round-trips and rejects escaping keys", async () => {
  const root = new URL("../.test-blobs", import.meta.url).pathname;
  const blobs = new FsBlobStore(root);
  await blobs.put("figma/f1/raw.json", '{"ok":true}');
  expect(new TextDecoder().decode(await blobs.get("figma/f1/raw.json"))).toBe(
    '{"ok":true}',
  );
  expect(await blobs.exists("figma/f1/raw.json")).toBe(true);
  expect(await blobs.exists("nope")).toBe(false);
  await expect(blobs.put("../escape.txt", "x")).rejects.toThrow();
  await rm(root, { recursive: true, force: true });
});
