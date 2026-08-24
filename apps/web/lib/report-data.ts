import type { Dimension, Severity } from "@congruo/core";
import { refKey } from "@congruo/core";
import { schema } from "@congruo/db";
import type { CoverageSummary } from "@congruo/scoring";
import { eq } from "drizzle-orm";
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
