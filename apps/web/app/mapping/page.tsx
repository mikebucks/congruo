import type { CanonicalGraph, ComponentStatus, Mapping } from "@congruo/core";
import { proposeMappings, refKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { currentRevision } from "../../lib/revisions";
import { db } from "../../lib/server";
import { confirmMapping, setStatus, unlinkMapping } from "./actions";

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
  const match = proposeMappings(graph.figma, graph.code);
  const autoByFigma = new Map(
    match.proposed.map((m) => [refKey(m.figmaRef), m]),
  );
  const suggestedByFigma = new Map(
    match.suggested.map((m) => [refKey(m.figmaRef), m]),
  );

  const codeName = (m: Mapping) =>
    m.codeRef.kind === "code" ? m.codeRef.exportSymbol : refKey(m.codeRef);

  const rows = graph.figma.definitions
    .map((def) => {
      const key = refKey(def.ref);
      const user = userByFigma.get(key);
      const auto = vetoed.has(key) ? undefined : autoByFigma.get(key);
      const suggested = suggestedByFigma.get(key);
      const effective = user ?? auto;
      return { def, key, user, auto, suggested, effective };
    })
    .sort((a, b) => {
      const rank = (r: typeof a) =>
        r.user ? 0 : r.auto ? 1 : r.suggested ? 2 : 3;
      return rank(a) - rank(b) || a.def.name.localeCompare(b.def.name);
    });

  const mapped = rows.filter((r) => r.effective).length;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link className="text-sm text-blue-600 underline" href="/">
        ← runs
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Mapping review</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {mapped} of {rows.length} Figma components mapped · revision{" "}
        {revision.revision} · edits apply to the next audit
      </p>

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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
