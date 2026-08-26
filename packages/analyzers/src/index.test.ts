import type {
  CanonicalExtract,
  CanonicalGraph,
  ComponentDefinition,
  ComponentRef,
  ComponentUsage,
  Finding,
  MappingSetRevision,
  PropDef,
  TokenRef,
} from "@congruo/core";
import { expect, test } from "vitest";
import { runAnalyzers } from "./index";

const figmaRef = (key: string): ComponentRef => ({
  kind: "figma",
  fileKey: "LIB",
  componentKey: key,
});
const codeRef = (symbol: string): ComponentRef => ({
  kind: "code",
  repo: "acme/ui",
  pkg: "@acme/ui",
  exportSymbol: symbol,
  filePath: `src/${symbol}.tsx`,
});

const prop = (name: string, extra: Partial<PropDef> = {}): PropDef => ({
  name,
  type: "string",
  values: [],
  required: false,
  documented: false,
  ...extra,
});

function def(
  ref: ComponentRef,
  name: string,
  extra: Partial<ComponentDefinition> = {},
): ComponentDefinition {
  return {
    ref,
    artifactId: "a",
    name,
    props: [],
    variants: {},
    tokensUsed: [],
    hardcodedValues: [],
    docs: { storyExists: false, propsDocumented: false, usageProse: null },
    ...extra,
  };
}

function usage(
  ref: ComponentRef | null,
  overrides: Record<string, unknown> = {},
  file = "app/Home.tsx",
): ComponentUsage {
  return {
    definitionRef: ref,
    artifactId: "consumer",
    location: {
      kind: "code",
      filePath: file,
      sha: "s",
      line: 1,
      col: 1,
      endLine: 1,
      endCol: 1,
    },
    overriddenProps: overrides,
    kind: "component",
    name: "X",
  };
}

const extract = (partial: Partial<CanonicalExtract>): CanonicalExtract => ({
  artifacts: [],
  definitions: [],
  usages: [],
  tokens: [],
  diagnostics: [],
  rawPayloadRefs: [],
  ...partial,
});

const graphOf = (
  figma: Partial<CanonicalExtract>,
  code: Partial<CanonicalExtract>,
): CanonicalGraph => ({ figma: extract(figma), code: extract(code) });

const noMappings: MappingSetRevision = {
  revision: 1,
  mappings: [],
  statuses: [],
  tokenMappings: [],
};

const mappingOf = (
  figma: ComponentRef,
  code: ComponentRef,
  extra: Partial<MappingSetRevision> = {},
): MappingSetRevision => ({
  ...noMappings,
  mappings: [
    {
      figmaRef: figma,
      codeRef: code,
      confidence: 1,
      source: "auto",
      propMappings: [],
    },
  ],
  ...extra,
});

const byType = (findings: Finding[], type: string) =>
  findings.filter((f) => f.type === type);

// ---- parity ----

test("MISSING_IN_CODE / MISSING_IN_FIGMA fire only for unmapped components", () => {
  const graph = graphOf(
    {
      definitions: [
        def(figmaRef("k1"), "Button"),
        def(figmaRef("k2"), "Banner"),
      ],
    },
    {
      definitions: [
        def(codeRef("Button"), "Button"),
        def(codeRef("Extra"), "Extra"),
      ],
    },
  );
  const findings = runAnalyzers(
    graph,
    mappingOf(figmaRef("k1"), codeRef("Button")),
    {},
  );
  expect(byType(findings, "MISSING_IN_CODE")).toHaveLength(1);
  expect(byType(findings, "MISSING_IN_CODE")[0]?.evidence).toMatchObject({
    figmaName: "Banner",
  });
  const mif = byType(findings, "MISSING_IN_FIGMA").filter(
    (f) => (f.evidence as { kind: string }).kind === "component",
  );
  expect(mif).toHaveLength(1);
  expect(mif[0]?.evidence).toMatchObject({ codeName: "Extra" });
});

