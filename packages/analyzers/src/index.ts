import type { Analyzer, Finding } from "@congruo/core";
import { unusedComponent } from "./adoption";
import { applyStatusGating } from "./gating";
import { hardcodedValueCode, missingInCode } from "./parity";

export const analyzers: Analyzer[] = [
  missingInCode,
  hardcodedValueCode,
  unusedComponent,
];

export const runAnalyzers: Analyzer = (graph, mappings, config) => {
  const findings: Finding[] = [];
  for (const analyzer of analyzers) {
    findings.push(...analyzer(graph, mappings, config));
  }
  return applyStatusGating(findings, mappings);
};

export { unusedComponent } from "./adoption";
export { applyStatusGating } from "./gating";
export { hardcodedValueCode, missingInCode } from "./parity";
