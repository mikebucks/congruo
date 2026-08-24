import { z } from "zod";
import { fingerprint } from "./identity";
import type { CanonicalGraph, MappingSetRevision } from "./model";
import type { ComponentRef, Loc, TokenRef } from "./refs";
import { tokenKey } from "./refs";

export type Dimension = "parity" | "complexity" | "adoption" | "documentation";
export type Severity = "info" | "warn" | "error";

export interface FindingDef<E extends z.ZodType> {
  type: string;
  dimension: Dimension;
  defaultSeverity: Severity;
  evidence: E;
  /** Type-specific part of the finding fingerprint. Must be stable across
   * snapshots for the same underlying problem — never derive from locations. */
  discriminator: (evidence: z.output<E>) => string;
}

export interface Finding {
  fingerprint: string;
  type: string;
  dimension: Dimension;
  severity: Severity;
  subjectRef: ComponentRef | null;
  evidence: unknown;
  locations: Loc[];
}

function defineFinding<E extends z.ZodType>(def: FindingDef<E>): FindingDef<E> {
  return def;
}

const tokenRefSchema: z.ZodType<TokenRef> = z.object({
  nativeId: z.string(),
  stableKey: z.string().optional(),
  collection: z.string().optional(),
  mode: z.string().optional(),
  resolvedName: z.string().optional(),
  source: z.enum(["figma-variable", "figma-style", "tokens-studio", "code"]),
  resolutionConfidence: z.enum(["exact", "inferred", "unresolved"]),
});

const hardcodedEvidence = z.object({
  value: z.string(),
  property: z.string(),
  occurrences: z.number().int().positive(),
  /** The token whose value matches — the future auto-fix. Null until token
   * values are resolvable (Tokens Studio upload / Enterprise variables). */
  matchingToken: tokenRefSchema.nullable(),
});

