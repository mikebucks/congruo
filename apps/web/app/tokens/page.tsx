import type { CanonicalGraph, TokenRef } from "@congruo/core";
import { refKey, tokenKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import { Nav } from "../../components/nav";
import { db } from "../../lib/server";
import { tokenDisplay, tokenKind } from "../../lib/token-view";
import { type TokenRow, TokensTable } from "./tokens-table";

export const dynamic = "force-dynamic";

const sourceLabel: Record<TokenRef["source"], string> = {
  "figma-variable": "figma variable",
  "figma-style": "figma style",
  "tokens-studio": "tokens studio",
  code: "code",
};

/** Manifest types are authoritative for non-numeric kinds; FLOAT stays with
 * property inference (spacing vs radius vs typography). */
function kindOf(type: string | undefined, properties: Set<string>): string {
  if (type === "COLOR") return "color";
  if (type === "STRING") return "string";
  if (type === "BOOLEAN") return "boolean";
  return tokenKind(properties);
}

export default async function Tokens() {
  const workspace = await db().query.workspaces.findFirst();
  if (!workspace) {
    return (
      <>
        <Nav active="tokens" />
        <main className="p-8">No workspace.</main>
      </>
    );
  }
  const latest = await db().query.snapshots.findFirst({
    where: eq(schema.snapshots.workspaceId, workspace.id),
    orderBy: desc(schema.snapshots.createdAt),
  });
  if (!latest) {
    return (
      <>
        <Nav active="tokens" />
        <main className="p-8">Run an audit first.</main>
      </>
    );
  }
  const graphRow = await db().query.snapshotGraphs.findFirst({
    where: eq(schema.snapshotGraphs.snapshotId, latest.id),
  });
  const graph = graphRow?.graph as CanonicalGraph;

  const mappedTokens = new Set([
    ...latest.mappingSet.tokenMappings.map((m) => tokenKey(m.figmaToken)),
    ...latest.mappingSet.tokenMappings.map((m) => tokenKey(m.codeToken)),
  ]);

  const valueByKey = new Map<string, string>();
  const typeByKey = new Map<string, string>();
  for (const side of ["figma", "code"] as const) {
    for (const t of graph[side].tokens) {
      const key = tokenKey(t.ref);
      if (t.value) valueByKey.set(key, t.value);
      if (t.type) typeByKey.set(key, t.type);
    }
  }

  const collected = new Map<
    string,
    {
      ref: TokenRef;
      properties: Set<string>;
      sources: Set<TokenRef["source"]>;
      components: Set<string>;
    }
  >();
  for (const side of ["figma", "code"] as const) {
    for (const def of graph[side].definitions) {
      for (const t of def.tokensUsed) {
        const key = tokenKey(t.token);
        const entry = collected.get(key) ?? {
          ref: t.token,
          properties: new Set<string>(),
          sources: new Set<TokenRef["source"]>(),
          components: new Set<string>(),
        };
        entry.properties.add(t.property);
        entry.sources.add(t.token.source);
        entry.components.add(refKey(def.ref));
        collected.set(key, entry);
      }
    }
  }

  const rows: TokenRow[] = [...collected.entries()].map(([key, e]) => {
    const value = valueByKey.get(key);
    const d = tokenDisplay(e.ref, value);
    return {
      key,
      name: e.ref.resolvedName ?? d.label,
      swatch: d.swatch,
      detail: e.ref.resolvedName ? undefined : d.detail,
      value,
      type: kindOf(typeByKey.get(key), e.properties),
      sources: [...e.sources].map((s) => sourceLabel[s]),
      references: e.components.size,
      linked: mappedTokens.has(key),
    };
  });

  return (
    <>
      <Nav active="tokens" />
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-2xl font-semibold">Tokens</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {rows.length} tokens in use across components ·{" "}
          {rows.filter((r) => r.linked).length} linked Figma ↔ code
        </p>
        <p className="mt-2 max-w-2xl text-xs text-neutral-400">
          “Linked” means Congruo knows a Figma token and a code token are the
          same design decision — the link that powers token-parity findings.
          Links are proposed only on exact signals (matching names, or identical
          unique values), never guessed.
        </p>
        <TokensTable rows={rows} />
      </main>
    </>
  );
}
