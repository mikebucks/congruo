import type {
  CanonicalGraph,
  ComponentDefinition,
  ComponentStatus,
  Mapping,
  MappingSetRevision,
} from "./model";
import type { ComponentRef } from "./refs";
import { refKey } from "./refs";

/** One logical design-system component: a mapped Figma/code pair, or a
 * definition that exists on one side only. Subject identity prefers the code
 * ref so findings from both sides roll up onto one component. */
export interface PairedComponent {
  figmaDef?: ComponentDefinition;
  codeDef?: ComponentDefinition;
  mapping?: Mapping;
  subjectRef: ComponentRef;
}

export function pairComponents(
  graph: CanonicalGraph,
  mappings: MappingSetRevision,
): PairedComponent[] {
  const figmaByKey = new Map(
    graph.figma.definitions.map((d) => [refKey(d.ref), d]),
  );
  const codeByKey = new Map(
    graph.code.definitions.map((d) => [refKey(d.ref), d]),
  );
  const out: PairedComponent[] = [];
  const pairedFigma = new Set<string>();
  const pairedCode = new Set<string>();

  for (const mapping of mappings.mappings) {
    const figmaDef = figmaByKey.get(refKey(mapping.figmaRef));
    const codeDef = codeByKey.get(refKey(mapping.codeRef));
    if (!figmaDef && !codeDef) continue;
    pairedFigma.add(refKey(mapping.figmaRef));
    pairedCode.add(refKey(mapping.codeRef));
    out.push({
      figmaDef,
      codeDef,
      mapping,
      subjectRef: codeDef?.ref ?? mapping.codeRef,
    });
  }
  for (const def of graph.figma.definitions) {
    if (!pairedFigma.has(refKey(def.ref))) {
      out.push({ figmaDef: def, subjectRef: def.ref });
    }
  }
  for (const def of graph.code.definitions) {
    if (!pairedCode.has(refKey(def.ref))) {
      out.push({ codeDef: def, subjectRef: def.ref });
    }
  }
  return out;
}

export interface UsageStats {
  count: number;
  files: Set<string>;
  overrides: Record<string, unknown>[];
}

/** Usage counts, file spread, and overridden props per definition refKey.
 * File identity: Figma consumer fileKey / code source filePath. */
export function usageStats(graph: CanonicalGraph): Map<string, UsageStats> {
  const stats = new Map<string, UsageStats>();
  for (const usage of [...graph.figma.usages, ...graph.code.usages]) {
    if (!usage.definitionRef || usage.kind !== "component") continue;
    const key = refKey(usage.definitionRef);
    const entry = stats.get(key) ?? {
      count: 0,
      files: new Set<string>(),
      overrides: [],
    };
    entry.count++;
    entry.files.add(
      usage.location.kind === "figma"
        ? usage.location.fileKey
        : usage.location.filePath,
    );
    entry.overrides.push(usage.overriddenProps);
    stats.set(key, entry);
  }
  return stats;
}

/** Effective status per refKey, resolved pair-aware: a status set on either
 * side of a mapped pair applies to BOTH sides. Gating and scoring must share
 * this — resolving differently made findings and scores disagree. */
export function resolveStatuses(
  graph: CanonicalGraph,
  mappings: MappingSetRevision,
): Map<string, ComponentStatus> {
  const declared = new Map(
    mappings.statuses.map((s) => [refKey(s.ref), s.status]),
  );
  const out = new Map<string, ComponentStatus>();
  for (const pair of pairComponents(graph, mappings)) {
    const keys = new Set([refKey(pair.subjectRef)]);
    if (pair.figmaDef) keys.add(refKey(pair.figmaDef.ref));
    if (pair.codeDef) keys.add(refKey(pair.codeDef.ref));
    if (pair.mapping) {
      keys.add(refKey(pair.mapping.figmaRef));
      keys.add(refKey(pair.mapping.codeRef));
    }
    let status: ComponentStatus | undefined;
    for (const k of keys) {
      status ??= declared.get(k);
    }
    if (status) {
      for (const k of keys) out.set(k, status);
    }
  }
  return out;
}

/** Removes ignored components — definitions AND their usages — so they leave
 * every numerator and denominator (findings, scores, coverage) consistently. */
export function applyIgnores(
  graph: CanonicalGraph,
  ignored: string[] | undefined,
): CanonicalGraph {
  if (!ignored || ignored.length === 0) return graph;
  const drop = new Set(ignored);
  const filterSide = (extract: CanonicalGraph["figma"]) => ({
    ...extract,
    definitions: extract.definitions.filter((d) => !drop.has(refKey(d.ref))),
    usages: extract.usages.filter(
      (u) => !u.definitionRef || !drop.has(refKey(u.definitionRef)),
    ),
  });
  return { figma: filterSide(graph.figma), code: filterSide(graph.code) };
}

export function variantCombinations(def: ComponentDefinition): number {
  const axes = Object.values(def.variants);
  if (axes.length === 0) return 0;
  return axes.reduce((n, values) => n * Math.max(values.length, 1), 1);
}

/** Combined usage across both sides of a pair. */
export function pairUsage(
  pair: PairedComponent,
  stats: Map<string, UsageStats>,
): { instances: number; jsx: number; files: Set<string> } {
  const figma = pair.figmaDef
    ? stats.get(refKey(pair.figmaDef.ref))
    : undefined;
  const code = pair.codeDef ? stats.get(refKey(pair.codeDef.ref)) : undefined;
  return {
    instances: figma?.count ?? 0,
    jsx: code?.count ?? 0,
    files: new Set([...(figma?.files ?? []), ...(code?.files ?? [])]),
  };
}
