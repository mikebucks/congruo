import { randomUUID } from "node:crypto";
import { runAnalyzers } from "@congruo/analyzers";
import type {
  BlobStore,
  CanonicalGraph,
  Dimension,
  MappingSetRevision,
} from "@congruo/core";
import {
  applyIgnores,
  DEFAULT_MATCHER_CONFIG,
  FINGERPRINT_VERSION,
  type MatcherConfig,
  proposeMappings,
  proposeTokenMappings,
  refKey,
  tokenKey,
} from "@congruo/core";
import type { Db } from "@congruo/db";
import { decryptToken, schema } from "@congruo/db";
import {
  type CloneConfig,
  CodeAdapter,
  type CodeConfig,
  cloneAndExtract,
} from "@congruo/ingest-code";
import { FigmaAdapter, type FigmaConfig } from "@congruo/ingest-figma";
import {
  computeCoverage,
  computeScores,
  rubric,
  severityWeights,
} from "@congruo/scoring";
import { desc, eq, inArray } from "drizzle-orm";

export interface AuditDeps {
  db: Db;
  blobs: BlobStore;
  encKeys: Record<number, Buffer>;
  /** Test seam: fixture replay instead of the live Figma API. */
  figmaFetch?: typeof fetch;
}

const SCHEMA_VERSION = 1;

export async function executeAuditRun(
  deps: AuditDeps,
  runId: string,
): Promise<{ snapshotId: string }> {
  const { db } = deps;
  const run = await db.query.auditRuns.findFirst({
    where: eq(schema.auditRuns.id, runId),
  });
  if (!run) throw new Error(`unknown audit run ${runId}`);

  // Idempotency: a retry of a sealed run returns the existing snapshot.
  const existing = await db.query.snapshots.findFirst({
    where: eq(schema.snapshots.runId, runId),
  });
  if (existing) return { snapshotId: existing.id };

  if (run.status === "cancelled") return { snapshotId: "" };

  await setStatus(db, runId, "running");
  try {
    const result = await runPipeline(deps, run.workspaceId, runId);
    await setStatus(db, runId, "succeeded");
    return result;
  } catch (e) {
    if (e instanceof RunCancelled) {
      return { snapshotId: "" }; // status already cancelled; nothing sealed
    }
    await db
      .update(schema.auditRuns)
      .set({ status: "failed", error: String(e), updatedAt: new Date() })
      .where(eq(schema.auditRuns.id, runId));
    throw e;
  }
}

class RunCancelled extends Error {}

/** Checked between pipeline stages: a user cancel takes effect before the
 * next expensive step and always before sealing. */
async function assertNotCancelled(db: Db, runId: string): Promise<void> {
  const run = await db.query.auditRuns.findFirst({
    where: eq(schema.auditRuns.id, runId),
  });
  if (run?.status === "cancelled") throw new RunCancelled();
}

async function setStatus(
  db: Db,
  runId: string,
  status: "running" | "succeeded",
) {
  await db
    .update(schema.auditRuns)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.auditRuns.id, runId));
}

