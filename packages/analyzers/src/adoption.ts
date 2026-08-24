import type { Analyzer, Finding } from "@congruo/core";
import {
  createFinding,
  pairComponents,
  pairUsage,
  refKey,
  usageStats,
} from "@congruo/core";

export const adoption: Analyzer = (graph, mappings) => {
  const findings: Finding[] = [];
  const stats = usageStats(graph);
  const statusByRef = new Map(
    mappings.statuses.map((s) => [refKey(s.ref), s.status]),
  );

  for (const pair of pairComponents(graph, mappings)) {
    const { instances, jsx, files } = pairUsage(pair, stats);
    const total = instances + jsx;
    const status =
      statusByRef.get(refKey(pair.subjectRef)) ??
      (pair.figmaDef && statusByRef.get(refKey(pair.figmaDef.ref)));

    // Deprecated inverts adoption: usage IS the finding; disuse is success.
    if (status === "deprecated") {
      if (total > 0) {
        findings.push(
          createFinding({
            type: "DEPRECATED_STILL_USED",
            subjectRef: pair.subjectRef,
            evidence: {
              instanceCount: instances,
              usageCount: jsx,
              fileCount: files.size,
            },
            locations: [],
          }),
        );
      }
      continue;
    }

    if (total === 0) {
      findings.push(
        createFinding({
          type: "UNUSED_COMPONENT",
          subjectRef: pair.subjectRef,
          evidence: { instanceCount: instances, usageCount: jsx },
          locations: [],
        }),
      );
    } else if (total >= 2 && files.size === 1) {
      findings.push(
        createFinding({
          type: "SINGLE_FILE_ADOPTION",
          subjectRef: pair.subjectRef,
          evidence: { usageCount: total, file: [...files][0] ?? "" },
          locations: [],
        }),
      );
    }
  }
  return findings;
};
