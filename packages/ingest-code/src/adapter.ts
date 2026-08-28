import { globSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type {
  BlobStore,
  CanonicalExtract,
  CodeLoc,
  ComponentDefinition,
  ComponentUsage,
  SourceAdapter,
  TokenRef,
} from "@congruo/core";
import { tokenKey } from "@congruo/core";
import {
  type ComponentDoc,
  withCustomConfig,
  withDefaultConfig,
} from "react-docgen-typescript";
import { Project, SyntaxKind } from "ts-morph";
import {
  loadTokenValues,
  resolveTokenValue,
  type TokenValuesSource,
} from "./token-values";

export interface TokenPatterns {
  /** Identifiers treated as theme objects: `theme.colors.border`. */
  themeIdentifiers?: string[];
  /** Tailwind-ish class prefixes treated as token refs: `bg-`, `p-`. */
  tailwindPrefixes?: string[];
}

export interface DsPackageConfig {
  /** Import specifier the app uses, e.g. "@acme/ui". */
  name: string;
  srcGlob: string;
  /** How definitions are extracted. "react-tsx" = docgen over component
   * source; "svg-assets" = each SVG file is an asset definition (svgr-style
   * icon packages). Default: "react-tsx". */
  strategy?: "react-tsx" | "svg-assets";
}

export interface CodeConfig {
  /** Local checkout root — see clone.ts for the clone-at-SHA wrapper. */
  rootDir: string;
  repo: string;
  sha: string;
  dsPackages: DsPackageConfig[];
  appGlob: string;
  tokenPatterns?: TokenPatterns;
  /** Token definition files (css / json / token-ts) resolving what each
   * referenced token is worth — enables values, and value-based linking. */
  tokenValues?: TokenValuesSource[];
}

const DEFAULT_PATTERNS: Required<TokenPatterns> = {
  themeIdentifiers: ["theme"],
  tailwindPrefixes: [],
};

export class CodeAdapter implements SourceAdapter<CodeConfig> {
  async extract(
    config: CodeConfig,
    _deps: { blobs: BlobStore },
  ): Promise<CanonicalExtract> {
    const out: CanonicalExtract = {
      artifacts: [],
      definitions: [],
      usages: [],
      tokens: [],
      diagnostics: [],
      rawPayloadRefs: [],
    };
    const appArtifactId = `${config.repo}#app`;
    for (const pkg of config.dsPackages) {
      out.artifacts.push({
        id: pkg.name,
        side: "code",
        ref: { repo: config.repo, pkg: pkg.name },
        version: config.sha,
        role: "ds-package",
      });
    }
    out.artifacts.push({
      id: appArtifactId,
      side: "code",
      ref: { repo: config.repo },
      version: config.sha,
      role: "app",
    });

    const project = new Project({
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });
    for (const pkg of config.dsPackages) {
      if (pkg.strategy === "svg-assets") {
        extractSvgAssets(config, pkg, out);
        continue;
      }
      const dsSourceFiles = project.addSourceFilesAtPaths(
        join(config.rootDir, pkg.srcGlob),
      );
      const storyBasenames = new Set(
        dsSourceFiles
          .map((f) => basename(f.getFilePath()))
          .filter((n) => /\.(stories|story)\.[jt]sx?$/.test(n))
          .map((n) => n.replace(/\.(stories|story)\.[jt]sx?$/, "")),
      );
      const dsFiles = dsSourceFiles
        .map((f) => f.getFilePath() as string)
        .filter(
          (p) =>
            !p.endsWith("index.ts") && !/\.(stories|story)\.[jt]sx?$/.test(p),
        );
      extractDefinitions(config, pkg, dsFiles, storyBasenames, out);
    }
    extractUsages(config, project, appArtifactId, out);
    applyTokenValues(config, out);
    return out;
  }
}

/** Resolves referenced code tokens against configured token definition files. */
function applyTokenValues(config: CodeConfig, out: CanonicalExtract): void {
  if (!config.tokenValues || config.tokenValues.length === 0) return;
  const values = loadTokenValues(config.rootDir, config.tokenValues);
  if (values.size === 0) return;
  for (const t of out.tokens) {
    if (t.value) continue;
    const value = resolveTokenValue(t.ref.nativeId, values, config.tokenValues);
    if (value) t.value = value;
  }
}

/** svgr-style asset packages: every SVG is a definition named by its file.
 * Assets match and count toward adoption; they are not documentation-judged. */
function extractSvgAssets(
  config: CodeConfig,
  pkg: DsPackageConfig,
  out: CanonicalExtract,
): void {
  const files = globSync(pkg.srcGlob, { cwd: config.rootDir }).sort();
  for (const file of files) {
    const name = basename(file).replace(/\.svg$/i, "");
    out.definitions.push({
      ref: {
        kind: "code",
        repo: config.repo,
        pkg: pkg.name,
        exportSymbol: name,
        filePath: file,
      },
      artifactId: pkg.name,
      name,
      kind: "asset",
      props: [],
      variants: {},
      tokensUsed: [],
      hardcodedValues: [],
      docs: { storyExists: false, propsDocumented: false, usageProse: null },
    });
  }
  if (files.length === 0) {
    out.diagnostics.push({
      artifactId: pkg.name,
      kind: "skipped-file",
      detail: `svg-assets glob matched no files: ${pkg.srcGlob}`,
    });
  }
}

function extractDefinitions(
  config: CodeConfig,
  pkg: DsPackageConfig,
  dsFiles: string[],
  storyBasenames: Set<string>,
  out: CanonicalExtract,
): void {
  const parser = makeParser(config, pkg, out);
  const docs = parser.parse(dsFiles);
  const patterns = { ...DEFAULT_PATTERNS, ...config.tokenPatterns };

  const byFile = new Map<string, ComponentDoc[]>();
  const seenNames = new Set<string>();
  for (const doc of docs) {
    if (seenNames.has(doc.displayName)) {
      out.diagnostics.push({
        artifactId: pkg.name,
        kind: "unsupported-pattern",
        detail: `DUPLICATE_COMPONENT_NAME: ${doc.displayName}`,
      });
      continue;
    }
    seenNames.add(doc.displayName);
    const file = doc.filePath ?? "";
    byFile.set(file, [...(byFile.get(file) ?? []), doc]);
  }

  const seenTokens = new Map<string, TokenRef>();
  for (const [file, fileDocs] of byFile) {
    const relPath = relative(config.rootDir, file);
    const { tokensUsed, hardcodedValues } = scanStyleText(
      readFileSync(file, "utf8"),
      relPath,
      config.sha,
      patterns,
    );
    // a component's token usage often lives in its stylesheet, not its TSX
    for (const styleFile of globSync("*.{css,scss,sass,less}", {
      cwd: dirname(file),
    }).sort()) {
      const stylePath = join(dirname(file), styleFile);
      const styleRel = relative(config.rootDir, stylePath);
      const scanned = scanStyleText(
        readFileSync(stylePath, "utf8"),
        styleRel,
        config.sha,
        patterns,
      );
      const known = new Set(tokensUsed.map((t) => t.token.nativeId));
      for (const t of scanned.tokensUsed) {
        if (!known.has(t.token.nativeId)) tokensUsed.push(t);
      }
      hardcodedValues.push(...scanned.hardcodedValues);
    }
    for (const t of tokensUsed) seenTokens.set(tokenKey(t.token), t.token);
    const fileBase = basename(file).replace(/\.[jt]sx?$/, "");

    for (const doc of fileDocs) {
      const props = Object.entries(doc.props).map(([name, p]) => ({
        name,
        type: p.type.name,
        values: literalValues(p.type),
        required: p.required,
        documented: p.description.length > 0,
      }));
      if (props.length === 0) {
        out.diagnostics.push({
          artifactId: pkg.name,
          kind: "unsupported-pattern",
          detail: `PROPS_ALL_INHERITED_OR_NONE: ${doc.displayName} (${relPath})`,
        });
      }
      out.definitions.push({
        ref: {
          kind: "code",
          repo: config.repo,
          pkg: pkg.name,
          exportSymbol: doc.displayName,
          filePath: relPath,
        },
        artifactId: pkg.name,
        name: doc.displayName,
        props,
        variants: {},
        tokensUsed,
        hardcodedValues,
        docs: {
          storyExists: storyBasenames.has(fileBase),
          propsDocumented:
            props.length > 0 &&
            Object.values(doc.props).every((p) => p.description.length > 0),
          usageProse: doc.description || null,
        },
      } satisfies ComponentDefinition);
    }
  }
  out.tokens.push(
    ...[...seenTokens.values()].map((ref) => ({
      ref,
      artifactId: pkg.name,
    })),
  );
}

function makeParser(
  config: CodeConfig,
  pkg: DsPackageConfig,
  out: CanonicalExtract,
) {
  const opts = {
    shouldExtractLiteralValuesFromEnum: true,
    propFilter: (prop: { parent?: { fileName: string } }) =>
      !prop.parent?.fileName.includes("node_modules"),
  };
  try {
    return withCustomConfig(join(config.rootDir, "tsconfig.json"), opts);
  } catch (e) {
    out.diagnostics.push({
      artifactId: pkg.name,
      kind: "parse-error",
      detail: `TSCONFIG_UNRESOLVED: ${String(e).slice(0, 200)} — using default compiler options`,
    });
    return withDefaultConfig(opts);
  }
}

function literalValues(type: { name: string; value?: unknown }): string[] {
  if (type.name !== "enum" || !Array.isArray(type.value)) return [];
  return type.value
    .map((v: { value?: string }) => v.value?.replace(/^"|"$/g, "") ?? "")
    .filter((v) => v.length > 0);
}

function codeToken(nativeId: string): TokenRef {
  return {
    nativeId,
    resolvedName: nativeId,
    source: "code",
    resolutionConfidence: "exact",
  };
}

/** Token/hardcoded detection over source text. Patterns are configurable per
 * workspace: CSS custom properties, theme-object lookups, Tailwind prefixes. */
function scanStyleText(
  text: string,
  filePath: string,
  sha: string,
  patterns: Required<TokenPatterns>,
) {
  const tokensUsed: ComponentDefinition["tokensUsed"] = [];
  const hardcodedValues: ComponentDefinition["hardcodedValues"] = [];
  const seen = new Set<string>();
  const use = (id: string, property: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    tokensUsed.push({ token: codeToken(id), property });
  };

  for (const m of text.matchAll(/var\((--[a-z0-9-]+)\)/gi)) {
    use(m[1] ?? "", "style");
  }
  for (const ident of patterns.themeIdentifiers) {
    const re = new RegExp(
      `\\b${ident}((?:\\.[a-zA-Z0-9_$]+|\\[["'][^"']+["']\\])+)`,
      "g",
    );
    for (const m of text.matchAll(re)) {
      const path = (m[1] ?? "")
        .replace(/\[["']([^"']+)["']\]/g, ".$1")
        .replace(/^\./, "");
      use(`${ident}.${path}`, "style");
    }
  }
  if (patterns.tailwindPrefixes.length > 0) {
    for (const m of text.matchAll(/className="([^"]+)"/g)) {
      for (const cls of (m[1] ?? "").split(/\s+/)) {
        if (patterns.tailwindPrefixes.some((p) => cls.startsWith(p))) {
          use(cls, "class");
        }
      }
    }
  }
  for (const m of text.matchAll(/#[0-9a-f]{6}\b/gi)) {
    hardcodedValues.push({
      value: m[0].toLowerCase(),
      property: "style",
      location: locAt(text, m.index, filePath, sha),
    });
  }
  return { tokensUsed, hardcodedValues };
}

function locAt(
  text: string,
  index: number,
  filePath: string,
  sha: string,
): CodeLoc {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const col = index - before.lastIndexOf("\n");
  return { kind: "code", filePath, sha, line, col, endLine: line, endCol: col };
}

function extractUsages(
  config: CodeConfig,
  project: Project,
  appArtifactId: string,
  out: CanonicalExtract,
): void {
  const appFiles = project.addSourceFilesAtPaths(
    join(config.rootDir, config.appGlob),
  );
  for (const file of appFiles) {
    const relPath = relative(config.rootDir, file.getFilePath());
    const packageNames = new Set(config.dsPackages.map((p) => p.name));
    const dsImports = new Map<string, { pkg: string; exportSymbol: string }>();
    for (const imp of file.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!packageNames.has(spec)) continue;
      for (const named of imp.getNamedImports()) {
        dsImports.set(named.getAliasNode()?.getText() ?? named.getName(), {
          pkg: spec,
          exportSymbol: named.getName(),
        });
      }
    }

    const jsxNodes = [
      ...file.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...file.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];
    for (const jsx of jsxNodes) {
      const tag = jsx.getTagNameNode().getText();
      const attrs = jsx.getAttributes();
      const overriddenProps: Record<string, unknown> = {};
      let styled = false;
      for (const attr of attrs) {
        if (!attr.isKind(SyntaxKind.JsxAttribute)) continue;
        const name = attr.getNameNode().getText();
        if (name === "style" || name === "className") styled = true;
        const init = attr.getInitializer();
        overriddenProps[name] = init?.isKind(SyntaxKind.StringLiteral)
          ? init.getLiteralValue()
          : (init?.getText() ?? true);
      }

      const isComponent = /^[A-Z]/.test(tag);
      if (!isComponent && !styled) continue; // plain host element: not tracked

      const { line, column } = file.getLineAndColumnAtPos(jsx.getStart());
      const dsImport = isComponent ? dsImports.get(tag) : undefined;
      out.usages.push({
        definitionRef: dsImport
          ? {
              kind: "code",
              repo: config.repo,
              pkg: dsImport.pkg,
              exportSymbol: dsImport.exportSymbol,
              filePath: "",
            }
          : null,
        artifactId: appArtifactId,
        location: {
          kind: "code",
          filePath: relPath,
          sha: config.sha,
          line,
          col: column,
          endLine: line,
          endCol: column,
        },
        overriddenProps,
        kind: isComponent ? "component" : "styled-element",
        name: tag,
      } satisfies ComponentUsage);
    }
  }
}
