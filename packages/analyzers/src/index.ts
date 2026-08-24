import type { Analyzer, Finding } from "@congruo/core";
import { adoption } from "./adoption";
import { complexity } from "./complexity";
import { documentation } from "./documentation";
import { applyStatusGating } from "./gating";
import { parity } from "./parity";

export const analyzers: Analyzer[] = [
  parity,
  complexity,
  adoption,
  documentation,
];

export const runAnalyzers: Analyzer = (graph, mappings, config) => {
  const findings: Finding[] = [];
  for (const analyzer of analyzers) {
    findings.push(...analyzer(graph, mappings, config));
  }
  return applyStatusGating(findings, mappings);
};

export { adoption } from "./adoption";
export { complexity } from "./complexity";
export { documentation } from "./documentation";
export { applyStatusGating } from "./gating";
export { parity } from "./parity";