test("prop-level MISSING_IN_FIGMA and PROP_VALUES_DIVERGED on mapped pairs", () => {
  const graph = graphOf(
    {
      definitions: [
        def(figmaRef("k1"), "Button", {
          variants: { Size: ["Small", "Medium", "Huge"] },
        }),
      ],
    },
    {
      definitions: [
        def(codeRef("Button"), "Button", {
          props: [
            prop("size", { type: "enum", values: ["sm", "md", "xl"] }),
            prop("onClick"),
            prop("children"),
          ],
        }),
      ],
    },
  );
  const findings = runAnalyzers(
    graph,
    mappingOf(figmaRef("k1"), codeRef("Button")),
    {},
  );
  const propMissing = byType(findings, "MISSING_IN_FIGMA").filter(
    (f) => (f.evidence as { kind: string }).kind === "prop",
  );
  expect(
    propMissing.map((f) => (f.evidence as { propName: string }).propName),
  ).toEqual(["onClick"]); // size matched, children ignored
  const diverged = byType(findings, "PROP_VALUES_DIVERGED");
  expect(diverged).toHaveLength(1);
  expect(diverged[0]?.evidence).toMatchObject({
    figmaOnly: ["Huge"],
    codeOnly: ["xl"],
  });
});

test("TOKEN_MISMATCH requires a token mapping; without one nothing is guessed", () => {
  const figmaToken: TokenRef = {
    nativeId: "V:1",
    resolvedName: "color/primary",
    source: "figma-variable",
    resolutionConfidence: "exact",
  };
  const codeToken: TokenRef = {
    nativeId: "--color-primary",
    resolvedName: "--color-primary",
    source: "code",
    resolutionConfidence: "exact",
  };
  const graph = graphOf(
    {
      definitions: [
        def(figmaRef("k1"), "Button", {
          tokensUsed: [{ token: figmaToken, property: "fills" }],
        }),
      ],
    },
    {
      definitions: [def(codeRef("Button"), "Button", { tokensUsed: [] })],
    },
  );
  const unmapped = runAnalyzers(
    graph,
    mappingOf(figmaRef("k1"), codeRef("Button")),
    {},
  );
  expect(byType(unmapped, "TOKEN_MISMATCH")).toHaveLength(0);

  const withTokenMapping = mappingOf(figmaRef("k1"), codeRef("Button"), {
    tokenMappings: [{ figmaToken, codeToken, confidence: 0.9, source: "auto" }],
  });
  const found = byType(
    runAnalyzers(graph, withTokenMapping, {}),
    "TOKEN_MISMATCH",
  );
  expect(found).toHaveLength(1);
  expect(found[0]?.severity).toBe("info"); // auto mapping → conservative
});

test("hardcoded values aggregate per (property, value) with matching token", () => {
  const loc = (line: number) => ({
    kind: "code" as const,
    filePath: "src/Button.tsx",
    sha: "s",
    line,
    col: 1,
    endLine: line,
    endCol: 1,
  });
  const graph = graphOf(
    {},
    {
      definitions: [
        def(codeRef("Button"), "Button", {
          hardcodedValues: [
            { value: "#ff5733", property: "style", location: loc(1) },
            { value: "#ff5733", property: "style", location: loc(9) },
            { value: "#000000", property: "style", location: loc(5) },
          ],
        }),
      ],
      tokens: [
        {
          ref: {
            nativeId: "--color-accent",
            source: "code",
            resolutionConfidence: "exact",
          },
          artifactId: "a",
          value: "#FF5733",
        },
      ],
    },
  );
  const findings = byType(
    runAnalyzers(graph, noMappings, {}),
    "HARDCODED_VALUE_CODE",
  );
  expect(findings).toHaveLength(2); // aggregated, not 3
  const accent = findings.find(
    (f) => (f.evidence as { value: string }).value === "#ff5733",
  );
  expect(accent?.evidence).toMatchObject({
    occurrences: 2,
    matchingToken: { nativeId: "--color-accent" },
  });
  expect(accent?.locations).toHaveLength(2);
});

// ---- complexity ----

