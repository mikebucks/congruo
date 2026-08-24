import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { BlobStore } from "@congruo/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CodeAdapter, type CodeConfig } from "./adapter";
import { cloneAndExtract } from "./clone";

const run = promisify(execFile);

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/acme-ds", import.meta.url),
);

const config: CodeConfig = {
  rootDir: fixtureRoot,
  repo: "acme/acme-ds",
  sha: "local",
  dsPackage: { name: "@acme/ui", srcGlob: "packages/ui/src/**/*.{ts,tsx}" },
  appGlob: "app/src/**/*.tsx",
  tokenPatterns: { tailwindPrefixes: ["bg-", "p-"] },
};

const noBlobs: BlobStore = {
  put: async () => {},
  get: async () => new Uint8Array(),
  exists: async () => false,
};

async function extract() {
  return new CodeAdapter().extract(config, { blobs: noBlobs });
}

test("extracts all eight DS components (stories excluded)", async () => {
  const out = await extract();
  expect(out.definitions.map((d) => d.name).sort()).toEqual([
    "Badge",
    "Banner",
    "Button",
    "ButtonNew",
    "Card",
    "Input",
    "Stepper",
    "Tag",
  ]);
  const button = out.definitions.find((d) => d.name === "Button");
  const variant = button?.props.find((p) => p.name === "variant");
  expect(variant?.required).toBe(true);
  expect(variant?.values).toEqual(["primary", "secondary", "tertiary"]);
});

test("token patterns: css vars, theme lookups, tailwind prefixes", async () => {
  const out = await extract();
  const button = out.definitions.find((d) => d.name === "Button");
  expect(button?.tokensUsed.map((t) => t.token.nativeId).sort()).toEqual([
    "--color-primary",
    "--space-200",
  ]);

  const input = out.definitions.find((d) => d.name === "Input");
  expect(input?.tokensUsed.map((t) => t.token.nativeId)).toContain(
    "theme.colors.border",
  );

  const badge = out.definitions.find((d) => d.name === "Badge");
  expect(badge?.tokensUsed.map((t) => t.token.nativeId).sort()).toEqual([
    "bg-primary-500",
    "p-100",
  ]);

  expect(button?.hardcodedValues.map((h) => h.value)).toEqual(["#ff5733"]);
});

test("story and docs signals", async () => {
  const out = await extract();
  const badge = out.definitions.find((d) => d.name === "Badge");
  const banner = out.definitions.find((d) => d.name === "Banner");
  expect(badge?.docs.storyExists).toBe(true);
  expect(badge?.docs.propsDocumented).toBe(true);
  expect(banner?.docs.storyExists).toBe(false);
  expect(banner?.docs.propsDocumented).toBe(false);
});

test("usage census: DS, local components, and raw styled elements", async () => {
  const out = await extract();
  const ds = out.usages.filter((u) => u.definitionRef !== null);
  const local = out.usages.filter(
    (u) => u.definitionRef === null && u.kind === "component",
  );
  const raw = out.usages.filter((u) => u.kind === "styled-element");

  // Home: 2 Card + 2 Button; Settings: Banner, Input, Tag, Badge, Button
  expect(ds).toHaveLength(9);
  expect(local.map((u) => u.name)).toEqual(["LocalBadge"]);
  expect(raw).toHaveLength(2); // span in LocalBadge.tsx + span in Settings.tsx

  const files = new Set(
    ds.map((u) => (u.location.kind === "code" ? u.location.filePath : "")),
  );
  expect(files.size).toBe(2);
});

// ---- clone-at-SHA wrapper ----

let localRepo: string;
beforeAll(async () => {
  localRepo = await mkdtemp(join(tmpdir(), "congruo-test-repo-"));
  await cp(fixtureRoot, localRepo, {
    recursive: true,
    filter: (src) => !src.includes("node_modules"),
  });
  const git = (...args: string[]) => run("git", ["-C", localRepo, ...args]);
  await git("init", "-q");
  await git("add", "-A");
  await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
}, 30000);
afterAll(() => rm(localRepo, { recursive: true, force: true }));

test("cloneAndExtract clones, extracts, resolves sha, and cleans up", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "congruo-scratch-"));
  const { extract: out, sha } = await cloneAndExtract(
    {
      repoUrl: `file://${localRepo}`,
      dsPackage: config.dsPackage,
      appGlob: config.appGlob,
    },
    { blobs: noBlobs },
    { allowLocalGit: true, scratchDir: scratch },
  );
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  expect(out.definitions).toHaveLength(8);
  expect(out.artifacts[0]?.version).toBe(sha);
  // the ephemeral checkout is gone
  const { readdir } = await import("node:fs/promises");
  expect(await readdir(scratch)).toEqual([]);
  await rm(scratch, { recursive: true, force: true });
}, 30000);

test("cloneAndExtract rejects non-github URLs", async () => {
  await expect(
    cloneAndExtract(
      {
        repoUrl: "https://evil.example.com/x/y",
        dsPackage: config.dsPackage,
        appGlob: config.appGlob,
      },
      { blobs: noBlobs },
    ),
  ).rejects.toThrow("not allowed");
  await expect(
    cloneAndExtract(
      {
        repoUrl: `file://${localRepo}`,
        dsPackage: config.dsPackage,
        appGlob: config.appGlob,
      },
      { blobs: noBlobs },
      // no allowLocalGit
    ),
  ).rejects.toThrow("not allowed");
});

test("stat sanity: fixture has no stray node_modules inside ui src", async () => {
  await expect(
    stat(join(fixtureRoot, "packages/ui/src/node_modules")),
  ).rejects.toThrow();
});
