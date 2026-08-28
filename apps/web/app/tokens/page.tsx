import type { CanonicalGraph, TokenRef } from "@congruo/core";
import { refKey, tokenKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Nav } from "../../components/nav";
import { db } from "../../lib/server";
import { tokenDisplay, tokenKind } from "../../lib/token-view";

export const dynamic = "force-dynamic";

interface TokenRow {
  key: string;
  name: string;
  swatch?: string;
  detail?: string;
  value?: string;
  type: string;
  sources: string[];
  references: number;
  linked: boolean;
}

type SortKey = "name" | "value" | "type" | "source" | "references" | "linked";
const SORT_KEYS: SortKey[] = [
  "name",
  "value",
  "type",
  "source",
  "references",
  "linked",
];

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

export default async function Tokens({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const sort: SortKey = (SORT_KEYS as string[]).includes(params.sort ?? "")
    ? (params.sort as SortKey)
    : "references";
  const dir: "asc" | "desc" =
    params.dir === "asc" || params.dir === "desc"
      ? params.dir
      : sort === "references" || sort === "linked"
        ? "desc"
        : "asc";

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

  // 8-digit hex is CSS RGBA — show the alpha as a percentage
  const formatValue = (v: string | undefined): string | undefined => {
    const m = v?.match(/^(#[0-9a-f]{6})([0-9a-f]{2})$/i);
    if (!m || !m[1] || !m[2]) return v;
    return `${m[1]} · ${Math.round((Number.parseInt(m[2], 16) / 255) * 100)}%`;
  };

  const flip = dir === "asc" ? 1 : -1;
  const numeric = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
  rows.sort((a, b) => {
    switch (sort) {
      case "references":
        return (a.references - b.references) * flip;
      case "linked":
        return (Number(a.linked) - Number(b.linked)) * flip;
      case "value": {
        const av = a.value ?? "";
        const bv = b.value ?? "";
        if (numeric(av) && numeric(bv)) {
          return (Number(av) - Number(bv)) * flip;
        }
        return av.localeCompare(bv) * flip;
      }
      case "type":
        return a.type.localeCompare(b.type) * flip;
      case "source":
        return a.sources.join().localeCompare(b.sources.join()) * flip;
      default:
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * flip;
    }
  });

  const header = (key: SortKey, label: string) => {
    const active = sort === key;
    const nextDir = active && dir === "asc" ? "desc" : "asc";
    const defaultDir =
      key === "references" || key === "linked" ? "desc" : "asc";
    const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
    return (
      <th className="py-2 pr-4">
        <Link
          className={active ? "text-neutral-900" : "text-neutral-500"}
          href={`/tokens?sort=${key}&dir=${active ? nextDir : defaultDir}`}
        >
          {label}
          {arrow}
        </Link>
      </th>
    );
  };

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
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-xs">
              {header("name", "Name")}
              {header("value", "Value")}
              {header("type", "Type")}
              {header("source", "Source")}
              {header("references", "References")}
              {header("linked", "Linked")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-neutral-100">
                <td className="max-w-xs py-1.5 pr-4">
                  <span className="truncate font-mono text-xs">{r.name}</span>
                  {r.detail && (
                    <span className="ml-2 truncate text-xs text-neutral-300">
                      {r.detail}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4">
                  <span className="inline-flex items-center gap-2">
                    {r.swatch && (
                      <span
                        className="inline-block h-4 w-4 rounded border border-neutral-200"
                        style={{ backgroundColor: r.swatch }}
                      />
                    )}
                    <span className="font-mono text-xs text-neutral-600">
                      {formatValue(r.value) ?? "—"}
                    </span>
                  </span>
                </td>
                <td className="py-1.5 pr-4 text-xs text-neutral-500">
                  {r.type}
                </td>
                <td className="py-1.5 pr-4 text-xs text-neutral-500">
                  {r.sources.join(", ")}
                </td>
                <td className="py-1.5 pr-4 tabular-nums text-neutral-600">
                  {r.references}
                </td>
                <td className="py-1.5 text-xs">
                  {r.linked ? (
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
