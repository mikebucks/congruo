import type {
  BlobStore,
  CanonicalExtract,
  ComponentDefinition,
  ComponentRef,
  ComponentUsage,
  ExtractionDiagnostic,
  FigmaLoc,
  PropDef,
  SourceAdapter,
  SourceArtifact,
  TokenDefinition,
  TokenRef,
} from "@congruo/core";
import { tokenKey } from "@congruo/core";
import { FigmaClient } from "./client";
import type {
  FigmaComponentMeta,
  FigmaFile,
  FigmaNode,
  VariableAlias,
} from "./figma-types";
import { rgbaToHex, styleTokenRef, variableTokenRef } from "./tokens";

export interface FigmaConfig {
  pat: string;
  libraryFileKey: string;
  consumerFileKeys: string[];
}

export class FigmaAdapter implements SourceAdapter<FigmaConfig> {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async extract(
    config: FigmaConfig,
    deps: { blobs: BlobStore },
  ): Promise<CanonicalExtract> {
    const client = new FigmaClient(config.pat, this.fetchImpl);
    const out = emptyExtract();

    const library = await this.loadFile(
      client,
      config.libraryFileKey,
      "library",
      out,
      deps.blobs,
    );
    extractDefinitions(library, config.libraryFileKey, out);

    for (const key of config.consumerFileKeys) {
      const consumer = await this.loadFile(
        client,
        key,
        "consumer",
        out,
        deps.blobs,
      );
      extractUsages(consumer, key, out);
    }
    return out;
  }

  private async loadFile(
    client: FigmaClient,
    fileKey: string,
    role: "library" | "consumer",
    out: CanonicalExtract,
    blobs: BlobStore,
  ): Promise<FigmaFile> {
    const { file, raw } = await client.getFile(fileKey);
    const blobKey = `figma/${fileKey}/${file.version}.json`;
    await blobs.put(blobKey, raw);
    out.rawPayloadRefs.push(blobKey);
    out.artifacts.push({
      id: fileKey,
      side: "figma",
      ref: { fileKey },
      version: file.version,
      role,
    } satisfies SourceArtifact);
    return file;
  }
}

function emptyExtract(): CanonicalExtract {
  return {
    artifacts: [],
    definitions: [],
    usages: [],
    tokens: [],
    diagnostics: [],
    rawPayloadRefs: [],
  };
}

