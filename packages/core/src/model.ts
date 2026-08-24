import type { CodeLoc, ComponentRef, Loc, TokenRef } from "./refs.js";

export interface SourceArtifact {
  id: string;
  side: "figma" | "code";
  ref: { fileKey?: string; repo?: string; pkg?: string };
  /** Figma file version or git SHA. */
  version: string;
  role: "library" | "consumer" | "ds-package" | "app";
}

export interface PropDef {
  name: string;
  type: string;
  values: string[];
  required: boolean;
}

export interface ComponentDefinition {
  ref: ComponentRef;
  artifactId: string;
  name: string;
  props: PropDef[];
  variants: Record<string, string[]>;
  tokensUsed: { token: TokenRef; property: string }[];
  hardcodedValues: { value: string; property: string; location: Loc }[];
  docs: {
    storyExists: boolean;
    propsDocumented: boolean;
    usageProse: string | null;
  };
}

export interface ComponentUsage {
  /** null = usage of something we could not resolve to a definition. */
  definitionRef: ComponentRef | null;
  artifactId: string;
  location: Loc;
  overriddenProps: Record<string, unknown>;
}

export interface TokenDefinition {
  ref: TokenRef;
  artifactId: string;
  value?: string;
}

export interface ExtractionDiagnostic {
  artifactId: string;
  kind: "skipped-file" | "parse-error" | "unsupported-pattern" | "api-limit";
  detail: string;
  location?: Loc;
}

export interface CanonicalExtract {
  artifacts: SourceArtifact[];
  definitions: ComponentDefinition[];
  usages: ComponentUsage[];
  tokens: TokenDefinition[];
  diagnostics: ExtractionDiagnostic[];
  /** Blob keys of raw source payloads. */
  rawPayloadRefs: string[];
}

export interface CanonicalGraph {
  figma: CanonicalExtract;
  code: CanonicalExtract;
}

export type ComponentStatus = "stable" | "new" | "experimental" | "deprecated";

export interface PropMapping {
  figmaProp: string;
  codeProp: string;
  valueMap?: Record<string, string>;
}

export interface Mapping {
  figmaRef: ComponentRef;
  codeRef: ComponentRef;
  confidence: number;
  source: "auto" | "user";
  propMappings: PropMapping[];
}

export interface TokenMapping {
  figmaToken: TokenRef;
  codeToken: TokenRef;
  confidence: number;
  source: "auto" | "user";
}

/** Frozen into each snapshot; edits create a new revision. */
export interface MappingSetRevision {
  revision: number;
  mappings: Mapping[];
  statuses: { ref: ComponentRef; status: ComponentStatus }[];
  tokenMappings: TokenMapping[];
}

export type { CodeLoc };
