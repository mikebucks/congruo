import type { Finding, MappingSetRevision } from "@congruo/core";
import { refKey } from "@congruo/core";

/** PRD status gating, applied once after all analyzers: components marked
 * new/experimental are exempt from Adoption and Documentation findings.
 * (Deprecated inversion ships with the full adoption analyzer in M3.) */
export function applyStatusGating(
  findings: Finding[],
  mappings: MappingSetRevision,
): Finding[] {
  const exempt = new Set(
    mappings.statuses
      .filter((s) => s.status === "new" || s.status === "experimental")
      .map((s) => refKey(s.ref)),
  );
  if (exempt.size === 0) return findings;
  return findings.filter(
    (f) =>
      !(
        (f.dimension === "adoption" || f.dimension === "documentation") &&
        f.subjectRef &&
        exempt.has(refKey(f.subjectRef))
      ),
  );
}