/** The complete MVP registry. Severity policy: uncertain → info, never error. */
export const findingRegistry = {
  // ---- parity ----
  MISSING_IN_CODE: defineFinding({
    type: "MISSING_IN_CODE",
    dimension: "parity",
    defaultSeverity: "warn",
    evidence: z.object({
      figmaName: z.string(),
      variantCount: z.number().int().nonnegative(),
    }),
    discriminator: () => "",
  }),
  MISSING_IN_FIGMA: defineFinding({
    type: "MISSING_IN_FIGMA",
    dimension: "parity",
    defaultSeverity: "info",
    evidence: z.object({
      codeName: z.string(),
      kind: z.enum(["component", "prop"]),
      propName: z.string().optional(),
    }),
    discriminator: (e) => e.propName ?? "",
  }),
  PROP_VALUES_DIVERGED: defineFinding({
    type: "PROP_VALUES_DIVERGED",
    dimension: "parity",
    defaultSeverity: "info",
    evidence: z.object({
      figmaProp: z.string(),
      codeProp: z.string(),
      figmaOnly: z.array(z.string()),
      codeOnly: z.array(z.string()),
    }),
    discriminator: (e) => `${e.figmaProp}<>${e.codeProp}`,
  }),
  TOKEN_MISMATCH: defineFinding({
    type: "TOKEN_MISMATCH",
    dimension: "parity",
    defaultSeverity: "warn",
    evidence: z.object({
      property: z.string(),
      figmaToken: tokenRefSchema,
      codeToken: tokenRefSchema,
    }),
    discriminator: (e) =>
      `${e.property}:${tokenKey(e.figmaToken)}<>${tokenKey(e.codeToken)}`,
  }),
  HARDCODED_VALUE_FIGMA: defineFinding({
    type: "HARDCODED_VALUE_FIGMA",
    dimension: "parity",
    defaultSeverity: "warn",
    evidence: hardcodedEvidence,
    discriminator: (e) => `${e.property}=${e.value}`,
  }),
  HARDCODED_VALUE_CODE: defineFinding({
    type: "HARDCODED_VALUE_CODE",
    dimension: "parity",
    defaultSeverity: "warn",
    evidence: hardcodedEvidence,
    discriminator: (e) => `${e.property}=${e.value}`,
  }),
  // ---- complexity ----
  REDUNDANT_COMPONENT: defineFinding({
    type: "REDUNDANT_COMPONENT",
    dimension: "complexity",
    defaultSeverity: "info",
    evidence: z.object({
      otherName: z.string(),
      otherRefKey: z.string(),
      nameSimilarity: z.number(),
      propOverlap: z.number(),
    }),
    discriminator: (e) => e.otherRefKey,
  }),
  UNUSED_PROP: defineFinding({
    type: "UNUSED_PROP",
    dimension: "complexity",
    defaultSeverity: "info",
    evidence: z.object({
      propName: z.string(),
      observedUsages: z.number().int().nonnegative(),
    }),
    discriminator: (e) => e.propName,
  }),
  UNUSED_VARIANT: defineFinding({
    type: "UNUSED_VARIANT",
    dimension: "complexity",
    defaultSeverity: "info",
    evidence: z.object({
      axis: z.string(),
      value: z.string(),
      observedInstances: z.number().int().nonnegative(),
    }),
    discriminator: (e) => `${e.axis}=${e.value}`,
  }),
  PROP_EXPLOSION: defineFinding({
    type: "PROP_EXPLOSION",
    dimension: "complexity",
    defaultSeverity: "warn",
    evidence: z.object({
      combinationCount: z.number().int().positive(),
      threshold: z.number().int().positive(),
    }),
    discriminator: () => "",
  }),
  // ---- adoption ----
  UNUSED_COMPONENT: defineFinding({
    type: "UNUSED_COMPONENT",
    dimension: "adoption",
    defaultSeverity: "info",
    evidence: z.object({
      instanceCount: z.number().int().nonnegative(),
      usageCount: z.number().int().nonnegative(),
    }),
    discriminator: () => "",
  }),
  SINGLE_FILE_ADOPTION: defineFinding({
    type: "SINGLE_FILE_ADOPTION",
    dimension: "adoption",
    defaultSeverity: "info",
    evidence: z.object({
      usageCount: z.number().int().positive(),
      file: z.string(),
    }),
    discriminator: () => "",
  }),
  DEPRECATED_STILL_USED: defineFinding({
    type: "DEPRECATED_STILL_USED",
    dimension: "adoption",
    defaultSeverity: "warn",
    evidence: z.object({
      instanceCount: z.number().int().nonnegative(),
      usageCount: z.number().int().nonnegative(),
      fileCount: z.number().int().positive(),
    }),
    discriminator: () => "",
  }),
  // ---- documentation ----
  NO_STORY: defineFinding({
    type: "NO_STORY",
    dimension: "documentation",
    defaultSeverity: "info",
    evidence: z.object({ componentName: z.string() }),
    discriminator: () => "",
  }),
  PROPS_UNDOCUMENTED: defineFinding({
    type: "PROPS_UNDOCUMENTED",
    dimension: "documentation",
    defaultSeverity: "info",
    evidence: z.object({ undocumented: z.array(z.string()).nonempty() }),
    discriminator: () => "",
  }),
  NO_USAGE_GUIDANCE: defineFinding({
    type: "NO_USAGE_GUIDANCE",
    dimension: "documentation",
    defaultSeverity: "info",
    evidence: z.object({ componentName: z.string() }),
    discriminator: () => "",
  }),
} as const;

export type FindingType = keyof typeof findingRegistry;

export interface CreateFindingInput<T extends FindingType> {
  type: T;
  subjectRef: ComponentRef | null;
  evidence: z.input<(typeof findingRegistry)[T]["evidence"]>;
  locations: Loc[];
  severity?: Severity;
}

/** Validates evidence against the registry schema and computes the stable
 * fingerprint. Throws on invalid evidence — analyzers must never emit
 * findings the registry can't describe. */
export function createFinding<T extends FindingType>(
  input: CreateFindingInput<T>,
): Finding {
  const def = findingRegistry[input.type];
  const evidence = def.evidence.parse(input.evidence);
  return {
    fingerprint: fingerprint(
      def.type,
      input.subjectRef,
      // biome-ignore lint/suspicious/noExplicitAny: registry lookup erases the per-type evidence link
      def.discriminator(evidence as any),
    ),
    type: def.type,
    dimension: def.dimension,
    severity: input.severity ?? def.defaultSeverity,
    subjectRef: input.subjectRef,
    evidence,
    locations: input.locations,
  };
}

export interface AnalyzerConfig {
  propExplosionThreshold?: number;
}

export type Analyzer = (
  graph: CanonicalGraph,
  mappings: MappingSetRevision,
  config: AnalyzerConfig,
) => Finding[];
