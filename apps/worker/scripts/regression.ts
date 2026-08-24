// Gold-corpus regression: per-type precision/recall vs expected-findings.json.
// Usage: pnpm --filter @congruo/worker regression   (non-zero exit on any miss)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAnalyzers } from "@congruo/analyzers";
import type { CanonicalGraph } from "@congruo/core";
import { CodeAdapter } from "@congruo/ingest-code";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/acme-ds", import.meta.url),
);
const labels = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/acme-ds/expected-findings.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { expected: Record<string, { component: string }[]> };

const noBlobs = {
  put: async () => {},
  get: async () => new Uint8Array(),
  exists: async () => false,
};

const code = await new CodeAdapter().extract(
  {
    rootDir: fixtureRoot,
    repo: "acme/acme-ds",
    sha: "local",
    dsPackage: { name: "@acme/ui", srcGlob: "packages/ui/src/**/*.{ts,tsx}" },
    appGlob: "app/src/**/*.tsx",
  },
  { blobs: noBlobs },
);
const graph: CanonicalGraph = {
  figma: {
    artifacts: [],
    definitions: [],
    usages: [],
    tokens: [],
    diagnostics: [],
    rawPayloadRefs: [],
  },
  code,
};
const findings = runAnalyzers(
  graph,
  { revision: 0, mappings: [], statuses: [], tokenMappings: [] },
  {},
);

const actualByType = new Map<string, Set<string>>();
for (const f of findings) {
  if (f.type === "MISSING_IN_FIGMA") continue;
  const comp = f.subjectRef?.kind === "code" ? f.subjectRef.exportSymbol : "?";
  const set = actualByType.get(f.type) ?? new Set();
  set.add(`${comp}|${f.fingerprint}`);
  actualByType.set(f.type, set);
}

let failures = 0;
console.log("type                        expected  found  precision  recall");
const types = new Set([
  ...Object.keys(labels.expected),
  ...actualByType.keys(),
]);
for (const type of [...types].sort()) {
  const expected = (labels.expected[type] ?? []).map((e) => e.component);
  const actualComps = [...(actualByType.get(type) ?? [])].map(
    (s) => s.split("|")[0] ?? "",
  );
  const expectedCounts = count(expected);
  const actualCounts = count(actualComps);
  let hits = 0;
  for (const [comp, n] of expectedCounts) {
    hits += Math.min(n, actualCounts.get(comp) ?? 0);
  }
  const precision = actualComps.length === 0 ? 1 : hits / actualComps.length;
  const recall = expected.length === 0 ? 1 : hits / expected.length;
  if (precision < 1 || recall < 1) failures++;
  console.log(
    `${type.padEnd(28)}${String(expected.length).padStart(8)}${String(actualComps.length).padStart(7)}${pct(precision).padStart(11)}${pct(recall).padStart(8)}${precision < 1 || recall < 1 ? "  ← MISS" : ""}`,
  );
}

function count(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

if (failures > 0) {
  console.error(`\n${failures} finding type(s) below 100% — regression.`);
  process.exit(1);
}
console.log("\ngold corpus: 100% precision and recall on every labeled type");
