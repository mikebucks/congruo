import { fileURLToPath } from "node:url";
import type { BlobStore } from "@congruo/core";
import { expect, test } from "vitest";
import { CodeAdapter, type CodeConfig } from "./adapter";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/acme-ds", import.meta.url),
);

const config: CodeConfig = {
  rootDir: fixtureRoot,
  repo: "acme/acme-ds",
  sha: "local",
  dsPackage: { name: "@acme/ui", srcGlob: "packages/ui/src/**/*.{ts,tsx}" },
  appGlob: "app/src/**/*.tsx",
};

const noBlobs: BlobStore = {
  put: async () => {},
  get: async () => new Uint8Array(),
  exists: async () => false,
};

async function extract() {
  return new CodeAdapter().extract(config, { blobs: noBlobs });
}

test("extracts the three DS components with typed props", async () => {
  const out = await extract();
  expect(out.definitions.map((d) => d.name).sort()).toEqual([
    "Button",
    "Card",
    "Stepper",
  ]);

  const button = out.definitions.find((d) => d.name === "Button");
  expect(button?.ref).toEqual({
    kind: "code",
    repo: "acme/acme-ds",
    pkg: "@acme/ui",
    exportSymbol: "Button",
    filePath: "packages/ui/src/Button.tsx",
  });
  const variant = button?.props.find((p) => p.name === "variant");
  expect(variant?.required).toBe(true);
  expect(variant?.values).toEqual(["primary", "secondary", "tertiary"]);
  const disabled = button?.props.find((p) => p.name === "disabled");
  expect(disabled?.required).toBe(false);
});

test("detects CSS custom property tokens and hardcoded hex values", async () => {
  const out = await extract();
  const button = out.definitions.find((d) => d.name === "Button");
  expect(button?.tokensUsed.map((t) => t.token.nativeId).sort()).toEqual([
    "--color-primary",
    "--space-200",
  ]);
  expect(button?.hardcodedValues).toHaveLength(1);
  expect(button?.hardcodedValues[0]?.value).toBe("#ff5733");
  expect(button?.hardcodedValues[0]?.location).toMatchObject({
    kind: "code",
    filePath: "packages/ui/src/Button.tsx",
  });

  const tokenIds = out.tokens.map((t) => t.ref.nativeId).sort();
  expect(tokenIds).toEqual([
    "--color-primary",
    "--color-text",
    "--space-200",
    "--space-400",
  ]);
});

test("resolves app JSX usages to DS imports; local components stay unresolved", async () => {
  const out = await extract();
  const ds = out.usages.filter((u) => u.definitionRef !== null);
  const local = out.usages.filter((u) => u.definitionRef === null);

  expect(ds).toHaveLength(3); // Card + 2 Buttons
  const symbols = ds.map(
    (u) => u.definitionRef?.kind === "code" && u.definitionRef.exportSymbol,
  );
  expect(symbols.filter((s) => s === "Button")).toHaveLength(2);
  expect(symbols.filter((s) => s === "Card")).toHaveLength(1);

  const firstButton = ds.find(
    (u) =>
      u.definitionRef?.kind === "code" &&
      u.definitionRef.exportSymbol === "Button",
  );
  expect(firstButton?.overriddenProps).toMatchObject({
    variant: "primary",
    label: "Get started",
  });

  expect(local).toHaveLength(1); // LocalBadge
});

test("docs signals: described props are detected", async () => {
  const out = await extract();
  const button = out.definitions.find((d) => d.name === "Button");
  const card = out.definitions.find((d) => d.name === "Card");
  // Button's variant/disabled have JSDoc but label does not
  expect(button?.docs.propsDocumented).toBe(false);
  expect(card?.docs.propsDocumented).toBe(false);
});
