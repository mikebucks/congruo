// Live smoke: clone + extract a real repo. Usage: pnpm smoke
// Second-codebase-shape check (WP2.2): shadcn-ui — Tailwind + cva + derived props.
import { cloneAndExtract } from "../src/clone";

const blobs = {
  async put() {},
  async get() {
    return new Uint8Array();
  },
  async exists() {
    return false;
  },
};

const { extract, sha } = await cloneAndExtract(
  {
    repoUrl: "https://github.com/shadcn-ui/ui",
    dsPackage: {
      name: "@/registry/new-york-v4/ui",
      srcGlob: "apps/v4/registry/new-york-v4/ui/*.tsx",
    },
    appGlob: "apps/v4/app/**/*.tsx",
    tokenPatterns: { tailwindPrefixes: ["bg-", "text-", "p-", "px-", "py-", "gap-"] },
  },
  { blobs },
);

console.log(`sha: ${sha.slice(0, 12)}`);
console.log(`definitions: ${extract.definitions.length}`);
console.log(`usages: ${extract.usages.length} (ds: ${extract.usages.filter((u) => u.definitionRef).length}, styled: ${extract.usages.filter((u) => u.kind === "styled-element").length})`);
console.log(`tokens: ${extract.tokens.length}, diagnostics: ${extract.diagnostics.length}`);
const kinds = new Map<string, number>();
for (const d of extract.diagnostics) {
  const label = d.detail.split(":")[0] ?? d.kind;
  kinds.set(label, (kinds.get(label) ?? 0) + 1);
}
console.log("diagnostic kinds:", Object.fromEntries(kinds));
const sample = extract.definitions.slice(0, 5).map((d) => `${d.name}(${d.props.length}p)`);
console.log("sample:", sample.join(", "));
