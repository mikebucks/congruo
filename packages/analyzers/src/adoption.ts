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
  // single-file concentration is only meaningful when the file universe the
  // component could appear in spans more than one file (M4 gate review) —
  // judged per side: figma usages live in consumer files, code in app files
  const figmaFiles = new Set<string>();
  const codeFiles = new Set<string>();
  for (const u of [...graph.figma.usages, ...graph.code.usages]) {
    if (u.location.kind === "figma") figmaFiles.add(u.location.fileKey);
    else codeFiles.add(u.location.filePath);
  }
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
    } else if (
      total >= 2 &&
      files.size === 1 &&
      (instances > 0 ? figmaFiles.size : 0) +
        (jsx > 0 ? codeFiles.size : 0) >
        1
    ) {
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
