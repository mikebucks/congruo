import type {
  CanonicalGraph,
  ComponentStatus,
  Mapping,
  MatcherConfig,
} from "@congruo/core";
import { DEFAULT_MATCHER_CONFIG, proposeMappings, refKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { currentRevision } from "../../lib/revisions";
import { db } from "../../lib/server";
import {
  assignMapping,
  confirmMapping,
  ignoreComponent,
  setStatus,
  unignoreComponent,
  unlinkMapping,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUSES: ComponentStatus[] = [
  "stable",
  "new",
  "experimental",
  "deprecated",
];

export default async function MappingReview() {
  const workspace = await db().query.workspaces.findFirst();
  if (!workspace) return <main className="p-8">No workspace.</main>;

  const latest = await db().query.snapshots.findFirst({
    where: eq(schema.snapshots.workspaceId, workspace.id),
    orderBy: desc(schema.snapshots.createdAt),
  });
  if (!latest) {
    return (
      <main className="p-8">
        Run an audit first — the mapping table is built from the latest
        snapshot's extract.
      </main>
    );
  }
  const graphRow = await db().query.snapshotGraphs.findFirst({
    where: eq(schema.snapshotGraphs.snapshotId, latest.id),
  });
  const graph = graphRow?.graph as CanonicalGraph;
  const revision = await currentRevision(workspace.id);

  const userByFigma = new Map(
    revision.mappings.map((m) => [refKey(m.figmaRef), m]),
  );
  const statusByRef = new Map(
    revision.statuses.map((s) => [refKey(s.ref), s.status]),
  );
  const vetoed = new Set(revision.unlinked ?? []);
  const ignored = new Set(revision.ignored ?? []);
  const workspaceSettings =
    (workspace.settings?.matcher as Partial<MatcherConfig>) ?? {};
  const matcherConfig = { ...DEFAULT_MATCHER_CONFIG, ...workspaceSettings };
  const match = proposeMappings(graph.figma, graph.code, matcherConfig);
  const autoByFigma = new Map(
    match.proposed.map((m) => [refKey(m.figmaRef), m]),
  );
  const suggestedByFigma = new Map(
    match.suggested.map((m) => [refKey(m.figmaRef), m]),
  );

  const codeName = (m: Mapping) =>
    m.codeRef.kind === "code" ? m.codeRef.exportSymbol : refKey(m.codeRef);

  const allRows = graph.figma.definitions.map((def) => {
    const key = refKey(def.ref);
    const user = userByFigma.get(key);
    const auto = vetoed.has(key) ? undefined : autoByFigma.get(key);
    const suggested = suggestedByFigma.get(key);
    const effective = user ?? auto;
    return { def, key, user, auto, suggested, effective };
  });
  const ignoredRows = allRows.filter((r) => ignored.has(r.key));
  const rows = allRows
    .filter((r) => !ignored.has(r.key))
    .sort((a, b) => {
      const rank = (r: (typeof allRows)[number]) =>
        r.user ? 0 : r.auto ? 1 : r.suggested ? 2 : 3;
      return rank(a) - rank(b) || a.def.name.localeCompare(b.def.name);
    });

  const mapped = rows.filter((r) => r.effective).length;

  // manual-assign candidates: code defs not already claimed by a mapping
  const claimedCode = new Set(
    [...userByFigma.values(), ...autoByFigma.values()].map((m) =>
      refKey(m.codeRef),
    ),
  );
  const candidates = graph.code.definitions
    .filter((d) => !claimedCode.has(refKey(d.ref)))
    .map((d) => ({ name: d.name, ref: d.ref }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const candidatesJson = JSON.stringify(candidates);

  // bulk-ignore target: unmatched components with no API surface (assets)
  const bulkAssets = rows
    .filter(
      (r) =>
        !r.effective &&
        !r.suggested &&
        r.def.props.length === 0 &&
        Object.keys(r.def.variants).length === 0,
    )
    .map((r) => r.def.ref);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link className="text-sm text-blue-600 underline" href="/">
        ← runs
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Mapping review</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {mapped} of {rows.length} Figma components mapped · {ignoredRows.length}{" "}
        ignored · revision {revision.revision} · edits apply to the next audit
      </p>

      {bulkAssets.length > 0 && (
        <form action={ignoreComponent} className="mt-3">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="refs" value={JSON.stringify(bulkAssets)} />
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Ignore {bulkAssets.length} unmatched components with no props or
            variants
          </button>
        </form>
      )}

      <datalist id="code-candidates">
        {candidates.map((c) => (
          <option key={refKey(c.ref)} value={c.name} />
        ))}
      </datalist>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-xs text-neutral-500">
            <th className="py-2 pr-4">Figma component</th>
            <th className="py-2 pr-4">Code component</th>
            <th className="py-2 pr-4">Match</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ def, key, user, suggested, effective }) => (
            <tr key={key} className="border-b border-neutral-100">
              <td className="py-2 pr-4">{def.name}</td>
              <td className="py-2 pr-4 font-mono text-xs">
                {effective
                  ? codeName(effective)
                  : suggested
                    ? `${codeName(suggested)}?`
                    : "—"}
              </td>
              <td className="py-2 pr-4">
                {user ? (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                    user
                  </span>
                ) : effective ? (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                    auto {Math.round(effective.confidence * 100)}%
                  </span>
                ) : suggested ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    suggested {Math.round(suggested.confidence * 100)}%
                  </span>
                ) : (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                    unmatched
                  </span>
                )}
              </td>
              <td className="py-2 pr-4">
                <form action={setStatus} className="inline">
                  <input
                    type="hidden"
                    name="workspaceId"
                    value={workspace.id}
                  />
                  <input
                    type="hidden"
                    name="ref"
                    value={JSON.stringify(def.ref)}
                  />
                  <select
                    name="status"
                    defaultValue={statusByRef.get(key) ?? "stable"}
                    className="rounded border border-neutral-200 px-1 py-0.5 text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="ml-1 text-xs text-blue-600 underline"
                  >
                    set
                  </button>
                </form>
              </td>
              <td className="py-2">
                {suggested && !user && (
                  <form action={confirmMapping} className="inline">
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={workspace.id}
                    />
                    <input
                      type="hidden"
                      name="figmaRef"
                      value={JSON.stringify(def.ref)}
                    />
                    <input
                      type="hidden"
                      name="codeRef"
                      value={JSON.stringify(suggested.codeRef)}
                    />
                    <button
                      type="submit"
                      className="mr-2 text-xs text-green-700 underline"
                    >
                      confirm
                    </button>
                  </form>
                )}
                {effective && (
                  <form action={unlinkMapping} className="inline">
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={workspace.id}
                    />
                    <input
                      type="hidden"
                      name="figmaRef"
                      value={JSON.stringify(def.ref)}
                    />
                    <button
                      type="submit"
                      className="text-xs text-red-700 underline"
                    >
                      unlink
                    </button>
                  </form>
                )}
                {!effective && (
                  <span className="inline-flex items-center gap-1">
                    <form action={assignMapping} className="inline-flex gap-1">
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspace.id}
                      />
                      <input
                        type="hidden"
                        name="figmaRef"
                        value={JSON.stringify(def.ref)}
                      />
                      <input
                        type="hidden"
                        name="candidates"
                        value={candidatesJson}
                      />
                      <input
                        name="codeName"
                        list="code-candidates"
                        placeholder="assign…"
                        className="w-28 rounded border border-neutral-200 px-1 py-0.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="text-xs text-blue-600 underline"
                      >
                        set
                      </button>
                    </form>
                    <form action={ignoreComponent} className="inline">
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspace.id}
                      />
                      <input
                        type="hidden"
                        name="refs"
                        value={JSON.stringify([def.ref])}
                      />
                      <button
                        type="submit"
                        className="text-xs text-neutral-400 underline"
                      >
                        ignore
                      </button>
                    </form>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {ignoredRows.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-neutral-500">
            Ignored ({ignoredRows.length}) — out of scope, excluded from audits
          </summary>
          <ul className="mt-2 columns-3 text-sm">
            {ignoredRows.map((r) => (
              <li key={r.key} className="flex items-center gap-2 py-0.5">
                <span className="flex-1 truncate">{r.def.name}</span>
                <form action={unignoreComponent} className="inline">
                  <input
                    type="hidden"
                    name="workspaceId"
                    value={workspace.id}
                  />
                  <input type="hidden" name="refKey" value={r.key} />
                  <button
                    type="submit"
                    className="text-xs text-blue-600 underline"
                  >
                    restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