test("REDUNDANT_COMPONENT: ButtonNew flagged against Button", () => {
  const shared = [prop("variant"), prop("label"), prop("disabled")];
  const graph = graphOf(
    {},
    {
      definitions: [
        def(codeRef("Button"), "Button", { props: shared }),
        def(codeRef("ButtonNew"), "ButtonNew", { props: shared.slice(0, 2) }),
        def(codeRef("Banner"), "Banner", { props: [prop("message")] }),
      ],
      usages: [usage(codeRef("Button"))],
    },
  );
  const findings = byType(
    runAnalyzers(graph, noMappings, {}),
    "REDUNDANT_COMPONENT",
  );
  expect(findings).toHaveLength(1);
  expect(
    findings[0]?.subjectRef?.kind === "code" &&
      findings[0].subjectRef.exportSymbol,
  ).toBe("ButtonNew"); // the lesser-used one
  expect(findings[0]?.evidence).toMatchObject({ otherName: "Button" });
});

test("UNUSED_PROP ignores children and only fires with observed usages", () => {
  const graph = graphOf(
    {},
    {
      definitions: [
        def(codeRef("Tag"), "Tag", {
          props: [prop("label"), prop("rounded"), prop("children")],
        }),
        def(codeRef("Ghost"), "Ghost", { props: [prop("x")] }), // zero usages
      ],
      usages: [usage(codeRef("Tag"), { label: "hi" })],
    },
  );
  const findings = byType(runAnalyzers(graph, noMappings, {}), "UNUSED_PROP");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.evidence).toMatchObject({ propName: "rounded" });
});

test("UNUSED_VARIANT needs enough usages and an observed axis", () => {
  const tone = { Tone: ["neutral", "critical", "magic"] };
  const mk = (n: number, axisObserved: boolean) =>
    graphOf(
      {
        definitions: [def(figmaRef("k1"), "Button", { variants: tone })],
        usages: Array.from({ length: n }, () =>
          usage(figmaRef("k1"), axisObserved ? { Tone: "neutral" } : {}),
        ),
      },
      {},
    );
  expect(
    byType(runAnalyzers(mk(3, true), noMappings, {}), "UNUSED_VARIANT"),
  ).toHaveLength(0);
  expect(
    byType(runAnalyzers(mk(6, false), noMappings, {}), "UNUSED_VARIANT"),
  ).toHaveLength(0);
  const fired = byType(
    runAnalyzers(mk(6, true), noMappings, {}),
    "UNUSED_VARIANT",
  );
  expect(
    fired.map((f) => (f.evidence as { value: string }).value).sort(),
  ).toEqual(["critical", "magic"]);
});

test("PROP_EXPLOSION respects the configurable threshold", () => {
  const graph = graphOf(
    {
      definitions: [
        def(figmaRef("k1"), "Mega", {
          variants: {
            A: ["1", "2", "3", "4"],
            B: ["1", "2", "3", "4"],
            C: ["1", "2", "3", "4"],
          },
        }), // 64 combinations
      ],
    },
    {},
  );
  expect(
    byType(runAnalyzers(graph, noMappings, {}), "PROP_EXPLOSION"),
  ).toHaveLength(1);
  expect(
    byType(
      runAnalyzers(graph, noMappings, { propExplosionThreshold: 100 }),
      "PROP_EXPLOSION",
    ),
  ).toHaveLength(0);
});

// ---- adoption ----