function indexNodes(file: FigmaFile): Map<string, FigmaNode> {
  const byId = new Map<string, FigmaNode>();
  const walk = (n: FigmaNode) => {
    byId.set(n.id, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(file.document);
  return byId;
}

function figmaRef(
  fileKey: string,
  meta: FigmaComponentMeta | undefined,
  nodeId: string,
): ComponentRef {
  return meta?.key
    ? { kind: "figma", fileKey, componentKey: meta.key }
    : { kind: "figma-node", fileKey, nodeId };
}

/** Definitions come from the library file: one per component set, one per
 * standalone component. */
function extractDefinitions(
  file: FigmaFile,
  fileKey: string,
  out: CanonicalExtract,
): void {
  const byId = indexNodes(file);
  const seenTokens = new Map<string, TokenRef>();

  const define = (nodeId: string, meta: FigmaComponentMeta) => {
    const node = byId.get(nodeId);
    if (!node) {
      out.diagnostics.push({
        artifactId: fileKey,
        kind: "api-limit",
        detail: `component "${meta.name}" (${nodeId}) is in the components map but not in the document tree`,
      } satisfies ExtractionDiagnostic);
      return;
    }
    const { props, variants } = splitPropDefs(node);
    const def: ComponentDefinition = {
      ref: figmaRef(fileKey, meta, nodeId),
      artifactId: fileKey,
      name: meta.name,
      props,
      variants,
      tokensUsed: [],
      hardcodedValues: [],
      docs: {
        storyExists: false,
        propsDocumented: false,
        usageProse:
          meta.description ||
          meta.documentationLinks?.map((l) => l.uri).join(" ") ||
          null,
      },
    };
    collectStyleValues(node, file, fileKey, def, seenTokens);
    out.definitions.push(def);
  };

  for (const [nodeId, meta] of Object.entries(file.componentSets)) {
    define(nodeId, meta);
  }
  for (const [nodeId, meta] of Object.entries(file.components)) {
    if (!meta.componentSetId) define(nodeId, meta);
  }
  out.tokens.push(
    ...[...seenTokens.values()].map(
      (ref) => ({ ref, artifactId: fileKey }) satisfies TokenDefinition,
    ),
  );
}

/** Figma prop names carry an internal suffix: "Label#40:17" → "Label". */
function cleanPropName(name: string): string {
  return name.replace(/#\d+:\d+$/, "");
}

function splitPropDefs(node: FigmaNode): {
  props: PropDef[];
  variants: Record<string, string[]>;
} {
  const props: PropDef[] = [];
  const variants: Record<string, string[]> = {};
  for (const [rawName, def] of Object.entries(
    node.componentPropertyDefinitions ?? {},
  )) {
    if (def.type === "VARIANT") {
      variants[rawName] = def.variantOptions ?? [];
    } else {
      props.push({
        name: cleanPropName(rawName),
        type: def.type.toLowerCase(),
        values: [],
        required: false,
      });
    }
  }
  return { props, variants };
}

/** Walk a definition subtree collecting token bindings, style refs, and
 * hardcoded fills. Does not descend into nested INSTANCE nodes — their values
 * belong to the child component's own definition. */
function collectStyleValues(
  root: FigmaNode,
  file: FigmaFile,
  fileKey: string,
  def: ComponentDefinition,
  seenTokens: Map<string, TokenRef>,
): void {
  const usedPairs = new Set<string>();
  const use = (ref: TokenRef, property: string) => {
    const key = `${tokenKey(ref)}|${property}`;
    if (usedPairs.has(key)) return;
    usedPairs.add(key);
    seenTokens.set(tokenKey(ref), ref);
    def.tokensUsed.push({ token: ref, property });
  };

  const walk = (n: FigmaNode, isRoot: boolean) => {
    if (!isRoot && n.type === "INSTANCE") return;

    for (const [property, binding] of Object.entries(n.boundVariables ?? {})) {
      for (const alias of flattenAliases(binding)) {
        use(variableTokenRef(alias.id), property);
      }
    }
    for (const [slot, styleId] of Object.entries(n.styles ?? {})) {
      use(styleTokenRef(styleId, file.styles[styleId]), slot);
    }

    const fillsBound =
      n.boundVariables?.fills !== undefined || n.styles?.fill !== undefined;
    if (!fillsBound) {
      for (const paint of n.fills ?? []) {
        if (
          paint.type === "SOLID" &&
          paint.visible !== false &&
          paint.color &&
          !paint.boundVariables?.color
        ) {
          def.hardcodedValues.push({
            value: rgbaToHex(paint.color),
            property: "fill",
            location: {
              kind: "figma",
              fileKey,
              fileVersion: file.version,
              nodeId: n.id,
            } satisfies FigmaLoc,
          });
        }
      }
    }
    for (const c of n.children ?? []) walk(c, false);
  };
  walk(root, true);
}

function flattenAliases(
  binding: VariableAlias | VariableAlias[] | Record<string, VariableAlias>,
): VariableAlias[] {
  if (Array.isArray(binding)) return binding;
  if ("type" in binding && binding.type === "VARIABLE_ALIAS") {
    return [binding as VariableAlias];
  }
  return Object.values(binding as Record<string, VariableAlias>).filter(
    (v) => v?.type === "VARIABLE_ALIAS",
  );
}

/** Usages come from consumer files: every INSTANCE node, resolved to the
 * library component's stable key via the consumer file's components map. */
function extractUsages(
  file: FigmaFile,
  fileKey: string,
  out: CanonicalExtract,
): void {
  const walk = (n: FigmaNode) => {
    if (n.type === "INSTANCE") {
      const meta = n.componentId ? file.components[n.componentId] : undefined;
      if (!meta) {
        out.diagnostics.push({
          artifactId: fileKey,
          kind: "unsupported-pattern",
          detail: `instance "${n.name}" (${n.id}) has unresolvable componentId ${n.componentId}`,
          location: {
            kind: "figma",
            fileKey,
            fileVersion: file.version,
            nodeId: n.id,
          },
        });
      }
      const overriddenProps: Record<string, unknown> = {};
      for (const [rawName, prop] of Object.entries(
        n.componentProperties ?? {},
      )) {
        overriddenProps[cleanPropName(rawName)] = prop.value;
      }
      out.usages.push({
        definitionRef: meta
          ? resolveToSetRef(file, fileKey, meta, n.componentId ?? n.id)
          : null,
        artifactId: fileKey,
        location: {
          kind: "figma",
          fileKey,
          fileVersion: file.version,
          nodeId: n.id,
        },
        overriddenProps,
      } satisfies ComponentUsage);
      return; // nested instances belong to the child component
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(file.document);
}

/** An instance points at a variant COMPONENT; its definition is the parent
 * COMPONENT_SET when one exists. */
function resolveToSetRef(
  file: FigmaFile,
  fileKey: string,
  meta: FigmaComponentMeta,
  nodeId: string,
): ComponentRef {
  if (meta.componentSetId) {
    const setMeta = file.componentSets[meta.componentSetId];
    if (setMeta) return figmaRef(fileKey, setMeta, meta.componentSetId);
  }
  return figmaRef(fileKey, meta, nodeId);
}
