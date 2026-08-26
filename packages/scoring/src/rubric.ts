import type { Dimension, FindingType, Severity } from "@congruo/core";

/** THE scoring config. Tuning scores means editing this file — never analyzer
 * code. Milestone-4 gate tunes these once against the real Polaris audit. */

export type ReachScaling = "none" | "usages";

export interface RubricEntry {
  penalty: number;
  reach: ReachScaling;
}

export const rubric: Record<FindingType, RubricEntry> = {
  // parity
  MISSING_IN_CODE: { penalty: 15, reach: "none" },
  MISSING_IN_FIGMA: { penalty: 5, reach: "none" },
  PROP_VALUES_DIVERGED: { penalty: 8, reach: "usages" },
  TOKEN_MISMATCH: { penalty: 12, reach: "usages" },
  HARDCODED_VALUE_FIGMA: { penalty: 6, reach: "usages" },
  HARDCODED_VALUE_CODE: { penalty: 8, reach: "usages" },
  // complexity
  REDUNDANT_COMPONENT: { penalty: 25, reach: "none" },
  UNUSED_PROP: { penalty: 8, reach: "none" },
  UNUSED_VARIANT: { penalty: 5, reach: "none" },
  PROP_EXPLOSION: { penalty: 30, reach: "none" },
  // adoption
  UNUSED_COMPONENT: { penalty: 50, reach: "none" },
  SINGLE_FILE_ADOPTION: { penalty: 25, reach: "none" },
  DEPRECATED_STILL_USED: { penalty: 15, reach: "usages" },
  // documentation (weighted lowest via dimensionWeights)
  NO_STORY: { penalty: 35, reach: "none" },
  PROPS_UNDOCUMENTED: { penalty: 25, reach: "none" },
  NO_USAGE_GUIDANCE: { penalty: 25, reach: "none" },
};

/** Severity conservatism must reach the arithmetic: a wall of info findings
 * informs, it does not zero a score. */
export const severityWeights: Record<Severity, number> = {
  info: 0.25,
  warn: 1,
  error: 2,
};

/** A TOKEN_MISMATCH on a 400-instance Button outweighs one on a 3-instance
 * Tag: multiplier grows with usage, capped so one component can't hit -∞. */
export function reachMultiplier(usages: number): number {
  return Math.min(1 + usages / 50, 4);
}

export const dimensionWeights: Record<Dimension, number> = {
  parity: 0.35,
  adoption: 0.3,
  complexity: 0.2,
  documentation: 0.15,
};
