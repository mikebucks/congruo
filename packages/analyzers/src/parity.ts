import type { Analyzer, Finding } from "@congruo/core";
import { createFinding, refKey } from "@congruo/core";

/** MISSING_IN_CODE: Figma component with no mapped code equivalent. */
export const missingInCode: Analyzer = (graph, mappings) => {
  const mappedFigma = new Set(mappings.mappings.map((m) => refKey(m.figmaRef)));
  const findings: Finding[] = [];
  for (const def of graph.figma.definitions) {
    if (mappedFigma.has(refKey(def.ref))) continue;
    findings.push(
      createFinding({
        type: "MISSING_IN_CODE",
        subjectRef: def.ref,
        evidence: {
          figmaName: def.name,
          variantCount: Object.values(def.variants).reduce(
            (n, vals) => n * Math.max(vals.length, 1),
            Object.keys(def.variants).length ? 1 : 0,
          ),
        },
        locations: [],
      }),
    );
  }
  return findings;
};

/** HARDCODED_VALUE_CODE: raw style value in a DS component. Token-match
 * enrichment (the auto-fix evidence) arrives with token values in M3. */
export const hardcodedValueCode: Analyzer = (graph) => {
  const findings: Finding[] = [];
  for (const def of graph.code.definitions) {
    for (const hv of def.hardcodedValues) {
      findings.push(
        createFinding({
          type: "HARDCODED_VALUE_CODE",
          subjectRef: def.ref,
          evidence: { value: hv.value, property: hv.property, matchingToken: null },
          locations: [hv.location],
        }),
      );
    }
  }
  return findings;
};
