import type { CanonicalGraph, ComponentUsage } from "@congruo/core";
import { expect, test } from "vitest";
import { computeCoverage } from "./coverage";

const figmaLoc = {
  kind: "figma" as const,
  fileKey: "C",
  fileVersion: "1",
  nodeId: "1:1",
};

function usage(
  partial: Partial<ComponentUsage> & Pick<ComponentUsage, "definitionRef">,
): ComponentUsage {
  return {
    artifactId: "a",
    location: figmaLoc,
    overriddenProps: {},
    kind: "component",
    name: "X",
    ...partial,
  };
}

test("coverage: ds shares, raw census, token health, empty-denominator nulls", () => {
  const buttonRef = {
    kind: "figma" as const,
    fileKey: "LIB",
    componentKey: "k1",
  };
  const graph: CanonicalGraph = {
    figma: {
      artifacts: [],
      definitions: [
        {
          ref: buttonRef,
          artifactId: "LIB",
          name: "Button",
          props: [],
          variants: {},
          tokensUsed: [
            {
              token: {
                nativeId: "v1",
                source: "figma-variable",
                resolutionConfidence: "exact",
              },
              property: "fill",
            },
          ],
          hardcodedValues: [],
          docs: {
            storyExists: false,
            propsDocumented: false,
            usageProse: null,
          },
        },
      ],
      usages: [
        usage({ definitionRef: buttonRef }),
        usage({ definitionRef: buttonRef }),
        usage({ definitionRef: null }), // detached / non-library
      ],
      tokens: [],
      diagnostics: [],
      rawPayloadRefs: [],
    },
    code: {
      artifacts: [],
      definitions: [],
      usages: [
        usage({
          definitionRef: {
            kind: "code",
            repo: "r",
            pkg: "p",
            exportSymbol: "Button",
            filePath: "",
          },
        }),
        usage({ definitionRef: null }), // local component
        usage({ definitionRef: null, kind: "styled-element", name: "span" }),
      ],
      tokens: [],
      diagnostics: [{ artifactId: "a", kind: "parse-error", detail: "x" }],
      rawPayloadRefs: [],
    },
  };

  const c = computeCoverage(graph);
  expect(c.figma.coveragePct).toBe(67); // 2 of 3
  expect(c.code.coveragePct).toBe(50); // 1 DS of 2 component usages
  expect(c.code.rawStyledElements).toBe(1);
  expect(c.tokens.healthPct).toBe(100); // 1 bound, 0 hardcoded
  expect(c.files.skippedOrFailed).toBe(1);

  const empty: CanonicalGraph = {
    figma: { ...graph.figma, definitions: [], usages: [] },
    code: { ...graph.code, usages: [], diagnostics: [] },
  };
  const e = computeCoverage(empty);
  expect(e.figma.coveragePct).toBeNull(); // no denominator ≠ 0% ≠ 100%
  expect(e.code.coveragePct).toBeNull();
});
