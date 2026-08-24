import type {
  CanonicalGraph,
  ComponentRef,
  Finding,
  MappingSetRevision,
} from "@congruo/core";
import { createFinding, refKey } from "@congruo/core";
import { expect, test } from "vitest";
import { computeScores } from "./score";

const codeRef = (symbol: string): ComponentRef => ({
  kind: "code",
  repo: "r",
  pkg: "p",
  exportSymbol: symbol,
  filePath: "",
});
const figmaRef = (key: string): ComponentRef => ({
  kind: "figma",
  fileKey: "LIB",
  componentKey: key,
});

const emptyMappings: MappingSetRevision = {
  revision: 1,
  mappings: [],
  statuses: [],
  tokenMappings: [],
};

function graphWith(defs: {
  code?: { ref: ComponentRef; name: string }[];
  figma?: { ref: ComponentRef; name: string }[];
  codeUsages?: ComponentRef[];
}): CanonicalGraph {
  const mkDef = (
    d: { ref: ComponentRef; name: string },
    artifactId: string,
  ) => ({
    ref: d.ref,
    artifactId,
    name: d.name,
    props: [],
    variants: {},
    tokensUsed: [],
    hardcodedValues: [],
    docs: {
      storyExists: true,
      propsDocumented: true,
      usageProse: "documented",
    },
  });
  return {
    figma: {
      artifacts: [],
      definitions: (defs.figma ?? []).map((d) => mkDef(d, "LIB")),
      usages: [],
      tokens: [],
      diagnostics: [],
      rawPayloadRefs: [],
    },
    code: {
      artifacts: [],
      definitions: (defs.code ?? []).map((d) => mkDef(d, "pkg")),
      usages: (defs.codeUsages ?? []).map((ref) => ({
        definitionRef: ref,
        artifactId: "app",
        location: {
          kind: "code" as const,
          filePath: "app/x.tsx",
          sha: "s",
          line: 1,
          col: 1,
          endLine: 1,
          endCol: 1,
        },
        overriddenProps: {},
        kind: "component" as const,
        name: "X",
      })),
      tokens: [],
      diagnostics: [],
      rawPayloadRefs: [],
    },
  };
}

test("no findings + fully evaluated → 100 per dimension", () => {
  const graph = graphWith({
    code: [{ ref: codeRef("Button"), name: "Button" }],
    codeUsages: [codeRef("Button")],
  });
  const { components, system, topline } = computeScores(
    graph,
    emptyMappings,
    [],
  );
  expect(components[0]?.scores).toEqual({
    parity: 100,
    complexity: 100,
    adoption: 100,
    documentation: 100,
  });
  expect(system.parity).toBe(100);
  expect(topline).toBe(100);
});

test("exempt statuses and figma-only docs are null, not 100", () => {
  const graph = graphWith({
    code: [{ ref: codeRef("New"), name: "New" }],
    figma: [{ ref: figmaRef("k1"), name: "FigmaOnly" }],
  });
  const mappings: MappingSetRevision = {
    ...emptyMappings,
    statuses: [{ ref: codeRef("New"), status: "experimental" }],
  };
  const { components } = computeScores(graph, mappings, []);
  const newComp = components.find((c) => c.name === "New");
  expect(newComp?.scores.adoption).toBeNull();
  expect(newComp?.scores.documentation).toBeNull();
  expect(newComp?.scores.parity).toBe(100);
  const figmaOnly = components.find((c) => c.name === "FigmaOnly");
  expect(figmaOnly?.scores.documentation).toBeNull();
});

test("penalties scale with reach and floor at zero", () => {
  const busy = codeRef("Busy");
  const quiet = codeRef("Quiet");
  const graph = graphWith({
    code: [
      { ref: busy, name: "Busy" },
      { ref: quiet, name: "Quiet" },
    ],
    codeUsages: [...Array.from({ length: 200 }, () => busy), quiet],
  });
  const mismatch = (ref: ComponentRef): Finding =>
    createFinding({
      type: "HARDCODED_VALUE_CODE",
      subjectRef: ref,
      evidence: {
        value: "#fff",
        property: "style",
        occurrences: 1,
        matchingToken: null,
      },
      locations: [],
    });
  const { components } = computeScores(graph, emptyMappings, [
    mismatch(busy),
    mismatch(quiet),
  ]);
  const busyScore = components.find((c) => c.name === "Busy")?.scores.parity;
  const quietScore = components.find((c) => c.name === "Quiet")?.scores.parity;
  expect(busyScore).toBeLessThan(quietScore ?? 0); // reach multiplies penalty

  const floors = Array.from({ length: 30 }, (_, i) =>
    createFinding({
      type: "HARDCODED_VALUE_CODE",
      subjectRef: busy,
      evidence: {
        value: `#0000${i.toString().padStart(2, "0")}`,
        property: "style",
        occurrences: 1,
        matchingToken: null,
      },
      locations: [],
    }),
  );
  const floored = computeScores(graph, emptyMappings, floors);
  expect(floored.components.find((c) => c.name === "Busy")?.scores.parity).toBe(
    0,
  );
});

test("findings on either side of a mapped pair roll up onto one component", () => {
  const fRef = figmaRef("k1");
  const cRef = codeRef("Button");
  const graph = graphWith({
    figma: [{ ref: fRef, name: "Button" }],
    code: [{ ref: cRef, name: "Button" }],
  });
  const mappings: MappingSetRevision = {
    ...emptyMappings,
    mappings: [
      {
        figmaRef: fRef,
        codeRef: cRef,
        confidence: 1,
        source: "auto",
        propMappings: [],
      },
    ],
  };
  const figmaSideFinding = createFinding({
    type: "HARDCODED_VALUE_FIGMA",
    subjectRef: fRef,
    evidence: {
      value: "#123456",
      property: "fill",
      occurrences: 1,
      matchingToken: null,
    },
    locations: [],
  });
  const { components } = computeScores(graph, mappings, [figmaSideFinding]);
  expect(components).toHaveLength(1);
  expect(components[0]?.subjectRefKey).toBe(refKey(cRef));
  expect(components[0]?.scores.parity).toBeLessThan(100);
});
