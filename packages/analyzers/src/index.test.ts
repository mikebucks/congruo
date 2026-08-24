import type {
  CanonicalExtract,
  CanonicalGraph,
  ComponentDefinition,
  ComponentRef,
  ComponentUsage,
  MappingSetRevision,
} from "@congruo/core";
import { proposeMappings } from "@congruo/core";
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

function usage(ref: ComponentRef | null): ComponentUsage {
  return {
    definitionRef: ref,
    artifactId: "consumer",
    location: { kind: "figma", fileKey: "C", fileVersion: "1", nodeId: "1:1" },
    overriddenProps: {},
    kind: "component",
    name: "X",
  };
}

function extract(partial: Partial<CanonicalExtract>): CanonicalExtract {
  return {
    artifacts: [],
    definitions: [],
    usages: [],
    tokens: [],
    diagnostics: [],
    rawPayloadRefs: [],
    ...partial,
  };
}

const emptyMappings: MappingSetRevision = {
  revision: 1,
  mappings: [],
  statuses: [],
  tokenMappings: [],
};

test("matcher proposes exact and DS-prefixed matches, leaves ambiguity unmatched", () => {
  const figma = extract({
    definitions: [
      def(figmaRef("k1"), "Button"),
      def(figmaRef("k2"), "Tag"),
      def(figmaRef("k3"), "Banner"),
    ],
  });
  const code = extract({
    definitions: [
      def(codeRef("DsButton"), "DsButton"),
      def(codeRef("Tag"), "Tag"),
      def(codeRef("ButtonNew"), "ButtonNew"),
    ],
  });
  const result = proposeMappings(figma, code);
  const pairs = result.proposed.map((m) => {
    const c = m.codeRef;
    return c.kind === "code" ? c.exportSymbol : "";
  });
  expect(pairs.sort()).toEqual(["DsButton", "Tag"]);
  expect(result.unmatchedFigma).toEqual(["Banner"]);
  expect(result.unmatchedCode).toEqual(["ButtonNew"]);
  const dsButton = result.proposed.find((_m) => pairs.includes("DsButton"));
  expect(dsButton?.confidence).toBeLessThan(1);
});

test("MISSING_IN_CODE fires for unmapped figma components only", () => {
  const graph: CanonicalGraph = {
    figma: extract({
      definitions: [
        def(figmaRef("k1"), "Button", {
          variants: { Tone: ["a", "b"], Size: ["s", "m", "l"] },
        }),
        def(figmaRef("k2"), "Banner"),
      ],
    }),
    code: extract({ definitions: [def(codeRef("Button"), "Button")] }),
  };
  const mappings: MappingSetRevision = {
    ...emptyMappings,
    mappings: [
      {
        figmaRef: figmaRef("k1"),
        codeRef: codeRef("Button"),
        confidence: 1,
        source: "auto",
        propMappings: [],
      },
    ],
  };
  const findings = runAnalyzers(graph, mappings, {}).filter(
    (f) => f.type === "MISSING_IN_CODE",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.evidence).toMatchObject({ figmaName: "Banner" });
});

test("HARDCODED_VALUE_CODE carries value and location", () => {
  const loc = {
    kind: "code" as const,
    filePath: "src/Button.tsx",
    sha: "local",
    line: 10,
    col: 3,
    endLine: 10,
    endCol: 10,
  };
  const graph: CanonicalGraph = {
    figma: extract({}),
    code: extract({
      definitions: [
        def(codeRef("Button"), "Button", {
          hardcodedValues: [
            { value: "#ff5733", property: "style", location: loc },
          ],
        }),
      ],
    }),
  };
  const findings = runAnalyzers(graph, emptyMappings, {}).filter(
    (f) => f.type === "HARDCODED_VALUE_CODE",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.evidence).toMatchObject({ value: "#ff5733" });
  expect(findings[0]?.locations).toEqual([loc]);
});

test("UNUSED_COMPONENT respects usage on either side of the mapping", () => {
  const mapping: MappingSetRevision = {
    ...emptyMappings,
    mappings: [
      {
        figmaRef: figmaRef("k1"),
        codeRef: codeRef("Button"),
        confidence: 1,
        source: "auto",
        propMappings: [],
      },
    ],
  };
  const graph: CanonicalGraph = {
    figma: extract({
      definitions: [def(figmaRef("k1"), "Button")],
      usages: [], // no Figma instances...
    }),
    code: extract({
      definitions: [
        def(codeRef("Button"), "Button"),
        def(codeRef("Stepper"), "Stepper"),
      ],
      usages: [usage(codeRef("Button"))], // ...but JSX usage exists
    }),
  };
  const findings = runAnalyzers(graph, mapping, {}).filter(
    (f) => f.type === "UNUSED_COMPONENT",
  );
  expect(findings).toHaveLength(1); // Stepper only — Button is used in code
  expect(
    findings[0]?.subjectRef?.kind === "code" &&
      findings[0].subjectRef.exportSymbol,
  ).toBe("Stepper");
});

test("status gating: new/experimental components exempt from adoption findings", () => {
  const graph: CanonicalGraph = {
    figma: extract({}),
    code: extract({
      definitions: [def(codeRef("Stepper"), "Stepper")],
    }),
  };
  const gated: MappingSetRevision = {
    ...emptyMappings,
    statuses: [{ ref: codeRef("Stepper"), status: "experimental" }],
  };
  const without = runAnalyzers(graph, emptyMappings, {});
  const withGate = runAnalyzers(graph, gated, {});
  expect(without.some((f) => f.type === "UNUSED_COMPONENT")).toBe(true);
  expect(withGate.some((f) => f.type === "UNUSED_COMPONENT")).toBe(false);
});
