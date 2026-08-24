import { readFileSync } from "node:fs";
import type { BlobStore } from "@congruo/core";
import { expect, test } from "vitest";
import { FigmaAdapter } from "./adapter";
import { FigmaApiError, FigmaClient } from "./client";
import { variableTokenRef } from "./tokens";

const fixtureRaw = readFileSync(
  new URL("../../../fixtures/figma/polaris-ui-kit.json", import.meta.url),
  "utf8",
);

function fixtureFetch(): typeof fetch {
  return async (url) => {
    if (String(url).includes("/v1/files/")) {
      return new Response(fixtureRaw, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

class MemBlobs implements BlobStore {
  store = new Map<string, string>();
  async put(key: string, data: Uint8Array | string) {
    this.store.set(key, typeof data === "string" ? data : "binary");
  }
  async get(key: string) {
    return new TextEncoder().encode(this.store.get(key));
  }
  async exists(key: string) {
    return this.store.has(key);
  }
}

// ---- WP1.1 client ----

test("client retries on 429 using Retry-After, then succeeds", async () => {
  let calls = 0;
  const flaky: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      : new Response(JSON.stringify({ name: "x", version: "1" }), {
          status: 200,
        });
  };
  const client = new FigmaClient("pat", flaky);
  const { file } = await client.getFile("k");
  expect(calls).toBe(2);
  expect(file.version).toBe("1");
});

test("client throws typed error on non-retryable failure", async () => {
  const denied: typeof fetch = async () =>
    new Response("forbidden", { status: 403 });
  const client = new FigmaClient("pat", denied);
  await expect(client.getFile("k")).rejects.toThrow(FigmaApiError);
});

// ---- WP1.2 adapter, hand-counted values from the Polaris fixture ----

async function extractFixture(consumerKeys: string[] = []) {
  const blobs = new MemBlobs();
  const adapter = new FigmaAdapter(fixtureFetch());
  const extract = await adapter.extract(
    { pat: "pat", libraryFileKey: "LIB", consumerFileKeys: consumerKeys },
    { blobs },
  );
  return { extract, blobs };
}

test("library extraction matches hand-counted fixture values", async () => {
  const { extract, blobs } = await extractFixture();

  // 34 component sets + 510 standalone components = 544, minus set nodes
  // absent from the document tree (surfaced as diagnostics, not silently).
  const missingNodes = extract.diagnostics.filter((d) =>
    d.detail.includes("not in the document tree"),
  ).length;
  expect(extract.definitions.length + missingNodes).toBe(544);

  const button = extract.definitions.find((d) => d.name === "Button");
  expect(button).toBeDefined();
  expect(button?.ref).toEqual({
    kind: "figma",
    fileKey: "LIB",
    componentKey: "74fd9d0fa02c563b6f2e9129f5cf582ff1511229",
  });
  expect(button?.variants).toMatchObject({
    Variant: ["primary", "auto", "tertiary"],
    Tone: ["neutral", "critical"],
  });
  expect(button?.props.map((p) => p.name).sort()).toEqual([
    "Icon",
    "Icon instance",
    "Label",
  ]);
  expect(button?.tokensUsed.length).toBeGreaterThan(0);

  expect(extract.tokens.length).toBeGreaterThan(0);
  expect(extract.artifacts).toHaveLength(1);
  expect(extract.rawPayloadRefs).toHaveLength(1);
  expect(await blobs.exists(extract.rawPayloadRefs[0] ?? "")).toBe(true);
});

test("consumer extraction resolves all top-level instances to definition refs", async () => {
  const { extract } = await extractFixture(["CONSUMER"]);
  const usages = extract.usages.filter((u) => u.artifactId === "CONSUMER");
  // 341 INSTANCE nodes total, 277 top-level — instances nested inside other
  // instances are the parent component's internals, not adoption events.
  expect(usages).toHaveLength(277);
  expect(usages.every((u) => u.definitionRef !== null)).toBe(true);

  const buttonUsage = usages.find(
    (u) =>
      u.definitionRef?.kind === "figma" &&
      u.definitionRef.componentKey ===
        "74fd9d0fa02c563b6f2e9129f5cf582ff1511229",
  );
  expect(buttonUsage).toBeDefined();
  expect(buttonUsage?.overriddenProps).toHaveProperty("Variant");
});

// ---- token identity (spike Q2) ----

test("remote variable IDs parse to stable keys; local ones stay unresolved", () => {
  const remote = variableTokenRef(
    "VariableID:2254eb44b943f2cd24bcb8b3f3304a9b847c906d/21929:794",
  );
  expect(remote.stableKey).toBe("2254eb44b943f2cd24bcb8b3f3304a9b847c906d");
  expect(remote.resolutionConfidence).toBe("exact");

  const local = variableTokenRef("VariableID:24:6778");
  expect(local.stableKey).toBeUndefined();
  expect(local.resolutionConfidence).toBe("unresolved");
});
