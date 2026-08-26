export type { BlobStore, SourceAdapter } from "./adapter";
export {
  type Analyzer,
  type AnalyzerConfig,
  type CreateFindingInput,
  createFinding,
  type Dimension,
  type Finding,
  type FindingType,
  findingRegistry,
  type Severity,
} from "./findings";
export {
  applyIgnores,
  type PairedComponent,
  pairComponents,
  pairUsage,
  resolveStatuses,
  type UsageStats,
  usageStats,
  variantCombinations,
} from "./graph";
export { FINGERPRINT_VERSION, fingerprint } from "./identity";
export {
  AUTO_THRESHOLD,
  DEFAULT_MATCHER_CONFIG,
  type MatcherConfig,
  type MatchResult,
  matchProps,
  normalizeName,
  proposeMappings,
  proposeTokenMappings,
  SUGGEST_THRESHOLD,
  similarity,
} from "./matcher/index";
export type {
  CanonicalExtract,
  CanonicalGraph,
  ComponentDefinition,
  ComponentStatus,
  ComponentUsage,
  ExtractionDiagnostic,
  Mapping,
  MappingSetRevision,
  PropDef,
  PropMapping,
  SourceArtifact,
  TokenDefinition,
  TokenMapping,
} from "./model";
export {
  type CodeLoc,
  type ComponentRef,
  type FigmaLoc,
  type FigmaRef,
  type Loc,
  refKey,
  sameRef,
  type TokenRef,
  tokenKey,
} from "./refs";
