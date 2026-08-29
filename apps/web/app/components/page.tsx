import type {
  CanonicalGraph,
  ComponentDefinition,
  ComponentRef,
  Dimension,
  Mapping,
  MatcherConfig,
} from "@congruo/core";
import { DEFAULT_MATCHER_CONFIG, proposeMappings, refKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import { Nav } from "../../components/nav";
import { currentRevision } from "../../lib/revisions";
import { db } from "../../lib/server";
import { ignoreComponent, unignoreComponent } from "./actions";
import { type ComponentRowData, ComponentsTable } from "./components-table";

export const dynamic = "force-dynamic";

/** One row per LOGICAL component: it may exist in Figma, in code, or both.
 * A workspace with only one side connected still gets a full list. */
interface Row {
  key: string;
  figmaDef?: ComponentDefinition;
  codeDef?: ComponentDefinition;
  user?: Mapping;
  auto?: Mapping;
  suggested?: Mapping;
  effective?: Mapping;
}

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
        Run an audit first — the component list is built from the latest
        snapshot's extract.
      </main>
    );
  }
  const graphRow = await db().query.snapshotGraphs.findFirst({
    where: eq(schema.snapshotGraphs.snapshotId, latest.id),
  });
  const graph = graphRow?.graph as CanonicalGraph;
  const revision = await currentRevision(workspace.id);

  // latest scores join onto the same rows: one list manages AND reports
  const scoreRows = (
    await db().query.scores.findMany({
      where: eq(schema.scores.snapshotId, latest.id),
    })
  ).filter((s) => s.subjectRefKey !== null);
  const scoresByKey = new Map<
    string,
    { usageTotal: number; scores: Partial<Record<Dimension, number | null>> }
  >();
  for (const row of scoreRows) {
    const key = row.subjectRefKey as string;
    const entry = scoresByKey.get(key) ?? {
      usageTotal: row.usageTotal ?? 0,
      scores: {},
    };
    entry.scores[row.dimension] = row.score;
    scoresByKey.set(key, entry);
  }

  const userByFigma = new Map(
    revision.mappings.map((m) => [refKey(m.figmaRef), m]),
  );
  const userByCode = new Map(
    revision.mappings.map((m) => [refKey(m.codeRef), m]),
  );
  const statusByRef = new Map(
    revision.statuses.map((s) => [refKey(s.ref), s.status]),
  );
  const vetoed = new Set(revision.unlinked ?? []);
  const ignored = new Set(revision.ignored ?? []);
  const matcherConfig: MatcherConfig = {
    ...DEFAULT_MATCHER_CONFIG,
    ...((workspace.settings?.matcher as Partial<MatcherConfig>) ?? {}),
  };
  const match = proposeMappings(graph.figma, graph.code, matcherConfig);
  const autoByFigma = new Map(
    match.proposed.map((m) => [refKey(m.figmaRef), m]),
  );
  const suggestedByFigma = new Map(
    match.suggested.map((m) => [refKey(m.figmaRef), m]),
  );
  const codeByKey = new Map(
    graph.code.definitions.map((d) => [refKey(d.ref), d]),
  );

  // one row per logical component: pairs collapse, leftovers of BOTH sides
  const claimedCode = new Set<string>();
  const allRows: Row[] = graph.figma.definitions.map((def) => {
    const key = refKey(def.ref);
    const user = userByFigma.get(key);
    const auto = vetoed.has(key) ? undefined : autoByFigma.get(key);
    const suggested = suggestedByFigma.get(key);
    const effective = user ?? auto;
    const codeDef = effective
      ? codeByKey.get(refKey(effective.codeRef))
      : undefined;
    if (effective) claimedCode.add(refKey(effective.codeRef));
    return { key, figmaDef: def, codeDef, user, auto, suggested, effective };
  });
  for (const def of graph.code.definitions) {
    const key = refKey(def.ref);
    if (claimedCode.has(key)) continue;
    allRows.push({ key, codeDef: def, user: userByCode.get(key) });
  }

  const ignoredRows = allRows.filter((r) => ignored.has(r.key));
  const rows = allRows
    .filter((r) => !ignored.has(r.key))
    .sort((a, b) => {
      const rank = (r: Row) => (r.user ? 0 : r.auto ? 1 : r.suggested ? 2 : 3);
      const name = (r: Row) => r.codeDef?.name ?? r.figmaDef?.name ?? r.key;
      return rank(a) - rank(b) || name(a).localeCompare(name(b));
    });
  const linked = rows.filter((r) => r.effective).length;

  // assign candidates: the unclaimed remainder of each side
  const codeCandidates = graph.code.definitions
    .filter((d) => !claimedCode.has(refKey(d.ref)))
    .map((d) => ({ name: d.name, ref: d.ref }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const figmaCandidates = graph.figma.definitions
    .filter((d) => {
      const key = refKey(d.ref);
      const auto = vetoed.has(key) ? undefined : autoByFigma.get(key);
      return !userByFigma.get(key) && !auto;
    })
    .map((d) => ({ name: d.name, ref: d.ref }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const primaryDef = (r: Row) =>
    (r.figmaDef ?? r.codeDef) as ComponentDefinition;
  const primaryRef = (r: Row): ComponentRef => primaryDef(r).ref;

  const bulkAssets = rows
    .filter((r) => {
      if (r.effective || r.suggested) return false;
      const def = primaryDef(r);
      return (
        def.kind !== "asset" &&
        def.props.length === 0 &&
        Object.keys(def.variants).length === 0
      );
    })
    .map((r) => primaryRef(r));

  const tableRows: ComponentRowData[] = rows.map((r) => {
    const name = r.codeDef?.name ?? r.figmaDef?.name ?? r.key;
    // scores key on the canonical subject (code side of a pair)
    const score =
      scoresByKey.get(r.key) ??
      (r.effective ? scoresByKey.get(refKey(r.effective.codeRef)) : undefined);
    const link = r.user
      ? "user"
      : r.effective
        ? "auto"
        : r.suggested
          ? "suggested"
          : "none";
    return {
      key: r.key,
      name,
      figmaName:
        r.figmaDef && r.codeDef && r.figmaDef.name !== r.codeDef.name
          ? r.figmaDef.name
          : undefined,
      side: r.figmaDef && r.codeDef ? "both" : r.figmaDef ? "figma" : "code",
      usage: score?.usageTotal ?? 0,
      scores: {
        parity: score?.scores.parity ?? null,
        complexity: score?.scores.complexity ?? null,
        adoption: score?.scores.adoption ?? null,
        documentation: score?.scores.documentation ?? null,
      },
      link,
      confidence: (r.effective ?? r.suggested)?.confidence,
      suggestedSymbol:
        r.suggested?.codeRef.kind === "code"
          ? r.suggested.codeRef.exportSymbol
          : undefined,
      status: statusByRef.get(r.key) ?? "stable",
      subjectSide: r.figmaDef ? "figma" : "code",
      primaryRef: primaryRef(r),
      figmaRef: r.figmaDef?.ref,
      suggestedCodeRef: r.suggested?.codeRef,
      effectiveFigmaRef: r.effective?.figmaRef,
      detailHref: `/report/${latest.id}/component/${encodeURIComponent(r.key)}`,
    };
  });

  return (
    <>
      <Nav active="components" />
      <main className="mx-auto max-w-6xl p-8">
        <h1 className="text-2xl font-semibold">Components</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {rows.length} components · {linked} exist in both Figma and code ·{" "}
          {ignoredRows.length} ignored · revision {revision.revision} · edits
          apply to the next audit
        </p>

        {bulkAssets.length > 0 && (
          <form action={ignoreComponent} className="mt-3">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input
              type="hidden"
              name="refs"
              value={JSON.stringify(bulkAssets)}
            />
            <button
              type="submit"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Ignore {bulkAssets.length} unlinked components with no props or
              variants
            </button>
          </form>
        )}

        <ComponentsTable
          rows={tableRows}
          workspaceId={workspace.id}
          codeCandidates={codeCandidates}
          figmaCandidates={figmaCandidates}
        />

        {ignoredRows.length > 0 && (
          <details className="mt-8">
            <summary className="cursor-pointer text-sm text-neutral-500">
              Ignored ({ignoredRows.length}) — out of scope, excluded from
              audits
            </summary>
            <ul className="mt-2 columns-3 text-sm">
              {ignoredRows.map((r) => (
                <li key={r.key} className="flex items-center gap-2 py-0.5">
                  <span className="flex-1 truncate">
                    {r.codeDef?.name ?? r.figmaDef?.name ?? r.key}
                  </span>
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
    </>
  );
}
