import { expect, test } from "vitest";
import { resolveTokenValue } from "./token-values";

const values = new Map([
  ["--color-primary", "#005bd3"],
  ["motion-duration-300", "300ms"],
  ["space-100", "4px"],
  ["zIndex.z-index-11", "519"],
]);
const sources = [
  { glob: "*", format: "token-ts" as const, stripPrefixes: ["--p-", "--pc-"] },
];

test("token value lookup: exact, prefix-stripped, dotted-path fallbacks", () => {
  expect(resolveTokenValue("--color-primary", values, sources)).toBe("#005bd3");
  expect(resolveTokenValue("--p-motion-duration-300", values, sources)).toBe(
    "300ms",
  );
  expect(resolveTokenValue("--p-space-100", values, sources)).toBe("4px");
  expect(resolveTokenValue("theme.zIndex.z-index-11", values, sources)).toBe(
    "519",
  );
  expect(resolveTokenValue("--p-unknown", values, sources)).toBeUndefined();
});
