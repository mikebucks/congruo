export type { BlobStore, SourceAdapter } from "./adapter.js";
export {
  type Analyzer,
  type CreateFindingInput,
  createFinding,
  type Dimension,
  type Finding,
  type FindingType,
  findingRegistry,
  type Severity,
} from "./findings.js";
export { FINGERPRINT_VERSION, fingerprint } from "./identity.js";
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
} from "./model.js";
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
} from "./refs.js";
