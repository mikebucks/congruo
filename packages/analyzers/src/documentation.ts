import type { Analyzer, Finding } from "@congruo/core";
import { createFinding, pairComponents } from "@congruo/core";

/** Documentation signals are code-side (stories, docgen descriptions); the
 * paired Figma description counts as usage guidance. Figma-only components
 * are unassessed for this dimension — scoring returns null, not 100. */
export const documentation: Analyzer = (graph, mappings) => {
  const findings: Finding[] = [];
  for (const pair of pairComponents(graph, mappings)) {
    const def = pair.codeDef;
    if (!def) continue;

    if (!def.docs.storyExists) {
      findings.push(
        createFinding({
          type: "NO_STORY",
          subjectRef: def.ref,
          evidence: { componentName: def.name },
          locations: [],
        }),
      );
    }

    const undocumented = def.props
      .filter((p) => !p.documented && p.name !== "children")
      .map((p) => p.name);
    if (undocumented.length > 0) {
      findings.push(
        createFinding({
          type: "PROPS_UNDOCUMENTED",
          subjectRef: def.ref,
          evidence: { undocumented: undocumented as [string, ...string[]] },
          locations: [],
        }),
      );
    }

    const hasProse =
      def.docs.usageProse !== null ||
      (pair.figmaDef?.docs.usageProse ?? null) !== null;
    if (!hasProse) {
      findings.push(
        createFinding({
          type: "NO_USAGE_GUIDANCE",
          subjectRef: def.ref,
          evidence: { componentName: def.name },
          locations: [],
        }),
      );
    }
  }
  return findings;
};
