import type {
  ComponentStatus,
  MappingSetRevision,
  Severity,
} from "@congruo/core";
import { refKey } from "@congruo/core";
import { reachMultiplier } from "@congruo/scoring";

/** Reads the rubric FROZEN into the snapshot, so a historical report shows
 * the arithmetic it was scored with. v1 snapshots sealed flat entries with no
 * severity weights (everything weighed 1). */
export interface FrozenScoring {
  entries: Record<string, { penalty: number; reach: "none" | "usages" }>;
  severityWeights: Record<Severity, number>;
}

export function frozenScoring(
  sealed: Record<string, unknown> | null,
): FrozenScoring {
  const v2 = sealed && "entries" in (sealed ?? {});
  return {
    entries: (v2
      ? sealed?.entries
      : (sealed ?? {})) as FrozenScoring["entries"],
    severityWeights: (v2 && sealed?.severityWeights
      ? sealed.severityWeights
      : { info: 1, warn: 1, error: 1 }) as Record<Severity, number>,
  };
}

/** Points this finding subtracted from its dimension, or null if the sealed
 * rubric doesn't know the type. */
export function contribution(
  scoring: FrozenScoring,
  finding: { type: string; severity: Severity },
  usageTotal: number,
): number | null {
  const entry = scoring.entries[finding.type];
  if (!entry) return null;
  return (
    entry.penalty *
    (scoring.severityWeights[finding.severity] ?? 1) *
    (entry.reach === "usages" ? reachMultiplier(usageTotal) : 1)
  );
}

/** Pair-aware status lookup from the snapshot's frozen mapping set — a status
 * set on either side of a mapping applies to the whole component. */
export function statusFor(
  mappingSet: MappingSetRevision,
  subjectKey: string,
): ComponentStatus | undefined {
  const counterpart = new Map<string, string>();
  for (const m of mappingSet.mappings) {
    counterpart.set(refKey(m.figmaRef), refKey(m.codeRef));
    counterpart.set(refKey(m.codeRef), refKey(m.figmaRef));
  }
  for (const s of mappingSet.statuses) {
    const key = refKey(s.ref);
    if (key === subjectKey || counterpart.get(key) === subjectKey) {
      return s.status;
    }
  }
  return undefined;
}
