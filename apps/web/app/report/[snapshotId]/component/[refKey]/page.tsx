import type { Dimension, Loc } from "@congruo/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { severityStyle } from "../../../../../components/report-view";
import { locationLink, summarize } from "../../../../../lib/evidence";
import { loadReport } from "../../../../../lib/report-data";

export const dynamic = "force-dynamic";

const DIMS: Dimension[] = ["parity", "complexity", "adoption", "documentation"];

export default async function ComponentDetail({
  params,
}: {
  params: Promise<{ snapshotId: string; refKey: string }>;
}) {
  const { snapshotId, refKey: encoded } = await params;
  const refKey = decodeURIComponent(encoded);
  const data = await loadReport(snapshotId);
  if (!data) notFound();
  const component = data.componentScores.get(refKey);
  if (!component) notFound();

  const codeRepo = data.sources.find((s) => s.artifact.role === "ds-package")
    ?.artifact.ref.repo;
  const findings = data.findings.filter((f) => f.canonicalKey === refKey);
  const base = `/report/${snapshotId}`;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link
        className="text-sm text-blue-600 underline"
        href={`${base}/components`}
      >
        ← components
      </Link>
      <div className="mt-2 flex items-end justify-between">
        <h1 className="text-2xl font-semibold">{component.name}</h1>
        <span className="text-sm text-neutral-500">
          {component.usageTotal} total usages
        </span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        {DIMS.map((d) => {
          const v = component.scores[d];
          return (
            <div
              key={d}
              className="rounded-lg border border-neutral-200 bg-white p-3"
            >
              <div className="text-xs capitalize text-neutral-500">{d}</div>
              <div className="text-3xl font-semibold tabular-nums">
                {v == null ? "—" : Math.round(v)}
              </div>
              {v == null && (
                <div className="text-xs text-neutral-400">unassessed</div>
              )}
            </div>
          );
        })}
      </div>

      {DIMS.map((d) => {
        const group = findings.filter((f) => f.dimension === d);
        if (group.length === 0) return null;
        return (
          <section key={d} className="mt-8">
            <h2 className="text-sm font-medium capitalize text-neutral-500">
              {d} · {group.length}
            </h2>
            <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
              {group.map((f) => (
                <li key={f.id} className="p-3 text-sm">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${severityStyle[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-xs text-neutral-400">
                        {f.type}
                      </span>
                      <p className="mt-0.5 text-neutral-700">
                        {summarize(f.type, f.evidence)}
                      </p>
                      {(f.locations as Loc[]).length > 0 && (
                        <p className="mt-1 space-x-3 text-xs">
                          {(f.locations as Loc[]).slice(0, 6).map((loc) => {
                            const { href, label } = locationLink(loc, codeRepo);
                            const key =
                              loc.kind === "figma"
                                ? `${loc.fileKey}:${loc.nodeId}`
                                : `${loc.filePath}:${loc.line}:${loc.col}`;
                            return href ? (
                              <a
                                key={key}
                                className="text-blue-600 underline"
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {label}
                              </a>
                            ) : (
                              <span key={key} className="text-neutral-400">
                                {label}
                              </span>
                            );
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
