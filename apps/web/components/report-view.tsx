import type { Severity } from "@congruo/core";
import type { CoverageSummary } from "@congruo/scoring";
import Link from "next/link";
import { refKeyName, summarize } from "../lib/evidence";
import { type ReportData, rankFindings } from "../lib/report-data";

export const severityStyle: Record<Severity, string> = {
  error: "bg-red-100 text-red-800",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-sky-100 text-sky-800",
};

const DIMENSION_ORDER = [
  "parity",
  "complexity",
  "adoption",
  "documentation",
] as const;

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {detail && (
        <div className="mt-0.5 text-xs text-neutral-400">{detail}</div>
      )}
    </div>
  );
}

function CoverageRow({ c }: { c: CoverageSummary }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-3">
      <Stat
        label="Figma DS coverage"
        value={c.figma.coveragePct === null ? "—" : `${c.figma.coveragePct}%`}
        detail={`${c.figma.dsInstances}/${c.figma.totalInstances} instances are DS`}
      />
      <Stat
        label="Code DS coverage"
        value={c.code.coveragePct === null ? "—" : `${c.code.coveragePct}%`}
        detail={`${c.code.dsUsages} DS · ${c.code.localComponentUsages} local · ${c.code.rawStyledElements} raw styled`}
      />
      <Stat
        label="Token health"
        value={c.tokens.healthPct === null ? "—" : `${c.tokens.healthPct}%`}
        detail={`${c.tokens.figmaBound + c.tokens.codeBound} bound · ${c.tokens.figmaHardcoded + c.tokens.codeHardcoded} hardcoded`}
      />
    </div>
  );
}

export function ReportSummary({
  data,
  basePath,
}: {
  data: ReportData;
  /** authed: /report/:id — share mode passes null to hide drill-down links */
  basePath: string | null;
}) {
  const { snapshot, sources, findings, componentScores, systemScores } = data;
  // top list shows one finding per (component, type) — variety over repetition
  const seen = new Set<string>();
  const top10 = rankFindings(findings, componentScores)
    .filter((f) => {
      const key = `${f.canonicalKey}:${f.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-8">
          <div>
            <div className="text-xs text-neutral-500">System health</div>
            <div className="text-6xl font-semibold tabular-nums">
              {typeof snapshot.topline === "number"
                ? Math.round(snapshot.topline)
                : "—"}
            </div>
          </div>
          <div className="flex gap-5 pb-1.5">
            {DIMENSION_ORDER.map((d) => (
              <div key={d}>
                <div className="text-xs capitalize text-neutral-500">{d}</div>
                <div className="text-2xl font-medium tabular-nums">
                  {systemScores[d] == null ? "—" : Math.round(systemScores[d])}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="pb-1 text-right text-xs text-neutral-400">
          {snapshot.createdAt.toISOString().slice(0, 10)} ·{" "}
          {findings.length.toLocaleString()} findings
        </div>
      </div>

      {data.delta && (
        <div className="mt-4 flex items-center gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm">
          <span className="text-xs text-neutral-500">
            Since {data.delta.previousDate.toISOString().slice(0, 10)}
          </span>
          {data.delta.comparable ? (
            <>
              {data.delta.topline !== null && (
                <span
                  className={`font-medium tabular-nums ${
                    data.delta.topline > 0
                      ? "text-green-700"
                      : data.delta.topline < 0
                        ? "text-red-700"
                        : "text-neutral-500"
                  }`}
                >
                  {data.delta.topline > 0 ? "+" : ""}
                  {Math.round(data.delta.topline)} health
                </span>
              )}
              <span className="text-amber-700">{data.delta.newCount} new</span>
              <span className="text-green-700">
                {data.delta.resolvedCount} resolved
              </span>
              <span className="text-neutral-500">
                {data.delta.persistingCount} persisting
              </span>
            </>
          ) : (
            <span className="text-neutral-500">
              sources changed — deltas not comparable
            </span>
          )}
        </div>
      )}

      {data.coverage && <CoverageRow c={data.coverage} />}

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-neutral-500">
            Top issues by severity × reach
          </h2>
          {basePath && (
            <div className="flex gap-3 text-sm">
              <Link
                className="text-blue-600 underline"
                href={`${basePath}/components`}
              >
                All components
              </Link>
              <Link
                className="text-blue-600 underline"
                href={`${basePath}/punch-list`}
              >
                Full punch list
              </Link>
            </div>
          )}
        </div>
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {top10.map((f) => {
            const name = f.canonicalKey
              ? (componentScores.get(f.canonicalKey)?.name ??
                refKeyName(f.canonicalKey))
              : "System";
            return (
              <li key={f.id} className="flex items-start gap-3 p-3 text-sm">
                <span
                  className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${severityStyle[f.severity]}`}
                >
                  {f.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">
                    {basePath && f.canonicalKey ? (
                      <Link
                        className="hover:underline"
                        href={`${basePath}/component/${encodeURIComponent(f.canonicalKey)}`}
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </span>{" "}
                  <span className="text-neutral-600">
                    {summarize(f.type, f.evidence)}
                  </span>
                </div>
                {f.reach > 0 && (
                  <span className="whitespace-nowrap text-xs text-neutral-400">
                    {f.reach} uses
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-6 rounded-lg bg-neutral-100 p-3 text-xs text-neutral-500">
        {sources.map((s) => (
          <div key={s.id}>
            {s.artifact.side} · {s.artifact.role} ·{" "}
            {s.artifact.ref.fileKey ??
              `${s.artifact.ref.repo ?? ""} ${s.artifact.ref.pkg ?? ""}`.trim()}{" "}
            @ {s.artifact.version.slice(0, 12)}
          </div>
        ))}
        {data.coverage && (
          <div className="mt-1">
            Scope: {data.coverage.files.analyzed} sources analyzed ·{" "}
            {data.coverage.files.skippedOrFailed} skipped or failed
          </div>
        )}
      </footer>
    </div>
  );
}
