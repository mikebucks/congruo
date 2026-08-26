import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalyzers } from "@congruo/analyzers";
import type { BlobStore, CanonicalGraph } from "@congruo/core";
import { CodeAdapter } from "@congruo/ingest-code";
import { diffFindings } from "@congruo/scoring";
import { afterAll, beforeAll, expect, test } from "vitest";

/** M5 gate: mutate the gold corpus — fix one seeded issue, introduce one —
 * and the delta is exactly one resolved + one new. A moved line is no delta. */

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/acme-ds", import.meta.url),
);
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
const noMappings = {
  revision: 0,
  mappings: [],
  statuses: [],
  tokenMappings: [],
};

let workdir: string;
beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "congruo-delta-"));
  await cp(fixtureRoot, workdir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules"),
  });
});
afterAll(() => rm(workdir, { recursive: true, force: true }));

async function audit() {
  const code = await new CodeAdapter().extract(
    {
      rootDir: workdir,
      repo: "acme/acme-ds",
      sha: "local",
      dsPackages: [
        { name: "@acme/ui", srcGlob: "packages/ui/src/**/*.{ts,tsx}" },
        {
          name: "@acme/icons",
          srcGlob: "packages/icons/*.svg",
          strategy: "svg-assets" as const,
        },
      ],
      appGlob: "app/src/**/*.tsx",
    },
    { blobs: noBlobs },
  );
  const graph: CanonicalGraph = { figma: emptyExtract, code };
  const findings = runAnalyzers(graph, noMappings, {});
  return {
    fingerprints: findings.map((f) => f.fingerprint),
    artifactIds: code.artifacts.map((a) => a.id),
    findings,
  };
}

test("fix one + add one → exactly one resolved and one new", async () => {
  const before = await audit();

  const buttonPath = join(workdir, "packages/ui/src/Button.tsx");
  const cardPath = join(workdir, "packages/ui/src/Card.tsx");
  const button = await readFile(buttonPath, "utf8");
  await writeFile(
    buttonPath,
    button.replace(
      'borderColor: "#ff5733",',
      'borderColor: "var(--color-border)",',
    ),
  );
  const card = await readFile(cardPath, "utf8");
  await writeFile(
    cardPath,
    card.replace(
      'style={{ padding: padded ? "var(--space-400)" : 0 }}',
      'style={{ padding: padded ? "var(--space-400)" : 0, outlineColor: "#bada55" }}',
    ),
  );

  const after = await audit();
  const delta = diffFindings(before, after);

  expect(delta.comparable).toBe(true);
  const resolved = before.findings.filter((f) =>
    delta.resolvedFingerprints.has(f.fingerprint),
  );
  const fresh = after.findings.filter((f) =>
    delta.newFingerprints.has(f.fingerprint),
  );
  expect(resolved.map((f) => f.type)).toEqual(["HARDCODED_VALUE_CODE"]);
  expect(fresh.map((f) => f.type)).toEqual(["HARDCODED_VALUE_CODE"]);
  expect(fresh[0]?.evidence).toMatchObject({ value: "#bada55" });
});

test("a moved line produces no delta", async () => {
  const before = await audit();
  const cardPath = join(workdir, "packages/ui/src/Card.tsx");
  const card = await readFile(cardPath, "utf8");
  // shift every line down: same content, new locations
  await writeFile(cardPath, `// moved\n// moved\n${card}`);
  const after = await audit();
  const delta = diffFindings(before, after);
  expect(delta.newFingerprints.size).toBe(0);
  expect(delta.resolvedFingerprints.size).toBe(0);
});

test("differing source sets are not comparable", async () => {
  const before = await audit();
  const delta = diffFindings(before, {
    fingerprints: before.fingerprints,
    artifactIds: ["something-else"],
  });
  expect(delta.comparable).toBe(false);
});
