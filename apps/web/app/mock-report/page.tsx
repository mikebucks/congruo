import type { Severity } from "@congruo/core";
import { mockSummary as s } from "../../lib/mock-snapshot";

const severityStyle: Record<Severity, string> = {
  error: "bg-red-100 text-red-800",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-sky-100 text-sky-800",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-sm text-neutral-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function MockReport() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{s.workspaceName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Audit snapshot · {s.snapshotDate}
          </p>
        </div>
        <span className="rounded bg-neutral-200 px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-600">
          Mock data
        </span>
      </header>

      <section className="mt-6 grid grid-cols-3 gap-4">
        <Stat label="System health" value={`${s.topline}`} />
        <Stat label="DS coverage" value={`${s.coveragePct}%`} />
        <Stat label="Token health" value={`${s.tokenHealthPct}%`} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Dimensions</h2>
        <div className="mt-2 space-y-2">
          {s.dimensions.map((d) => (
            <div key={d.dimension} className="flex items-center gap-3">
              <span className="w-36 text-sm capitalize">{d.dimension}</span>
              {d.score === null ? (
                <span className="text-sm text-neutral-400">unassessed</span>
              ) : (
                <>
                  <div className="h-2 flex-1 rounded bg-neutral-200">
                    <div
                      className="h-2 rounded bg-neutral-800"
                      style={{ width: `${d.score}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm tabular-nums">
                    {d.score}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Punch list</h2>
        <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {s.punchList.map((p) => (
            <li
              key={`${p.type}:${p.subjectName}`}
              className="flex items-start gap-3 p-4"
            >
              <span
                className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${severityStyle[p.severity]}`}
              >
                {p.severity}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {p.subjectName}
                  <span className="ml-2 font-mono text-xs text-neutral-400">
                    {p.type}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-neutral-600">{p.summary}</p>
              </div>
              {p.reach > 0 && (
                <span className="text-xs text-neutral-400">
                  {p.reach} instances
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-8 rounded-lg bg-neutral-100 p-4 text-xs text-neutral-500">
        <div>
          Scope: {s.scope.consumerFilesInScope} consumer files ·{" "}
          {s.scope.codeFilesAnalyzed} code files analyzed ·{" "}
          {s.scope.filesSkipped} skipped
          {s.scope.unassessed.length > 0 &&
            ` · unassessed: ${s.scope.unassessed.join(", ")}`}
        </div>
        <div className="mt-1">
          Sources:{" "}
          {s.sources.map((x) => `${x.label} (${x.version})`).join(" · ")}
        </div>
      </footer>
    </main>
  );
}
