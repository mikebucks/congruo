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

/** Registry skeleton — grows to the full MVP set in WP3.1. */
export const findingRegistry = {
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
  HARDCODED_VALUE_CODE: defineFinding({
    type: "HARDCODED_VALUE_CODE",
    dimension: "parity",
    defaultSeverity: "warn",
    evidence: z.object({
      value: z.string(),
      property: z.string(),
      matchingToken: tokenRefSchema.nullable(),
    }),
    discriminator: (e) => `${e.property}=${e.value}`,
  }),
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

export type Analyzer = (
  graph: CanonicalGraph,
  mappings: MappingSetRevision,
  config: Record<string, unknown>,
) => Finding[];
