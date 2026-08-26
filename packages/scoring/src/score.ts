import type {
  CanonicalGraph,
  Dimension,
  Finding,
  FindingType,
  MappingSetRevision,
} from "@congruo/core";
import {
  pairComponents,
  pairUsage,
  refKey,
  resolveStatuses,
  usageStats,
} from "@congruo/core";
import {
  dimensionWeights,
  reachMultiplier,
  rubric,
  severityWeights,
} from "./rubric";

export const DIMENSIONS: Dimension[] = [
  "parity",
  "complexity",
  "adoption",
  "documentation",
];

export interface ComponentScore {
  subjectRefKey: string;
  name: string;
  usageTotal: number;
  /** null = unassessed for this component (never rendered as 100). */
  scores: Record<Dimension, number | null>;
}

export interface ScoreSet {
  components: ComponentScore[];
  system: Record<Dimension, number | null>;
  topline: number | null;
}

export function computeScores(
  graph: CanonicalGraph,
  mappings: MappingSetRevision,
  findings: Finding[],
): ScoreSet {
  const pairs = pairComponents(graph, mappings);
  const stats = usageStats(graph);
  const statuses = resolveStatuses(graph, mappings);

  // both sides of a pair roll up onto one canonical subject
  const canonical = new Map<string, string>();
  for (const pair of pairs) {
    const key = refKey(pair.subjectRef);
    canonical.set(key, key);
    if (pair.figmaDef) canonical.set(refKey(pair.figmaDef.ref), key);
    if (pair.codeDef) canonical.set(refKey(pair.codeDef.ref), key);
  }

  const findingsBySubject = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!f.subjectRef) continue;
    const key = canonical.get(refKey(f.subjectRef)) ?? refKey(f.subjectRef);
    findingsBySubject.set(key, [...(findingsBySubject.get(key) ?? []), f]);
  }

  const components: ComponentScore[] = pairs.map((pair) => {
    const key = refKey(pair.subjectRef);
    const usage = pairUsage(pair, stats);
    const usageTotal = usage.instances + usage.jsx;
    const status = statuses.get(key);
    const exempt = status === "new" || status === "experimental";
    const subjectFindings = findingsBySubject.get(key) ?? [];

    const scores = {} as Record<Dimension, number | null>;
    for (const dimension of DIMENSIONS) {
      const assessed =
        dimension === "documentation"
          ? pair.codeDef !== undefined &&
            pair.codeDef.kind !== "asset" &&
            !exempt
          : dimension === "adoption"
            ? !exempt
            : true;
      if (!assessed) {
        scores[dimension] = null;
        continue;
      }
      let penalty = 0;
      for (const f of subjectFindings) {
        if (f.dimension !== dimension) continue;
        const entry = rubric[f.type as FindingType];
        if (!entry) continue;
        penalty +=
          entry.penalty *
          severityWeights[f.severity] *
          (entry.reach === "usages" ? reachMultiplier(usageTotal) : 1);
      }
      scores[dimension] = Math.max(0, Math.round(100 - penalty));
    }
    return {
      subjectRefKey: key,
      name: pair.codeDef?.name ?? pair.figmaDef?.name ?? key,
      usageTotal,
      scores,
    };
  });

  // system rollups: usage-weighted mean over assessed components
  const system = {} as Record<Dimension, number | null>;
  for (const dimension of DIMENSIONS) {
    let weighted = 0;
    let weightSum = 0;
    for (const c of components) {
      const score = c.scores[dimension];
      if (score === null) continue;
      const weight = Math.max(1, c.usageTotal);
      weighted += score * weight;
      weightSum += weight;
    }
    system[dimension] =
      weightSum === 0 ? null : Math.round(weighted / weightSum);
  }

  let toplineWeighted = 0;
  let toplineWeightSum = 0;
  for (const dimension of DIMENSIONS) {
    const score = system[dimension];
    if (score === null) continue;
    toplineWeighted += score * dimensionWeights[dimension];
    toplineWeightSum += dimensionWeights[dimension];
  }
  const topline =
    toplineWeightSum === 0
      ? null
      : Math.round(toplineWeighted / toplineWeightSum);

  return { components, system, topline };
}
