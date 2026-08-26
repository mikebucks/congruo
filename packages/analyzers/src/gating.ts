import type {
  CanonicalGraph,
  Finding,
  MappingSetRevision,
} from "@congruo/core";
import { refKey, resolveStatuses } from "@congruo/core";

/** PRD status gating, applied once after all analyzers: components marked
 * new/experimental are exempt from Adoption and Documentation findings.
 * Status resolution is pair-aware (resolveStatuses) so a status set on the
 * Figma side gates code-side findings too — scoring uses the same resolver. */
export function applyStatusGating(
  findings: Finding[],
  graph: CanonicalGraph,
  mappings: MappingSetRevision,
): Finding[] {
  const statuses = resolveStatuses(graph, mappings);
  if (statuses.size === 0) return findings;
  return findings.filter((f) => {
    if (f.dimension !== "adoption" && f.dimension !== "documentation") {
      return true;
    }
    const status = f.subjectRef && statuses.get(refKey(f.subjectRef));
    return status !== "new" && status !== "experimental";
  });
}
