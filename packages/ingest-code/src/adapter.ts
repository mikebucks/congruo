import { readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
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

export interface TokenPatterns {
  /** Identifiers treated as theme objects: `theme.colors.border`. */
  themeIdentifiers?: string[];
  /** Tailwind-ish class prefixes treated as token refs: `bg-`, `p-`. */
  tailwindPrefixes?: string[];
}

export interface CodeConfig {
  /** Local checkout root — see clone.ts for the clone-at-SHA wrapper. */
  rootDir: string;
  repo: string;
  sha: string;
  dsPackage: { name: string; srcGlob: string };
  appGlob: string;
  tokenPatterns?: TokenPatterns;
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
    out.artifacts.push(
      {
        id: config.dsPackage.name,
        side: "code",
        ref: { repo: config.repo, pkg: config.dsPackage.name },
        version: config.sha,
        role: "ds-package",
      },
      {
        id: appArtifactId,
        side: "code",
        ref: { repo: config.repo },
        version: config.sha,
        role: "app",
      },
    );

    const project = new Project({
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });
    const dsSourceFiles = project.addSourceFilesAtPaths(
      join(config.rootDir, config.dsPackage.srcGlob),
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

    extractDefinitions(config, dsFiles, storyBasenames, out);
    extractUsages(config, project, appArtifactId, out);
    return out;
  }
}

function extractDefinitions(
  config: CodeConfig,
  dsFiles: string[],
  storyBasenames: Set<string>,
  out: CanonicalExtract,
): void {
  const parser = makeParser(config, out);
  const docs = parser.parse(dsFiles);
  const patterns = { ...DEFAULT_PATTERNS, ...config.tokenPatterns };

  const byFile = new Map<string, ComponentDoc[]>();
  const seenNames = new Set<string>();
  for (const doc of docs) {
    if (seenNames.has(doc.displayName)) {
      out.diagnostics.push({
        artifactId: config.dsPackage.name,
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
    for (const t of tokensUsed) seenTokens.set(tokenKey(t.token), t.token);
    const fileBase = basename(file).replace(/\.[jt]sx?$/, "");

    for (const doc of fileDocs) {
      const props = Object.entries(doc.props).map(([name, p]) => ({
        name,
        type: p.type.name,
        values: literalValues(p.type),
        required: p.required,
      }));
      if (props.length === 0) {
        out.diagnostics.push({
          artifactId: config.dsPackage.name,
          kind: "unsupported-pattern",
          detail: `PROPS_ALL_INHERITED_OR_NONE: ${doc.displayName} (${relPath})`,
        });
      }
      out.definitions.push({
        ref: {
          kind: "code",
          repo: config.repo,
          pkg: config.dsPackage.name,
          exportSymbol: doc.displayName,
          filePath: relPath,
        },
        artifactId: config.dsPackage.name,
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
      artifactId: config.dsPackage.name,
    })),
  );
}

function makeParser(config: CodeConfig, out: CanonicalExtract) {
  const opts = {
    shouldExtractLiteralValuesFromEnum: true,
    propFilter: (prop: { parent?: { fileName: string } }) =>
      !prop.parent?.fileName.includes("node_modules"),
  };
  try {
    return withCustomConfig(join(config.rootDir, "tsconfig.json"), opts);
  } catch (e) {
    out.diagnostics.push({
      artifactId: config.dsPackage.name,
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
    const dsImports = new Map<string, string>();
    for (const imp of file.getImportDeclarations()) {
      if (imp.getModuleSpecifierValue() !== config.dsPackage.name) continue;
      for (const named of imp.getNamedImports()) {
        dsImports.set(
          named.getAliasNode()?.getText() ?? named.getName(),
          named.getName(),
        );
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
      const exportSymbol = isComponent ? dsImports.get(tag) : undefined;
      out.usages.push({
        definitionRef: exportSymbol
          ? {
              kind: "code",
              repo: config.repo,
              pkg: config.dsPackage.name,
              exportSymbol,
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
