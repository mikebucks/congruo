export type { BlobStore, SourceAdapter } from "./adapter";
export {
  type Analyzer,
  type CreateFindingInput,
  createFinding,
  type Dimension,
  type Finding,
  type FindingType,
  findingRegistry,
  type Severity,
} from "./findings";
export { FINGERPRINT_VERSION, fingerprint } from "./identity";
export {
  AUTO_THRESHOLD,
  type MatchResult,
  normalizeName,
  proposeMappings,
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
