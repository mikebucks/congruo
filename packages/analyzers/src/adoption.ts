import type { Analyzer, ComponentRef, Finding } from "@congruo/core";
import { createFinding, refKey } from "@congruo/core";

/** UNUSED_COMPONENT: zero Figma consumer instances AND zero JSX usages,
 * counted across the mapping when one exists. */
export const unusedComponent: Analyzer = (graph, mappings) => {
  const usageCount = new Map<string, number>();
  for (const usage of [...graph.figma.usages, ...graph.code.usages]) {
    if (!usage.definitionRef) continue;
    const key = refKey(usage.definitionRef);
    usageCount.set(key, (usageCount.get(key) ?? 0) + 1);
  }

  const codeByFigma = new Map(
    mappings.mappings.map((m) => [refKey(m.figmaRef), m.codeRef]),
  );

  const findings: Finding[] = [];
  const emitted = new Set<string>();
  const emit = (
    subjectRef: ComponentRef,
    instanceCount: number,
    jsxCount: number,
  ) => {
    const key = refKey(subjectRef);
    if (emitted.has(key)) return;
    emitted.add(key);
    findings.push(
      createFinding({
        type: "UNUSED_COMPONENT",
        subjectRef,
        evidence: { instanceCount, usageCount: jsxCount },
        locations: [],
      }),
    );
  };

  for (const def of graph.figma.definitions) {
    const instances = usageCount.get(refKey(def.ref)) ?? 0;
    const codeRef = codeByFigma.get(refKey(def.ref));
    const jsx = codeRef ? (usageCount.get(refKey(codeRef)) ?? 0) : 0;
    if (instances === 0 && jsx === 0) emit(codeRef ?? def.ref, 0, 0);
  }
  const mappedCode = new Set(
    mappings.mappings.map((m) => refKey(m.codeRef)),
  );
  for (const def of graph.code.definitions) {
    if (mappedCode.has(refKey(def.ref))) continue; // counted via figma side
    const jsx = usageCount.get(refKey(def.ref)) ?? 0;
    if (jsx === 0) emit(def.ref, 0, 0);
  }
  return findings;
};