test("adoption: unused, single-file, and the deprecated inversion", () => {
  const graph = graphOf(
    {},
    {
      definitions: [
        def(codeRef("Stepper"), "Stepper"),
        def(codeRef("Card"), "Card"),
        def(codeRef("Legacy"), "Legacy"),
        def(codeRef("Retired"), "Retired"),
      ],
      usages: [
        usage(codeRef("Card"), {}, "app/Home.tsx"),
        usage(codeRef("Card"), {}, "app/Home.tsx"),
        usage(codeRef("Legacy"), {}, "app/Old.tsx"),
      ],
    },
  );
  const statuses: MappingSetRevision = {
    ...noMappings,
    statuses: [
      { ref: codeRef("Legacy"), status: "deprecated" },
      { ref: codeRef("Retired"), status: "deprecated" },
    ],
  };
  const findings = runAnalyzers(graph, statuses, {});
  expect(
    byType(findings, "UNUSED_COMPONENT").map(
      (f) => f.subjectRef?.kind === "code" && f.subjectRef.exportSymbol,
    ),
  ).toEqual(["Stepper"]); // Retired: deprecated + unused = success, no finding
  expect(byType(findings, "SINGLE_FILE_ADOPTION")).toHaveLength(1);
  expect(byType(findings, "SINGLE_FILE_ADOPTION")[0]?.evidence).toMatchObject({
    usageCount: 2,
    file: "app/Home.tsx",
  });
  const deprecated = byType(findings, "DEPRECATED_STILL_USED");
  expect(deprecated).toHaveLength(1);
  expect(
    deprecated[0]?.subjectRef?.kind === "code" &&
      deprecated[0].subjectRef.exportSymbol,
  ).toBe("Legacy");
});

// ---- documentation ----

test("documentation signals; figma-only components emit none", () => {
  const graph = graphOf(
    {
      definitions: [
        def(figmaRef("k1"), "Banner", {
          docs: {
            storyExists: false,
            propsDocumented: false,
            usageProse: "Use for alerts",
          },
        }),
        def(figmaRef("k9"), "FigmaOnly"),
      ],
    },
    {
      definitions: [
        def(codeRef("Banner"), "Banner", {
          props: [prop("message"), prop("tone", { documented: true })],
        }),
      ],
    },
  );
  const findings = runAnalyzers(
    graph,
    mappingOf(figmaRef("k1"), codeRef("Banner")),
    {},
  );
  expect(byType(findings, "NO_STORY")).toHaveLength(1);
  expect(byType(findings, "PROPS_UNDOCUMENTED")[0]?.evidence).toMatchObject({
    undocumented: ["message"],
  });
  // figma prose on the mapped pair counts as guidance
  expect(byType(findings, "NO_USAGE_GUIDANCE")).toHaveLength(0);
  // FigmaOnly produced no documentation findings at all
  expect(
    findings.filter(
      (f) => f.dimension === "documentation" && f.subjectRef?.kind === "figma",
    ),
  ).toHaveLength(0);
});

// ---- gating ----

test("Badge bug regression: status on the figma side gates code-side findings", () => {
  const graph = graphOf(
    { definitions: [def(figmaRef("k1"), "Badge")] },
    { definitions: [def(codeRef("Badge"), "Badge")] },
  );
  const mappings = mappingOf(figmaRef("k1"), codeRef("Badge"), {
    statuses: [{ ref: figmaRef("k1"), status: "new" }], // set on the FIGMA ref
  });
  const findings = runAnalyzers(graph, mappings, {});
  // documentation findings target the CODE ref — the pair-aware resolver
  // must gate them anyway, matching the unassessed score
  expect(findings.some((f) => f.dimension === "documentation")).toBe(false);
  expect(findings.some((f) => f.dimension === "adoption")).toBe(false);
});

test("status gating: new/experimental exempt from adoption and documentation", () => {
  const graph = graphOf(
    {},
    { definitions: [def(codeRef("Stepper"), "Stepper")] },
  );
  const gated: MappingSetRevision = {
    ...noMappings,
    statuses: [{ ref: codeRef("Stepper"), status: "experimental" }],
  };
  const without = runAnalyzers(graph, noMappings, {});
  const withGate = runAnalyzers(graph, gated, {});
  expect(without.some((f) => f.type === "UNUSED_COMPONENT")).toBe(true);
  expect(without.some((f) => f.type === "NO_STORY")).toBe(true);
  expect(withGate.some((f) => f.dimension === "adoption")).toBe(false);
  expect(withGate.some((f) => f.dimension === "documentation")).toBe(false);
  // parity/complexity untouched by gating
  expect(withGate.some((f) => f.type === "MISSING_IN_FIGMA")).toBe(true);
});
