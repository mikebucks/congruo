import type { Dimension } from "@congruo/core";

/** Deltas are computed by diffing immutable snapshots, never stored. A finding
 * counts as resolved only when the newer audit covered the same sources —
 * otherwise "resolved" would just mean "didn't look". */

export interface FindingDelta {
  newFingerprints: Set<string>;
  resolvedFingerprints: Set<string>;
  persistingCount: number;
  /** false = source sets differ; resolved/new would be misleading. */
  comparable: boolean;
}

export function diffFindings(
  previous: { fingerprints: string[]; artifactIds: string[] },
  current: { fingerprints: string[]; artifactIds: string[] },
): FindingDelta {
  const comparable =
    previous.artifactIds.length === current.artifactIds.length &&
    [...previous.artifactIds]
      .sort()
      .every((id, i) => id === [...current.artifactIds].sort()[i]);

  const prev = new Set(previous.fingerprints);
  const cur = new Set(current.fingerprints);
  const newFingerprints = new Set([...cur].filter((f) => !prev.has(f)));
  const resolvedFingerprints = new Set([...prev].filter((f) => !cur.has(f)));
  return {
    newFingerprints,
    resolvedFingerprints,
    persistingCount: cur.size - newFingerprints.size,
    comparable,
  };
}

export interface ScoreDelta {
  topline: number | null;
  dimensions: Partial<Record<Dimension, number>>;
}

export function diffScores(
  previous: {
    topline: number | null;
    system: Partial<Record<Dimension, number | null>>;
  },
  current: {
    topline: number | null;
    system: Partial<Record<Dimension, number | null>>;
  },
): ScoreDelta {
  const dimensions: Partial<Record<Dimension, number>> = {};
  for (const d of Object.keys(current.system) as Dimension[]) {
    const prev = previous.system[d];
    const cur = current.system[d];
    if (typeof prev === "number" && typeof cur === "number") {
      dimensions[d] = cur - prev;
    }
  }
  return {
    topline:
      typeof previous.topline === "number" &&
      typeof current.topline === "number"
        ? current.topline - previous.topline
        : null,
    dimensions,
  };
}
