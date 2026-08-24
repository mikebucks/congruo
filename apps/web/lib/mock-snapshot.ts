import type { ReportSummary } from "./report";

/** Hand-written fixture for WP0.5 — replaced by real snapshot reads in M1+. */
export const mockSummary: ReportSummary = {
  workspaceName: "Acme Design System",
  snapshotDate: "2026-08-24",
  sources: [
    { label: "Figma · ACME UI Library", version: "v2184933002" },
    { label: "Figma · Checkout Flows", version: "v2184933117" },
    { label: "github.com/acme/ui", version: "8f3c2e1" },
  ],
  topline: 68,
  coveragePct: 61,
  tokenHealthPct: 74,
  dimensions: [
    { dimension: "parity", score: 62 },
    { dimension: "complexity", score: 78 },
    { dimension: "adoption", score: 58 },
    { dimension: "documentation", score: null },
  ],
  punchList: [
    {
      type: "TOKEN_MISMATCH",
      severity: "error",
      subjectName: "Button",
      summary:
        "background bound to color/brand/600 in Figma but var(--color-primary-500) in code",
      reach: 412,
    },
    {
      type: "MISSING_IN_CODE",
      severity: "warn",
      subjectName: "Banner / Critical",
      summary: "Figma variant Tone=critical has no code equivalent",
      reach: 63,
    },
    {
      type: "HARDCODED_VALUE_CODE",
      severity: "warn",
      subjectName: "Card",
      summary: "#E5E7EB border where token color/border/subtle matches",
      reach: 188,
    },
    {
      type: "DEPRECATED_STILL_USED",
      severity: "warn",
      subjectName: "LegacySelect",
      summary: "deprecated component still used in 7 files",
      reach: 41,
    },
    {
      type: "UNUSED_COMPONENT",
      severity: "info",
      subjectName: "Stepper",
      summary: "zero instances in consumer files, zero JSX usages",
      reach: 0,
    },
  ],
  scope: {
    consumerFilesInScope: 2,
    codeFilesAnalyzed: 314,
    filesSkipped: 6,
    unassessed: ["documentation (no Storybook detected)"],
  },
};
