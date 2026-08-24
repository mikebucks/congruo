import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAnalyzers } from "@congruo/analyzers";
import type { BlobStore, CanonicalGraph } from "@congruo/core";
import { CodeAdapter } from "@congruo/ingest-code";
import { expect, test } from "vitest";

/** M3 gate: exact precision/recall per finding type against the labeled gold
 * corpus. A missing finding is a recall bug; an extra one is a precision bug.
 * Misses are itemized in the assertion diff. */

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

const noBlobs: BlobStore = {
  put: async () => {},
  get: async () => new Uint8Array(),
  exists: async () => false,
};

const emptyExtract = {
  artifacts: [],
  definitions: [],
  usages: [],
  tokens: [],
  diagnostics: [],
  rawPayloadRefs: [],
};

test("gold corpus: findings match labels exactly, per type", async () => {
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
  const graph: CanonicalGraph = { figma: emptyExtract, code };
  const findings = runAnalyzers(
    graph,
    { revision: 0, mappings: [], statuses: [], tokenMappings: [] },
    {},
  );

  const actual: Record<string, string[]> = {};
  for (const f of findings) {
    if (f.type === "MISSING_IN_FIGMA") continue; // excluded, see labels file
    const component =
      f.subjectRef?.kind === "code" ? f.subjectRef.exportSymbol : "?";
    actual[f.type] = [...(actual[f.type] ?? []), component].sort();
  }

  const expected: Record<string, string[]> = {};
  for (const [type, items] of Object.entries(labels.expected)) {
    expected[type] = items.map((i) => i.component).sort();
  }

  expect(actual).toEqual(expected);
});

test("determinism: same extract twice → identical fingerprints and scores", async () => {
  const { computeScores } = await import("@congruo/scoring");
  const extractOnce = () =>
    new CodeAdapter().extract(
      {
        rootDir: fixtureRoot,
        repo: "acme/acme-ds",
        sha: "local",
        dsPackage: {
          name: "@acme/ui",
          srcGlob: "packages/ui/src/**/*.{ts,tsx}",
        },
        appGlob: "app/src/**/*.tsx",
      },
      { blobs: noBlobs },
    );
  const mappings = {
    revision: 0,
    mappings: [],
    statuses: [],
    tokenMappings: [],
  };
  const run = async () => {
    const graph: CanonicalGraph = {
      figma: emptyExtract,
      code: await extractOnce(),
    };
    const findings = runAnalyzers(graph, mappings, {});
    return {
      fingerprints: findings.map((f) => f.fingerprint).sort(),
      scores: computeScores(graph, mappings, findings),
    };
  };
  const a = await run();
  const b = await run();
  expect(a.fingerprints).toEqual(b.fingerprints);
  expect(a.scores).toEqual(b.scores);
});
