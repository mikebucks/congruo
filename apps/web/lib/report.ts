import type { Dimension, Severity } from "@congruo/core";

/** Read model the summary page renders. Built from snapshot-owned rows only —
 * never by deserializing the canonical graph. */
export interface ReportSummary {
  workspaceName: string;
  snapshotDate: string;
  sources: { label: string; version: string }[];
  topline: number;
  coveragePct: number;
  tokenHealthPct: number;
  dimensions: { dimension: Dimension; score: number | null }[];
  punchList: PunchItem[];
  scope: {
    consumerFilesInScope: number;
    codeFilesAnalyzed: number;
    filesSkipped: number;
    unassessed: string[];
  };
}

export interface PunchItem {
  type: string;
  severity: Severity;
  subjectName: string;
  summary: string;
  reach: number;
}