async function runPipeline(
  deps: AuditDeps,
  workspaceId: string,
  runId: string,
): Promise<{ snapshotId: string }> {
  const { db, blobs } = deps;
  const connections = await db.query.connections.findMany({
    where: eq(schema.connections.workspaceId, workspaceId),
  });
  const figmaConn = connections.find((c) => c.provider === "figma");
  const codeConn = connections.find((c) => c.provider === "github");
  if (!figmaConn || !codeConn) {
    throw new Error("workspace needs one figma and one github connection");
  }

  // 1. Ingest both sides
  const figmaConfig: FigmaConfig = {
    pat: decryptToken(figmaConn.encryptedToken, deps.encKeys),
    libraryFileKey: String(figmaConn.config.libraryFileKey),
    consumerFileKeys: (figmaConn.config.consumerFileKeys as string[]) ?? [],
  };
  const figma = await new FigmaAdapter(deps.figmaFetch).extract(figmaConfig, {
    blobs,
  });
  // repoUrl = ephemeral sandboxed clone; rootDir = local checkout (dev/fixtures)
  const codeConfig = codeConn.config as unknown as CodeConfig | CloneConfig;
  const code =
    "repoUrl" in codeConfig
      ? (await cloneAndExtract(codeConfig, { blobs })).extract
      : await new CodeAdapter().extract(codeConfig, { blobs });
  const rawGraph: CanonicalGraph = { figma, code };
  await assertNotCancelled(db, runId);

  // 2. Effective mapping set: user revision wins, confident auto-proposals fill gaps
  const userRevision = await db.query.mappingSetRevisions.findFirst({
    where: eq(schema.mappingSetRevisions.workspaceId, workspaceId),
    orderBy: desc(schema.mappingSetRevisions.revision),
  });
  const userSet: MappingSetRevision = userRevision?.data ?? {
    revision: 0,
    mappings: [],
    statuses: [],
    tokenMappings: [],
  };
  // Ignored components leave the graph entirely; workspace naming conventions
  // configure the matcher — a design system is a configuration, not a code path.
  const graph = applyIgnores(rawGraph, userSet.ignored);
  const workspace = await db.query.workspaces.findFirst({
    where: eq(schema.workspaces.id, workspaceId),
  });
  const matcherConfig: MatcherConfig = {
    ...DEFAULT_MATCHER_CONFIG,
    ...((workspace?.settings?.matcher as Partial<MatcherConfig>) ?? {}),
  };

  const userMapped = new Set(userSet.mappings.map((m) => refKey(m.figmaRef)));
  const vetoed = new Set(userSet.unlinked ?? []);
  const auto = proposeMappings(
    graph.figma,
    graph.code,
    matcherConfig,
  ).proposed.filter(
    (m) =>
      !userMapped.has(refKey(m.figmaRef)) && !vetoed.has(refKey(m.figmaRef)),
  );
  const userTokenMapped = new Set(
    userSet.tokenMappings.map((m) => tokenKey(m.figmaToken)),
  );
  const autoTokens = proposeTokenMappings(graph.figma, graph.code).filter(
    (m) => !userTokenMapped.has(tokenKey(m.figmaToken)),
  );
  const effective: MappingSetRevision = {
    ...userSet,
    mappings: [...userSet.mappings, ...auto],
    tokenMappings: [...userSet.tokenMappings, ...autoTokens],
  };

  // 3. Analyze + score
  const findings = runAnalyzers(graph, effective, {});
  const scoreSet = computeScores(graph, effective, findings);

  // 4. firstSeenSnapshot from prior occurrences in this workspace
  const priorSnapshots = await db
    .select({ id: schema.snapshots.id })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.workspaceId, workspaceId));
  const firstSeen = new Map<string, string>();
  if (priorSnapshots.length > 0) {
    const prior = await db
      .select({
        fingerprint: schema.findingOccurrences.fingerprint,
        firstSeenSnapshotId: schema.findingOccurrences.firstSeenSnapshotId,
      })
      .from(schema.findingOccurrences)
      .where(
        inArray(
          schema.findingOccurrences.snapshotId,
          priorSnapshots.map((s) => s.id),
        ),
      );
    for (const row of prior) {
      if (!firstSeen.has(row.fingerprint)) {
        firstSeen.set(row.fingerprint, row.firstSeenSnapshotId);
      }
    }
  }

  await assertNotCancelled(db, runId);
  // 5. Seal atomically — blob writes already completed during ingest
  const snapshotId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.snapshots).values({
      id: snapshotId,
      runId,
      workspaceId,
      schemaVersion: SCHEMA_VERSION,
      fingerprintVersion: FINGERPRINT_VERSION,
      mappingSet: effective,
      analyzerConfig: {},
      rubric: { entries: rubric, severityWeights } as unknown as Record<
        string,
        unknown
      >,
      coverage: computeCoverage(graph) as unknown as Record<string, unknown>,
      topline: scoreSet.topline,
    });
    await tx.insert(schema.snapshotSources).values(
      [...figma.artifacts, ...code.artifacts].map((artifact) => ({
        snapshotId,
        artifact,
      })),
    );
    await tx.insert(schema.snapshotGraphs).values({ snapshotId, graph });
    await tx.insert(schema.scores).values([
      ...scoreSet.components.flatMap((c) =>
        (Object.entries(c.scores) as [Dimension, number | null][]).map(
          ([dimension, score]) => ({
            snapshotId,
            subjectRefKey: c.subjectRefKey,
            name: c.name,
            usageTotal: c.usageTotal,
            dimension,
            score,
          }),
        ),
      ),
      ...(Object.entries(scoreSet.system) as [Dimension, number | null][]).map(
        ([dimension, score]) => ({
          snapshotId,
          subjectRefKey: null,
          dimension,
          score,
        }),
      ),
    ]);
    if (findings.length > 0) {
      await tx.insert(schema.findingOccurrences).values(
        findings.map((f) => ({
          snapshotId,
          fingerprint: f.fingerprint,
          type: f.type,
          dimension: f.dimension,
          severity: f.severity,
          subjectRefKey: f.subjectRef ? refKey(f.subjectRef) : null,
          subjectRef: f.subjectRef,
          evidence: f.evidence,
          locations: f.locations,
          firstSeenSnapshotId: firstSeen.get(f.fingerprint) ?? snapshotId,
        })),
      );
    }
  });
  return { snapshotId };
}
