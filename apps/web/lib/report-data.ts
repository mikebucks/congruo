import type { Dimension, Severity } from "@congruo/core";
import { refKey } from "@congruo/core";
import { schema } from "@congruo/db";
import type { CoverageSummary } from "@congruo/scoring";
import { diffFindings, diffScores } from "@congruo/scoring";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "./server";

export interface ReportData {
  snapshot: typeof schema.snapshots.$inferSelect;
  sources: (typeof schema.snapshotSources.$inferSelect)[];
  /** subjectRefKey is canonicalized: figma-side findings on a mapped pair
   * carry the pair's code refKey, matching the scores table. */
  findings: (typeof schema.findingOccurrences.$inferSelect & {
    canonicalKey: string | null;
  })[];
  componentScores: Map<
    string,
    {
      name: string;
      usageTotal: number;
      scores: Partial<Record<Dimension, number | null>>;
    }
  >;
  systemScores: Partial<Record<Dimension, number | null>>;
  coverage: CoverageSummary | null;
  delta: ReportDelta | null;
}

export async function loadReport(
  snapshotId: string,
): Promise<ReportData | null> {
  const snapshot = await db().query.snapshots.findFirst({
    where: eq(schema.snapshots.id, snapshotId),
  });
  if (!snapshot) return null;

  const [sources, findingRows, scoreRows] = await Promise.all([
    db().query.snapshotSources.findMany({
      where: eq(schema.snapshotSources.snapshotId, snapshotId),
    }),
    db().query.findingOccurrences.findMany({
      where: eq(schema.findingOccurrences.snapshotId, snapshotId),
    }),
    db().query.scores.findMany({
      where: eq(schema.scores.snapshotId, snapshotId),
    }),
  ]);

  const aliases = new Map<string, string>();
  for (const m of snapshot.mappingSet.mappings) {
    aliases.set(refKey(m.figmaRef), refKey(m.codeRef));
  }
  const findings = findingRows.map((f) => ({
    ...f,
    canonicalKey: f.subjectRefKey
      ? (aliases.get(f.subjectRefKey) ?? f.subjectRefKey)
      : null,
  }));

  const componentScores: ReportData["componentScores"] = new Map();
  const systemScores: ReportData["systemScores"] = {};
  for (const row of scoreRows) {
    if (row.subjectRefKey === null) {
      systemScores[row.dimension] = row.score;
      continue;
    }
    const entry = componentScores.get(row.subjectRefKey) ?? {
      name: row.name ?? row.subjectRefKey,
      usageTotal: row.usageTotal ?? 0,
      scores: {},
    };
    entry.scores[row.dimension] = row.score;
    componentScores.set(row.subjectRefKey, entry);
  }

  return {
    snapshot,
    sources,
    findings,
    componentScores,
    systemScores,
    coverage: (snapshot.coverage as unknown as CoverageSummary) ?? null,
    delta: await computeDelta(snapshot, sources, findings, systemScores),
  };
}

export interface ReportDelta {
  previousDate: Date;
  comparable: boolean;
  newCount: number;
  resolvedCount: number;
  persistingCount: number;
  topline: number | null;
}

/** Deltas come from diffing the previous immutable snapshot — never stored. */
async function computeDelta(
  snapshot: ReportData["snapshot"],
  sources: ReportData["sources"],
  findings: { fingerprint: string }[],
  systemScores: ReportData["systemScores"],
): Promise<ReportDelta | null> {
  const previous = await db().query.snapshots.findFirst({
    where: and(
      eq(schema.snapshots.workspaceId, snapshot.workspaceId),
      lt(schema.snapshots.createdAt, snapshot.createdAt),
    ),
    orderBy: desc(schema.snapshots.createdAt),
  });
  if (!previous) return null;

  const [prevFindings, prevSources] = await Promise.all([
    db()
      .select({ fingerprint: schema.findingOccurrences.fingerprint })
      .from(schema.findingOccurrences)
      .where(eq(schema.findingOccurrences.snapshotId, previous.id)),
    db().query.snapshotSources.findMany({
      where: eq(schema.snapshotSources.snapshotId, previous.id),
    }),
  ]);

  const diff = diffFindings(
    {
      fingerprints: prevFindings.map((f) => f.fingerprint),
      artifactIds: prevSources.map((s) => s.artifact.id),
    },
    {
      fingerprints: findings.map((f) => f.fingerprint),
      artifactIds: sources.map((s) => s.artifact.id),
    },
  );
  const scoreDelta = diffScores(
    { topline: previous.topline, system: {} },
    { topline: snapshot.topline, system: systemScores },
  );
  return {
    previousDate: previous.createdAt,
    comparable: diff.comparable,
    newCount: diff.newFingerprints.size,
    resolvedCount: diff.resolvedFingerprints.size,
    persistingCount: diff.persistingCount,
    topline: scoreDelta.topline,
  };
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 3,
  warn: 2,
  info: 1,
};

/** PRD ranking: severity × reach. Reach = the subject's total usage. */
export function rankFindings(
  findings: ReportData["findings"],
  componentScores: ReportData["componentScores"],
): (ReportData["findings"][number] & { rank: number; reach: number })[] {
  return findings
    .map((f) => {
      const reach = f.canonicalKey
        ? (componentScores.get(f.canonicalKey)?.usageTotal ?? 0)
        : 0;
      return {
        ...f,
        reach,
        rank: SEVERITY_WEIGHT[f.severity] * (1 + Math.log10(1 + reach)),
      };
    })
    .sort((a, b) => b.rank - a.rank);
}
