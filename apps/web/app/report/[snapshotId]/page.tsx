import type { Severity } from "@congruo/core";
import { schema } from "@congruo/db";
import type { CoverageSummary } from "@congruo/scoring";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "../../../lib/server";

export const dynamic = "force-dynamic";

const severityStyle: Record<Severity, string> = {
  error: "bg-red-100 text-red-800",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-sky-100 text-sky-800",
};

function CoverageBlock({ coverage: c }: { coverage: CoverageSummary }) {
  const stat = (label: string, value: string, detail: string) => (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-400">{detail}</div>
    </div>
  );
  return (
    <div className="mt-6 grid grid-cols-3 gap-3">
      {stat(
        "Figma DS coverage",
        c.figma.coveragePct === null ? "—" : `${c.figma.coveragePct}%`,
        `${c.figma.dsInstances}/${c.figma.totalInstances} instances`,
      )}
      {stat(
        "Code DS coverage",
        c.code.coveragePct === null ? "—" : `${c.code.coveragePct}%`,
        `${c.code.dsUsages} DS · ${c.code.localComponentUsages} local · ${c.code.rawStyledElements} raw styled`,
      )}
      {stat(
        "Token health",
        c.tokens.healthPct === null ? "—" : `${c.tokens.healthPct}%`,
        `${c.tokens.figmaBound + c.tokens.codeBound} bound · ${c.tokens.figmaHardcoded + c.tokens.codeHardcoded} hardcoded`,
      )}
    </div>
  );
}

export default async function Report({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = await params;
  const snapshot = await db().query.snapshots.findFirst({
    where: eq(schema.snapshots.id, snapshotId),
  });
  if (!snapshot) notFound();

  const sources = await db().query.snapshotSources.findMany({
    where: eq(schema.snapshotSources.snapshotId, snapshotId),
  });
  const systemScores = (
    await db().query.scores.findMany({
      where: eq(schema.scores.snapshotId, snapshotId),
    })
  ).filter((s) => s.subjectRefKey === null);
  const findings = await db().query.findingOccurrences.findMany({
    where: eq(schema.findingOccurrences.snapshotId, snapshotId),
  });

  const byType = new Map<string, typeof findings>();
  for (const f of findings) {
    byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link className="text-sm text-blue-600 underline" href="/">
        ← runs
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Audit snapshot</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {snapshot.createdAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
        {findings.length} findings · fingerprint v{snapshot.fingerprintVersion}
      </p>

      {typeof snapshot.topline === "number" && (
        <div className="mt-6 flex items-end gap-6">
          <div>
            <div className="text-xs text-neutral-500">System health</div>
            <div className="text-5xl font-semibold tabular-nums">
              {Math.round(snapshot.topline)}
            </div>
          </div>
          <div className="flex gap-4 pb-1">
            {systemScores.map((s) => (
              <div key={s.dimension}>
                <div className="text-xs capitalize text-neutral-500">
                  {s.dimension}
                </div>
                <div className="text-xl font-medium tabular-nums">
                  {s.score === null ? "—" : Math.round(s.score)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshot.coverage && (
        <CoverageBlock
          coverage={snapshot.coverage as unknown as CoverageSummary}
        />
      )}

      <div className="mt-4 rounded-lg bg-neutral-100 p-4 text-xs text-neutral-600">
        {sources.map((s) => (
          <div key={s.id}>
            {s.artifact.side} · {s.artifact.role} ·{" "}
            {s.artifact.ref.fileKey ??
              `${s.artifact.ref.repo ?? ""} ${s.artifact.ref.pkg ?? ""}`}{" "}
            @ {s.artifact.version.slice(0, 12)}
          </div>
        ))}
      </div>

      {[...byType.entries()].map(([type, group]) => (
        <section key={type} className="mt-8">
          <h2 className="font-mono text-sm font-medium">
            {type}{" "}
            <span className="font-sans text-neutral-400">({group.length})</span>
          </h2>
          <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {group.slice(0, 25).map((f) => (
              <li key={f.id} className="flex items-start gap-3 p-3 text-sm">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${severityStyle[f.severity]}`}
                >
                  {f.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-neutral-500">
                    {f.subjectRefKey ?? "system"}
                  </div>
                  <pre className="mt-1 overflow-x-auto text-xs text-neutral-700">
                    {JSON.stringify(f.evidence, null, 1)}
                  </pre>
                </div>
              </li>
            ))}
            {group.length > 25 && (
              <li className="p-3 text-xs text-neutral-400">
                …and {group.length - 25} more
              </li>
            )}
          </ul>
        </section>
      ))}
    </main>
  );
}
