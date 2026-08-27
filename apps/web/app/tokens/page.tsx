import type { CanonicalGraph, TokenRef } from "@congruo/core";
import { refKey, tokenKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import { Nav } from "../../components/nav";
import { db } from "../../lib/server";

export const dynamic = "force-dynamic";

interface TokenRow {
  key: string;
  name: string;
  sources: Set<TokenRef["source"]>;
  componentsUsing: number;
  mapped: boolean;
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

  const mappedFigma = new Set(
    latest.mappingSet.tokenMappings.map((m) => tokenKey(m.figmaToken)),
  );
  const mappedCode = new Set(
    latest.mappingSet.tokenMappings.map((m) => tokenKey(m.codeToken)),
  );

  const rows = new Map<string, TokenRow>();
  const componentsSeen = new Map<string, Set<string>>();
  for (const side of ["figma", "code"] as const) {
    for (const def of graph[side].definitions) {
      for (const t of def.tokensUsed) {
        const key = tokenKey(t.token);
        const row = rows.get(key) ?? {
          key,
          name: t.token.resolvedName ?? t.token.nativeId,
          sources: new Set<TokenRef["source"]>(),
          componentsUsing: 0,
          mapped: mappedFigma.has(key) || mappedCode.has(key),
        };
        row.sources.add(t.token.source);
        const seen = componentsSeen.get(key) ?? new Set<string>();
        seen.add(refKey(def.ref));
        componentsSeen.set(key, seen);
        rows.set(key, row);
      }
    }
  }
  for (const [key, row] of rows) {
    row.componentsUsing = componentsSeen.get(key)?.size ?? 0;
  }
  const sorted = [...rows.values()].sort(
    (a, b) => b.componentsUsing - a.componentsUsing,
  );

  const sourceLabel: Record<TokenRef["source"], string> = {
    "figma-variable": "figma variable",
    "figma-style": "figma style",
    "tokens-studio": "tokens studio",
    code: "code",
  };

  return (
    <>
      <Nav active="tokens" />
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-2xl font-semibold">Tokens</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {sorted.length} tokens in use across components ·{" "}
          {sorted.filter((r) => r.mapped).length} linked Figma ↔ code
        </p>
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-xs text-neutral-500">
              <th className="py-2 pr-4">Token</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Components using</th>
              <th className="py-2">Figma ↔ code</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-b border-neutral-100">
                <td className="max-w-md truncate py-1.5 pr-4 font-mono text-xs">
                  {r.name}
                </td>
                <td className="py-1.5 pr-4 text-xs text-neutral-500">
                  {[...r.sources].map((s) => sourceLabel[s]).join(", ")}
                </td>
                <td className="py-1.5 pr-4 tabular-nums text-neutral-600">
                  {r.componentsUsing}
                </td>
                <td className="py-1.5 text-xs">
                  {r.mapped ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">
                      linked
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
