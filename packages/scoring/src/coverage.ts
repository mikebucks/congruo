import type { CanonicalGraph } from "@congruo/core";
import { refKey } from "@congruo/core";

/** Snapshot-frozen coverage read model — the report renders this, never the
 * graph. Headline numbers for the ICP's "prove adoption" pain. */
export interface CoverageSummary {
  figma: {
    dsInstances: number;
    totalInstances: number;
    /** share of consumer-file instances that are DS-library instances */
    coveragePct: number | null;
  };
  code: {
    dsUsages: number;
    localComponentUsages: number;
    rawStyledElements: number;
    /** share of app component usages resolving to the DS package */
    coveragePct: number | null;
  };
  tokens: {
    figmaBound: number;
    figmaHardcoded: number;
    codeBound: number;
    codeHardcoded: number;
    /** token-bound share of style values across both sides */
    healthPct: number | null;
  };
  files: { analyzed: number; skippedOrFailed: number };
}

const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 100);

export function computeCoverage(graph: CanonicalGraph): CoverageSummary {
  const libraryRefs = new Set(
    graph.figma.definitions.map((d) => refKey(d.ref)),
  );
  const figmaUsages = graph.figma.usages.filter((u) => u.kind === "component");
  const dsInstances = figmaUsages.filter(
    (u) => u.definitionRef && libraryRefs.has(refKey(u.definitionRef)),
  ).length;

  const codeComponentUsages = graph.code.usages.filter(
    (u) => u.kind === "component",
  );
  const dsUsages = codeComponentUsages.filter(
    (u) => u.definitionRef !== null,
  ).length;
  const localComponentUsages = codeComponentUsages.length - dsUsages;
  const rawStyledElements = graph.code.usages.filter(
    (u) => u.kind === "styled-element",
  ).length;

  const count = (side: "figma" | "code") => {
    let bound = 0;
    let hardcoded = 0;
    for (const d of graph[side].definitions) {
      bound += d.tokensUsed.length;
      hardcoded += d.hardcodedValues.length;
    }
    return { bound, hardcoded };
  };
  const ft = count("figma");
  const ct = count("code");

  const analyzed = new Set(
    [...graph.figma.artifacts, ...graph.code.artifacts].map((a) => a.id),
  ).size;
  const skippedOrFailed = [
    ...graph.figma.diagnostics,
    ...graph.code.diagnostics,
  ].filter((d) => d.kind === "skipped-file" || d.kind === "parse-error").length;

  return {
    figma: {
      dsInstances,
      totalInstances: figmaUsages.length,
      coveragePct: pct(dsInstances, figmaUsages.length),
    },
    code: {
      dsUsages,
      localComponentUsages,
      rawStyledElements,
      coveragePct: pct(dsUsages, codeComponentUsages.length),
    },
    tokens: {
      figmaBound: ft.bound,
      figmaHardcoded: ft.hardcoded,
      codeBound: ct.bound,
      codeHardcoded: ct.hardcoded,
      healthPct: pct(
        ft.bound + ct.bound,
        ft.bound + ct.bound + ft.hardcoded + ct.hardcoded,
      ),
    },
    files: { analyzed, skippedOrFailed },
  };
}
