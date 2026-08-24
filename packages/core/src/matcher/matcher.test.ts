import { expect, test } from "vitest";
import type { CanonicalExtract, ComponentDefinition } from "../model";
import type { ComponentRef } from "../refs";
import {
  matchProps,
  normalizeName,
  proposeMappings,
  proposeTokenMappings,
  similarity,
} from "./index";

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
  filePath: "",
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

const extract = (partial: Partial<CanonicalExtract>): CanonicalExtract => ({
  artifacts: [],
  definitions: [],
  usages: [],
  tokens: [],
  diagnostics: [],
  rawPayloadRefs: [],
  ...partial,
});

test("normalization strips DS prefixes and punctuation", () => {
  expect(normalizeName("DsButton")).toBe("button");
  expect(normalizeName("Button / Primary")).toBe("buttonprimary");
});

test("table-driven pairing: exact, prefixed, fuzzy tiers, ambiguity", () => {
  const figma = extract({
    definitions: [
      def(figmaRef("k1"), "Button"),
      def(figmaRef("k2"), "Text Field"),
      def(figmaRef("k3"), "Chip"),
    ],
  });
  const code = extract({
    definitions: [
      def(codeRef("DsButton"), "DsButton"),
      def(codeRef("TextField"), "TextField"),
      def(codeRef("ButtonNew"), "ButtonNew"),
    ],
  });
  const r = proposeMappings(figma, code);
  const autoPairs = r.proposed.map((m) =>
    m.codeRef.kind === "code" ? m.codeRef.exportSymbol : "",
  );
  expect(autoPairs.sort()).toEqual(["DsButton", "TextField"]);
  // ButtonNew ≠ Button: dice("buttonnew","button") ≈ 0.77 → suggested only
  expect(r.proposed.some((_m) => autoPairs.includes("ButtonNew"))).toBe(false);
  expect(r.unmatchedCode).toContain("ButtonNew");
  expect(r.unmatchedFigma).toContain("Chip");
});

test("a code component pairs at most once: icon 'button' cannot claim code Button", () => {
  // real Polaris case: an icon named "button" and the set "Button" both
  // normalize to "button" — only the case-exact name wins the pairing
  const figma = extract({
    definitions: [
      def(figmaRef("icon"), "button"),
      def(figmaRef("set"), "Button"),
    ],
  });
  const code = extract({ definitions: [def(codeRef("Button"), "Button")] });
  const r = proposeMappings(figma, code);
  expect(r.proposed).toHaveLength(1);
  expect(
    r.proposed[0]?.figmaRef.kind === "figma" &&
      r.proposed[0].figmaRef.componentKey,
  ).toBe("set");
  expect(r.proposed[0]?.confidence).toBe(1);
});

test("multiple code candidates for one name stay unmatched, never auto-paired", () => {
  const figma = extract({ definitions: [def(figmaRef("k"), "Button")] });
  const code = extract({
    definitions: [
      def(codeRef("Button"), "Button"),
      def(
        {
          kind: "code",
          repo: "acme/ui",
          pkg: "@acme/other",
          exportSymbol: "Button",
          filePath: "",
        },
        "Button",
      ),
    ],
  });
  const r = proposeMappings(figma, code);
  expect(r.proposed).toHaveLength(0);
  expect(r.unmatchedFigma).toContain("Button");
});

test("similarity: ButtonNew vs Button lands in the suggest band", () => {
  const s = similarity("buttonnew", "button");
  expect(s).toBeGreaterThan(0.6);
  expect(s).toBeLessThan(0.85);
});

test('prop matching: isDisabled↔Disabled, Size=lg↔size="lg" with value synonyms', () => {
  const figmaDef = def(figmaRef("k"), "Input", {
    variants: {
      Disabled: ["false", "true"],
      Size: ["Small", "Medium", "Large"],
    },
    props: [{ name: "Label", type: "text", values: [], required: false }],
  });
  const codeDef = def(codeRef("Input"), "Input", {
    props: [
      { name: "isDisabled", type: "boolean", values: [], required: false },
      {
        name: "size",
        type: "enum",
        values: ["sm", "md", "lg"],
        required: false,
      },
      { name: "label", type: "string", values: [], required: true },
    ],
  });
  const props = matchProps(figmaDef, codeDef);
  const byFigma = new Map(props.map((p) => [p.figmaProp, p]));
  expect(byFigma.get("Disabled")?.codeProp).toBe("isDisabled");
  expect(byFigma.get("Size")?.codeProp).toBe("size");
  expect(byFigma.get("Size")?.valueMap).toEqual({
    Small: "sm",
    Medium: "md",
    Large: "lg",
  });
  expect(byFigma.get("Label")?.codeProp).toBe("label");
});

test("token mappings: exact normalized names only, unnamed tokens never guessed", () => {
  const figma = extract({
    tokens: [
      {
        ref: {
          nativeId: "S:1",
          resolvedName: "Color/Primary",
          source: "figma-style",
          resolutionConfidence: "exact",
        },
        artifactId: "LIB",
      },
      {
        ref: {
          nativeId: "VariableID:24:1",
          source: "figma-variable",
          resolutionConfidence: "unresolved",
        },
        artifactId: "LIB",
      },
    ],
  });
  const code = extract({
    tokens: [
      {
        ref: {
          nativeId: "--color-primary",
          resolvedName: "--color-primary",
          source: "code",
          resolutionConfidence: "exact",
        },
        artifactId: "@acme/ui",
      },
    ],
  });
  const mappings = proposeTokenMappings(figma, code);
  expect(mappings).toHaveLength(1);
  expect(mappings[0]?.figmaToken.resolvedName).toBe("Color/Primary");
  expect(mappings[0]?.codeToken.nativeId).toBe("--color-primary");
});
