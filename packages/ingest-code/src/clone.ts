import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BlobStore, CanonicalExtract } from "@congruo/core";
import { CodeAdapter, type CodeConfig } from "./adapter";

const run = promisify(execFile);

export interface CloneConfig
  extends Omit<CodeConfig, "rootDir" | "sha" | "repo"> {
  /** HTTPS github.com URL only (file:// allowed solely in tests). */
  repoUrl: string;
  /** Commit to audit; omitted = default branch HEAD. */
  sha?: string;
  /** Install deps with --ignore-scripts (needed for derived prop types). */
  installDeps?: boolean;
}

export interface CloneOptions {
  allowLocalGit?: boolean;
  scratchDir?: string;
}

const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

/** Ephemeral sandboxed clone: fetch one commit, extract, always delete.
 * Never executes repository code — installs, when enabled, ignore scripts. */
export async function cloneAndExtract(
  config: CloneConfig,
  deps: { blobs: BlobStore },
  opts: CloneOptions = {},
): Promise<{ extract: CanonicalExtract; sha: string }> {
  const isLocal = config.repoUrl.startsWith("file://");
  if (!GITHUB_URL.test(config.repoUrl) && !(isLocal && opts.allowLocalGit)) {
    throw new Error(`repo URL not allowed: ${config.repoUrl}`);
  }

  const dir = await mkdtemp(
    join(opts.scratchDir ?? tmpdir(), "congruo-clone-"),
  );
  try {
    const git = (...args: string[]) => run("git", ["-C", dir, ...args]);
    await run("git", ["init", "-q", dir]);
    await git("remote", "add", "origin", config.repoUrl);
    await git("fetch", "-q", "--depth", "1", "origin", config.sha ?? "HEAD");
    await git("checkout", "-q", "FETCH_HEAD");
    const sha = (await git("rev-parse", "HEAD")).stdout.trim();

    if (config.installDeps) await install(dir);

    const extract = await new CodeAdapter().extract(
      {
        rootDir: dir,
        repo: repoIdentity(config.repoUrl),
        sha,
        dsPackage: config.dsPackage,
        appGlob: config.appGlob,
        tokenPatterns: config.tokenPatterns,
      },
      deps,
    );
    return { extract, sha };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function repoIdentity(url: string): string {
  const m = url.match(/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?$/);
  return m?.[1] ?? url;
}

async function install(dir: string): Promise<void> {
  const args = ["install", "--ignore-scripts"];
  try {
    await run("pnpm", [...args, "--frozen-lockfile"], { cwd: dir });
  } catch {
    await run("npm", [...args, "--no-audit", "--no-fund"], { cwd: dir });
  }
}
