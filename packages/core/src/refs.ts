/** Source-native identity. Refs are stable across snapshots; mutable working
 * state (mappings, statuses) and finding fingerprints key on them. */

export type FigmaRef =
  /** Stable publish key — globally unique, survives file moves. Preferred. */
  | { kind: "figma"; fileKey: string; componentKey: string }
  /** Fallback when no publish key exists (unpublished components). */
  | { kind: "figma-node"; fileKey: string; nodeId: string };

/** Identity excludes git SHA and file path: a component keeps its identity
 * across commits and file moves. filePath is provenance, not identity. */
export interface CodeRef {
  kind: "code";
  repo: string;
  pkg: string;
  exportSymbol: string;
  filePath: string;
}

export type ComponentRef = FigmaRef | CodeRef;

export type FigmaLoc = {
  kind: "figma";
  fileKey: string;
  fileVersion: string;
  nodeId: string;
};

export type CodeLoc = {
  kind: "code";
  filePath: string;
  sha: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
};

export type Loc = FigmaLoc | CodeLoc;

export interface TokenRef {
  nativeId: string;
  stableKey?: string;
  collection?: string;
  mode?: string;
  resolvedName?: string;
  source: "figma-variable" | "figma-style" | "tokens-studio" | "code";
  resolutionConfidence: "exact" | "inferred" | "unresolved";
}

/** Canonical string identity for a component ref. Used as mapping keys and in
 * finding fingerprints — never include mutable or per-snapshot data. */
export function refKey(ref: ComponentRef): string {
  switch (ref.kind) {
    case "figma":
      return `figma:key:${ref.componentKey}`;
    case "figma-node":
      return `figma:node:${ref.fileKey}:${ref.nodeId}`;
    case "code":
      return `code:${ref.repo}#${ref.pkg}#${ref.exportSymbol}`;
  }
}

/** Canonical string identity for a token. */
export function tokenKey(ref: TokenRef): string {
  return ref.stableKey
    ? `${ref.source}:key:${ref.stableKey}`
    : `${ref.source}:id:${ref.nativeId}`;
}

export function sameRef(a: ComponentRef, b: ComponentRef): boolean {
  return refKey(a) === refKey(b);
}
