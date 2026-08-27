import type { CanonicalGraph } from "@congruo/core";
import { tokenKey } from "@congruo/core";
import { schema } from "@congruo/db";
import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Nav } from "../components/nav";
import { grade } from "../lib/grade";
import { db } from "../lib/server";
import { startAudit } from "./actions";

export const dynamic = "force-dynamic";

function ago(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function ScoreChart({ points }: { points: { date: Date; topline: number }[] }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-neutral-400">
        Score over time appears after your second audit.
      </p>
    );
  }
  const w = 800;
  const h = 160;
  const pad = 24;
  const xs = points.map(
    (_, i) => pad + (i * (w - 2 * pad)) / (points.length - 1),
  );
  const min = Math.min(...points.map((p) => p.topline));
  const max = Math.max(...points.map((p) => p.topline));
  const span = Math.max(max - min, 10);
  const y = (v: number) =>
    h - pad - ((v - (min - 5)) / (span + 10)) * (h - 2 * pad);
  const path = points.map((p, i) => `${xs[i]},${y(p.topline)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      role="img"
      aria-label="Score over time"
    >
      <polyline
        points={path}
        fill="none"
        stroke="#171717"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <g key={p.date.toISOString()}>
          <circle cx={xs[i]} cy={y(p.topline)} r="3" fill="#171717" />
          <text
            x={xs[i]}
            y={y(p.topline) - 8}
            textAnchor="middle"
            className="fill-neutral-500"
            fontSize="10"
          >
            {Math.round(p.topline)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function Dashboard() {
  const workspace = await db().query.workspaces.findFirst();
  if (!workspace) {
    return (
      <>
        <Nav active="dashboard" />
        <main className="mx-auto max-w-5xl p-8">
          <p className="text-neutral-600">
            No workspace yet.{" "}
            <Link className="text-blue-600 underline" href="/config">
              Connect your sources
            </Link>{" "}
            to run your first audit.
          </p>
        </main>
      </>
    );
  }

  const latest = await db().query.snapshots.findFirst({
    where: eq(schema.snapshots.workspaceId, workspace.id),
    orderBy: desc(schema.snapshots.createdAt),
  });
  const lastRun = await db().query.auditRuns.findFirst({
    where: eq(schema.auditRuns.workspaceId, workspace.id),
    orderBy: desc(schema.auditRuns.createdAt),
  });

  if (!latest) {
    return (
      <>
        <Nav active="dashboard" />
        <main className="mx-auto max-w-5xl p-8">
          <p className="text-neutral-600">
            {lastRun && lastRun.status !== "failed"
              ? `First audit ${lastRun.status}…`
              : "No audit yet."}{" "}
            <Link className="text-blue-600 underline" href="/config">
              Config
            </Link>
          </p>
        </main>
      </>
    );
  }

  const history = await db()
    .select({
      createdAt: schema.snapshots.createdAt,
      topline: schema.snapshots.topline,
    })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.workspaceId, workspace.id))
    .orderBy(asc(schema.snapshots.createdAt));
  const points = history
    .filter(
      (s): s is { createdAt: Date; topline: number } => s.topline !== null,
    )
    .map((s) => ({ date: s.createdAt, topline: s.topline }));

  const componentScores = (
    await db().query.scores.findMany({
      where: eq(schema.scores.snapshotId, latest.id),
    })
  ).filter((s) => s.subjectRefKey !== null && s.dimension === "parity");
  const componentCount = componentScores.length;
  const topComponents = [...componentScores]
    .sort((a, b) => (b.usageTotal ?? 0) - (a.usageTotal ?? 0))
    .slice(0, 20);

  // token universe + usage from the latest graph
  const graphRow = await db().query.snapshotGraphs.findFirst({
    where: eq(schema.snapshotGraphs.snapshotId, latest.id),
  });
  const graph = graphRow?.graph as CanonicalGraph;
  const tokenUse = new Map<string, { name: string; uses: number }>();
  for (const side of ["figma", "code"] as const) {
    for (const def of graph[side].definitions) {
      for (const t of def.tokensUsed) {
        const key = tokenKey(t.token);
        const entry = tokenUse.get(key) ?? {
          name: t.token.resolvedName ?? t.token.nativeId,
          uses: 0,
        };
        entry.uses++;
        tokenUse.set(key, entry);
      }
    }
  }
  const tokenCount = tokenUse.size;
  const topTokens = [...tokenUse.values()]
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 20);

  const sides = [
    graph.figma.artifacts.length > 0 ? "Figma" : null,
    graph.code.artifacts.length > 0 ? "React" : null,
  ].filter(Boolean);

  return (
    <>
      <Nav active="dashboard" />
      <main className="mx-auto max-w-5xl space-y-6 p-8">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-neutral-200 bg-white p-5 text-center">
            <div className="text-sm text-neutral-500">Components</div>
            <div className="text-5xl font-semibold tabular-nums">
              <Link href="/components" className="hover:underline">
                {componentCount}
              </Link>
            </div>
            <div className="mt-1 text-xs text-neutral-400">
              {sides.join(" · ")}
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-5 text-center">
            <div className="text-sm text-neutral-500">Tokens</div>
            <div className="text-5xl font-semibold tabular-nums">
              <Link href="/tokens" className="hover:underline">
                {tokenCount}
              </Link>
            </div>
            <div className="mt-1 text-xs text-neutral-400">in use</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-5 text-center">
            <div className="text-sm text-neutral-500">Score</div>
            <div className="text-5xl font-semibold">
              <Link href={`/report/${latest.id}`} className="hover:underline">
                {latest.topline === null ? "—" : grade(latest.topline)}
              </Link>
            </div>
            <div className="mt-1 text-xs text-neutral-400">
              {latest.topline === null
                ? ""
                : `${Math.round(latest.topline)} · `}
              last run {ago(latest.createdAt)}
              {lastRun && lastRun.status !== "succeeded" && (
                <span className="ml-1 text-amber-600">({lastRun.status})</span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-500">
              Score over time
            </h2>
            <form action={startAudit}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <button
                type="submit"
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Run audit
              </button>
            </form>
          </div>
          <div className="mt-3">
            <ScoreChart points={points} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-neutral-500">
                Most used components
              </h2>
              <Link
                className="text-sm text-blue-600 underline"
                href="/components"
              >
                All components
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-neutral-100 text-sm">
              {topComponents.map((c) => (
                <li
                  key={c.subjectRefKey}
                  className="flex justify-between py-1.5"
                >
                  <Link
                    className="hover:underline"
                    href={`/report/${latest.id}/component/${encodeURIComponent(c.subjectRefKey ?? "")}`}
                  >
                    {c.name}
                  </Link>
                  <span className="tabular-nums text-neutral-400">
                    {c.usageTotal}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-neutral-500">
                Most used tokens
              </h2>
              <Link className="text-sm text-blue-600 underline" href="/tokens">
                All tokens
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-neutral-100 text-sm">
              {topTokens.map((t) => (
                <li key={t.name} className="flex justify-between py-1.5">
                  <span className="truncate">{t.name}</span>
                  <span className="tabular-nums text-neutral-400">
                    {t.uses}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}
