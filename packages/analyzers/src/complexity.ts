import type { Analyzer, ComponentDefinition, Finding } from "@congruo/core";
import {
  createFinding,
  normalizeName,
  refKey,
  similarity,
  usageStats,
  variantCombinations,
} from "@congruo/core";

const REDUNDANCY_NAME_THRESHOLD = 0.7;
const REDUNDANCY_PROP_THRESHOLD = 0.5;
const DEFAULT_PROP_EXPLOSION = 48;
const UNUSED_VARIANT_MIN_USAGES = 5;

export const complexity: Analyzer = (graph, _mappings, config) => {
  const findings: Finding[] = [];
  const stats = usageStats(graph);
  const threshold = config.propExplosionThreshold ?? DEFAULT_PROP_EXPLOSION;

  for (const side of ["figma", "code"] as const) {
    findings.push(...redundantComponents(graph[side].definitions, stats));
  }

  for (const def of [...graph.figma.definitions, ...graph.code.definitions]) {
    const usage = stats.get(refKey(def.ref));

    const combinations = variantCombinations(def);
    if (combinations > threshold) {
      findings.push(
        createFinding({
          type: "PROP_EXPLOSION",
          subjectRef: def.ref,
          evidence: { combinationCount: combinations, threshold },
          locations: [],
        }),
      );
    }

    if (!usage || usage.count === 0) continue; // UNUSED_COMPONENT's territory

    const observedProps = new Set(
      usage.overrides.flatMap((o) => Object.keys(o)),
    );
    for (const prop of def.props) {
      if (prop.name === "children" || observedProps.has(prop.name)) continue;
      findings.push(
        createFinding({
          type: "UNUSED_PROP",
          subjectRef: def.ref,
          evidence: { propName: prop.name, observedUsages: usage.count },
          locations: [],
        }),
      );
    }

    // Variant values: only judged with enough instances, and only for axes the
    // usages actually override — defaults are invisible in override data.
    if (usage.count >= UNUSED_VARIANT_MIN_USAGES) {
      for (const [axis, values] of Object.entries(def.variants)) {
        const observed = new Set(
          usage.overrides
            .map((o) => o[axis])
            .filter((v) => v !== undefined)
            .map(String),
        );
        if (observed.size === 0) continue;
        for (const value of values) {
          if (!observed.has(value)) {
            findings.push(
              createFinding({
                type: "UNUSED_VARIANT",
                subjectRef: def.ref,
                evidence: { axis, value, observedInstances: usage.count },
                locations: [],
              }),
            );
          }
        }
      }
    }
  }
  return findings;
};

/** The ButtonNew detector: near-duplicate name + overlapping prop shape inside
 * one side. Finding lands on the lesser-used of the pair. */
function redundantComponents(
  defs: ComponentDefinition[],
  stats: ReturnType<typeof usageStats>,
): Finding[] {
  const findings: Finding[] = [];
  const shaped = defs.filter(
    (d) => d.props.length + Object.keys(d.variants).length > 0,
  );
  for (let i = 0; i < shaped.length; i++) {
    for (let j = i + 1; j < shaped.length; j++) {
      const a = shaped[i];
      const b = shaped[j];
      if (!a || !b) continue;
      const nameSim = similarity(normalizeName(a.name), normalizeName(b.name));
      if (nameSim < REDUNDANCY_NAME_THRESHOLD || nameSim === 1) continue;
      const overlap = propOverlap(a, b);
      if (overlap < REDUNDANCY_PROP_THRESHOLD) continue;

      const usageA = stats.get(refKey(a.ref))?.count ?? 0;
      const usageB = stats.get(refKey(b.ref))?.count ?? 0;
      const [subject, other] =
        usageA < usageB || (usageA === usageB && a.name > b.name)
          ? [a, b]
          : [b, a];
      findings.push(
        createFinding({
          type: "REDUNDANT_COMPONENT",
          subjectRef: subject.ref,
          evidence: {
            otherName: other.name,
            otherRefKey: refKey(other.ref),
            nameSimilarity: Math.round(nameSim * 100) / 100,
            propOverlap: Math.round(overlap * 100) / 100,
          },
          locations: [],
        }),
      );
    }
  }
  return findings;
}

function propOverlap(a: ComponentDefinition, b: ComponentDefinition): number {
  const shape = (d: ComponentDefinition) =>
    new Set(
      [...d.props.map((p) => p.name), ...Object.keys(d.variants)].map((n) =>
        n.toLowerCase(),
      ),
    );
  const sa = shape(a);
  const sb = shape(b);
  const smaller = Math.min(sa.size, sb.size);
  if (smaller === 0) return 0;
  let hits = 0;
  for (const n of sa) if (sb.has(n)) hits++;
  return hits / smaller;
}
