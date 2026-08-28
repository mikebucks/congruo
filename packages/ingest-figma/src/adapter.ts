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
  /** name → value map naming otherwise-nameless variables by their resolved
   * value. Source-agnostic: Dev Mode MCP extraction, a Figma plugin export,
   * or Tokens Studio — the REST Variables API needs Enterprise, names don't. */
  tokenOverlay?: Record<string, string>;
  /** variable id → name, for variables whose VALUE is ambiguous (three tokens
   * sharing #303030). Ids are local ("24:6777") or remote key hashes; joined
   * by identity, so these always win over value matching. */
  tokenOverlayIds?: Record<string, string>;
  /** THE self-serve source of truth: the complete variables table exported by
   * the Congruo Figma plugin (Plugin API — all plans). ID-keyed and exact;
   * overlays and render-value capture are fallbacks beneath it. */
  tokenManifest?: TokenManifestEntry[];
}

export interface TokenManifestEntry {
  /** "VariableID:24:6777" or bare "24:6777". */
  id: string;
  /** Stable publish key when the variable is published. */
  key?: string;
  name: string;
  /** COLOR / FLOAT / STRING / BOOLEAN. */
  type?: string;
  /** Resolved value in the default mode, e.g. "#303030" or "12". */
  value?: string;
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
    applyTokenManifest(out, config.tokenManifest);
    applyTokenOverlay(out, config.tokenOverlay, config.tokenOverlayIds);

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

/** Applies the plugin-exported variables table: exact names, types, and
 * values joined by variable identity. Complete and unambiguous — this is what
 * "the system knows every token" means. */
function applyTokenManifest(
  out: CanonicalExtract,
  manifest: TokenManifestEntry[] | undefined,
): void {
  if (!manifest || manifest.length === 0) return;
  const normId = (id: string) => id.replace(/^VariableID:/, "");
  const byId = new Map<string, TokenManifestEntry>();
  const byKey = new Map<string, TokenManifestEntry>();
  for (const entry of manifest) {
    byId.set(normId(entry.id), entry);
    if (entry.key) byKey.set(entry.key, entry);
  }
  const lookup = (ref: TokenRef): TokenManifestEntry | undefined => {
    const local = normId(ref.nativeId).replace(/^.*[/]/, "");
    return (
      byId.get(normId(ref.nativeId)) ??
      byId.get(local) ??
      (ref.stableKey ? byKey.get(ref.stableKey) : undefined)
    );
  };
  const apply = (ref: TokenRef): TokenManifestEntry | undefined => {
    if (ref.source !== "figma-variable" && ref.source !== "figma-style") {
      return undefined;
    }
    const entry = lookup(ref);
    if (entry) {
      ref.resolvedName = entry.name;
      ref.resolutionConfidence = "exact";
    }
    return entry;
  };
  for (const t of out.tokens) {
    const entry = apply(t.ref);
    if (entry) {
      if (entry.value) t.value = entry.value;
      if (entry.type) t.type = entry.type;
    }
  }
  for (const def of out.definitions) {
    for (const used of def.tokensUsed) apply(used.token);
  }
}

/** Names variables whose captured value matches exactly one overlay entry.
 * Ambiguous values (two names sharing #ffffff, every "0") stay nameless —
 * inferred, never guessed. */
function applyTokenOverlay(
  out: CanonicalExtract,
  overlay: Record<string, string> | undefined,
  overlayIds: Record<string, string> | undefined,
): void {
  if (!overlay && !overlayIds) return;
  const byValue = new Map<string, string | null>(); // null = ambiguous
  for (const [name, value] of Object.entries(overlay ?? {})) {
    const v = value.trim().toLowerCase();
    byValue.set(v, byValue.has(v) ? null : name);
  }
  const nameFor = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    return byValue.get(value.trim().toLowerCase()) ?? undefined;
  };
  // ids join by identity: "24:6777" (local) or the remote key hash
  const byId = (ref: TokenRef): string | undefined => {
    if (!overlayIds) return undefined;
    const local = ref.nativeId.replace(/^VariableID:/, "").replace(/^.*\//, "");
    return (
      overlayIds[ref.nativeId] ??
      overlayIds[local] ??
      (ref.stableKey ? overlayIds[ref.stableKey] : undefined)
    );
  };
  const named = new Map<string, string>();
  for (const t of out.tokens) {
    if (t.ref.source !== "figma-variable" || t.ref.resolvedName) continue;
    const name = byId(t.ref) ?? nameFor(t.value);
    if (name) {
      t.ref.resolvedName = name;
      t.ref.resolutionConfidence = "inferred";
      named.set(tokenKey(t.ref), name);
    }
  }
  for (const def of out.definitions) {
    for (const used of def.tokensUsed) {
      const name = named.get(tokenKey(used.token));
      if (name && !used.token.resolvedName) {
        used.token.resolvedName = name;
        used.token.resolutionConfidence = "inferred";
      }
    }
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
  const tokenValues = new Map<string, string>();

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
    collectStyleValues(node, file, fileKey, def, seenTokens, tokenValues);
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
      (ref) =>
        ({
          ref,
          artifactId: fileKey,
          value: tokenValues.get(tokenKey(ref)),
        }) satisfies TokenDefinition,
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
        documented: false,
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
  tokenValues: Map<string, string>,
): void {
  const usedPairs = new Set<string>();
  const use = (ref: TokenRef, property: string) => {
    const key = `${tokenKey(ref)}|${property}`;
    if (usedPairs.has(key)) return;
    usedPairs.add(key);
    seenTokens.set(tokenKey(ref), ref);
    def.tokensUsed.push({ token: ref, property });
  };
  // Variable NAMES need the Enterprise API, but file JSON carries the
  // RESOLVED render values right next to the bindings — capture them so a
  // nameless variable can display as what it is (#005bd3, 16px…).
  const capture = (variableId: string, value: string) => {
    const key = tokenKey(variableTokenRef(variableId));
    if (!tokenValues.has(key)) tokenValues.set(key, value);
  };

  const walk = (n: FigmaNode, isRoot: boolean) => {
    if (!isRoot && n.type === "INSTANCE") return;

    for (const [property, binding] of Object.entries(n.boundVariables ?? {})) {
      for (const alias of flattenAliases(binding)) {
        use(variableTokenRef(alias.id), property);
      }
    }

    // resolved values co-located with bindings
    for (const paints of [n.fills, n.strokes]) {
      for (const paint of paints ?? []) {
        const boundId = paint.boundVariables?.color?.id;
        if (boundId && paint.type === "SOLID" && paint.color) {
          capture(boundId, rgbaToHex(paint.color));
        }
      }
    }
    for (const slot of ["fills", "strokes"] as const) {
      const aliases = n.boundVariables?.[slot];
      const paints = slot === "fills" ? n.fills : n.strokes;
      const solid = (paints ?? []).filter(
        (p) => p.type === "SOLID" && p.visible !== false && p.color,
      );
      if (aliases && solid.length === 1 && solid[0]?.color) {
        const [alias] = flattenAliases(aliases);
        if (alias) capture(alias.id, rgbaToHex(solid[0].color));
      }
    }
    for (const prop of [
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "itemSpacing",
      "cornerRadius",
      "strokeWeight",
    ] as const) {
      const binding = n.boundVariables?.[prop];
      const value = n[prop];
      if (binding && typeof value === "number") {
        const [alias] = flattenAliases(binding);
        if (alias) capture(alias.id, String(value));
      }
    }
    if (n.boundVariables?.fontSize && n.style?.fontSize !== undefined) {
      const [alias] = flattenAliases(n.boundVariables.fontSize);
      if (alias) capture(alias.id, String(n.style.fontSize));
    }
    for (const [slot, styleId] of Object.entries(n.styles ?? {})) {
      use(styleTokenRef(styleId, file.styles[styleId]), slot);
    }

    const loc = (): FigmaLoc => ({
      kind: "figma",
      fileKey,
      fileVersion: file.version,
      nodeId: n.id,
    });
    const hardcode = (value: string, property: string) =>
      def.hardcodedValues.push({ value, property, location: loc() });

    for (const [slot, paints] of [
      ["fill", n.fills],
      ["stroke", n.strokes],
    ] as const) {
      const bound =
        n.boundVariables?.[`${slot}s`] !== undefined ||
        n.styles?.[slot] !== undefined ||
        (slot === "stroke" && n.styles?.strokes !== undefined);
      if (bound) continue;
      for (const paint of paints ?? []) {
        if (
          paint.type === "SOLID" &&
          paint.visible !== false &&
          paint.color &&
          !paint.boundVariables?.color
        ) {
          hardcode(rgbaToHex(paint.color), slot);
        }
      }
    }

    if (
      n.type === "TEXT" &&
      n.style?.fontSize !== undefined &&
      n.boundVariables?.fontSize === undefined &&
      n.styles?.text === undefined
    ) {
      hardcode(String(n.style.fontSize), "fontSize");
    }
    for (const prop of [
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "itemSpacing",
    ] as const) {
      const value = n[prop];
      if (
        typeof value === "number" &&
        value !== 0 &&
        n.boundVariables?.[prop] === undefined
      ) {
        hardcode(String(value), prop);
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
        kind: "component",
        name: meta?.name ?? n.name,
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
