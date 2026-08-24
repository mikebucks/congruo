import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
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

export interface CodeConfig {
  /** Local checkout root. Clone-at-SHA wrapping arrives with the pipeline. */
  rootDir: string;
  repo: string;
  sha: string;
  dsPackage: { name: string; srcGlob: string };
  appGlob: string;
}

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
    const dsFiles = project
      .addSourceFilesAtPaths(join(config.rootDir, config.dsPackage.srcGlob))
      .map((f) => f.getFilePath() as string)
      .filter((p) => !p.endsWith("index.ts"));

    extractDefinitions(config, dsFiles, out);
    extractUsages(config, project, appArtifactId, out);
    return out;
  }
}

function extractDefinitions(
  config: CodeConfig,
  dsFiles: string[],
  out: CanonicalExtract,
): void {
  const parser = makeParser(config, out);
  const docs = parser.parse(dsFiles);

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
    );
    for (const t of tokensUsed) seenTokens.set(tokenKey(t.token), t.token);

    for (const doc of fileDocs) {
      const props = Object.entries(doc.props).map(([name, p]) => ({
        name,
        type: p.type.name,
        values: literalValues(p.type),
        required: p.required,
      }));
      if (Object.keys(doc.props).length === 0) {
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
          storyExists: false,
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

/** Narrow WP1.3 detection: CSS custom properties as tokens, hex literals as
 * hardcoded values. Configurable pattern list arrives in WP2.2. */
function scanStyleText(text: string, filePath: string, sha: string) {
  const tokensUsed: ComponentDefinition["tokensUsed"] = [];
  const hardcodedValues: ComponentDefinition["hardcodedValues"] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(/var\((--[a-z0-9-]+)\)/gi)) {
    const name = m[1] ?? "";
    if (seen.has(name)) continue;
    seen.add(name);
    tokensUsed.push({
      token: {
        nativeId: name,
        resolvedName: name,
        source: "code",
        resolutionConfidence: "exact",
      },
      property: "style",
    });
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
        dsImports.set(named.getAliasNode()?.getText() ?? named.getName(), named.getName());
      }
    }

    const jsxNodes = [
      ...file.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...file.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];
    for (const jsx of jsxNodes) {
      const tag = jsx.getTagNameNode().getText();
      if (!/^[A-Z]/.test(tag)) continue; // host elements: coverage work, WP2.2

      const exportSymbol = dsImports.get(tag);
      const start = jsx.getStart();
      const { line, column } = file.getLineAndColumnAtPos(start);
      const overriddenProps: Record<string, unknown> = {};
      for (const attr of jsx.getAttributes()) {
        if (!attr.isKind(SyntaxKind.JsxAttribute)) continue;
        const init = attr.getInitializer();
        overriddenProps[attr.getNameNode().getText()] =
          init?.isKind(SyntaxKind.StringLiteral)
            ? init.getLiteralValue()
            : (init?.getText() ?? true);
      }
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
      } satisfies ComponentUsage);
    }
  }
}
