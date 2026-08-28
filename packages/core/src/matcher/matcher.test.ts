import { expect, test } from "vitest";
import type { CanonicalExtract, ComponentDefinition } from "../model";
import type { ComponentRef } from "../refs";
import {
  canonicalValue,
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

test("suffix rules: alert-circle ↔ AlertCircleIcon; bare 'Icon' survives", () => {
  expect(normalizeName("AlertCircleIcon")).toBe("alertcircle");
  expect(normalizeName("alert-circle")).toBe("alertcircle");
  expect(normalizeName("Icon")).toBe("icon"); // remainder must stay non-empty
});

test("naming conventions are workspace config, not code", () => {
  const config = {
    stripPrefixes: ["Acme"],
    stripSuffixes: ["Widget"],
    valueSynonyms: [] as [string, string][],
  };
  expect(normalizeName("AcmeButtonWidget", config)).toBe("button");
  // defaults do not know these conventions
  expect(normalizeName("AcmeButtonWidget")).toBe("acmebuttonwidget");
});

test("icon set auto-matches at the exact tier via suffix normalization", () => {
  const figma = extract({
    definitions: [
      def(figmaRef("k1"), "alert-circle"),
      def(figmaRef("k2"), "alert-diamond"),
    ],
  });
  const code = extract({
    definitions: [
      def(codeRef("AlertCircleIcon"), "AlertCircleIcon"),
      def(codeRef("AlertDiamondIcon"), "AlertDiamondIcon"),
    ],
  });
  const r = proposeMappings(figma, code);
  expect(r.proposed).toHaveLength(2);
  expect(r.proposed.every((m) => m.confidence >= 0.9)).toBe(true);
  expect(r.unmatchedFigma).toEqual([]);
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
    props: [
      {
        name: "Label",
        type: "text",
        values: [],
        required: false,
        documented: false,
      },
    ],
  });
  const codeDef = def(codeRef("Input"), "Input", {
    props: [
      {
        name: "isDisabled",
        type: "boolean",
        values: [],
        required: false,
        documented: false,
      },
      {
        name: "size",
        type: "enum",
        values: ["sm", "md", "lg"],
        required: false,
        documented: false,
      },
      {
        name: "label",
        type: "string",
        values: [],
        required: true,
        documented: false,
      },
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

test("value canonicalization crosses notations without changing quantities", () => {
  expect(canonicalValue("rgba(48, 48, 48, 1)")).toBe("#303030");
  expect(canonicalValue("rgba(0,0,0,0.05)")).toBe("#0000000d");
  expect(canonicalValue("#303030FF")).toBe("#303030");
  expect(canonicalValue("4px")).toBe("4");
  expect(canonicalValue("4")).toBe("4");
  expect(canonicalValue("300ms")).toBe("300ms"); // unknown units untouched
});

test("token mappings match across notations: rgba code value links hex figma value", () => {
  const figma = extract({
    tokens: [
      {
        ref: {
          nativeId: "VariableID:9:9",
          source: "figma-variable",
          resolutionConfidence: "unresolved",
        },
        artifactId: "LIB",
        value: "#303030",
      },
    ],
  });
  const code = extract({
    tokens: [
      {
        ref: {
          nativeId: "--p-color-text",
          resolvedName: "--p-color-text",
          source: "code",
          resolutionConfidence: "exact",
        },
        artifactId: "@x",
        value: "rgba(48, 48, 48, 1)",
      },
    ],
  });
  const mappings = proposeTokenMappings(figma, code);
  expect(mappings).toHaveLength(1);
  expect(mappings[0]?.codeToken.nativeId).toBe("--p-color-text");
});

test("token mappings by exact unique value: nameless variable links to code token", () => {
  const figma = extract({
    tokens: [
      {
        ref: {
          nativeId: "VariableID:24:1",
          source: "figma-variable",
          resolutionConfidence: "unresolved",
        },
        artifactId: "LIB",
        value: "#005BD3",
      },
      // duplicated value on this side → ambiguous, must NOT propose
      {
        ref: {
          nativeId: "VariableID:24:2",
          source: "figma-variable",
          resolutionConfidence: "unresolved",
        },
        artifactId: "LIB",
        value: "#ffffff",
      },
      {
        ref: {
          nativeId: "VariableID:24:3",
          source: "figma-variable",
          resolutionConfidence: "unresolved",
        },
        artifactId: "LIB",
        value: "#ffffff",
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
        value: "#005bd3",
      },
      {
        ref: {
          nativeId: "--color-white",
          resolvedName: "--color-white",
          source: "code",
          resolutionConfidence: "exact",
        },
        artifactId: "@acme/ui",
        value: "#ffffff",
      },
    ],
  });
  const mappings = proposeTokenMappings(figma, code);
  expect(mappings).toHaveLength(1); // value match is case-insensitive
  expect(mappings[0]?.figmaToken.nativeId).toBe("VariableID:24:1");
  expect(mappings[0]?.codeToken.nativeId).toBe("--color-primary");
  expect(mappings[0]?.confidence).toBe(0.85);
});
