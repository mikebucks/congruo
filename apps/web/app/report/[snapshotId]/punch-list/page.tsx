import Link from "next/link";
import { notFound } from "next/navigation";
import { severityStyle } from "../../../../components/report-view";
import { refKeyName, summarize } from "../../../../lib/evidence";
import { loadReport, rankFindings } from "../../../../lib/report-data";

export const dynamic = "force-dynamic";

export default async function PunchList({
  params,
  searchParams,
}: {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<{
    dimension?: string;
    severity?: string;
    type?: string;
  }>;
}) {
  const { snapshotId } = await params;
  const filters = await searchParams;
  const data = await loadReport(snapshotId);
  if (!data) notFound();

  const ranked = rankFindings(data.findings, data.componentScores).filter(
    (f) =>
      (!filters.dimension || f.dimension === filters.dimension) &&
      (!filters.severity || f.severity === filters.severity) &&
      (!filters.type || f.type === filters.type),
  );
  const base = `/report/${snapshotId}`;
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...filters, ...patch };
    const params = Object.entries(merged).filter(([, v]) => v) as [
      string,
      string,
    ][];
    return params.length
      ? `?${new URLSearchParams(Object.fromEntries(params))}`
      : "";
  };

  const dimensions = ["parity", "complexity", "adoption", "documentation"];
  const severities = ["error", "warn", "info"];
  const types = [...new Set(data.findings.map((f) => f.type))].sort();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link className="text-sm text-blue-600 underline" href={base}>
        ← summary
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">
        Punch list{" "}
        <span className="text-base font-normal text-neutral-400">
          ({ranked.length.toLocaleString()})
        </span>
      </h1>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Link
          className={`rounded-full border px-2.5 py-1 ${!filters.dimension && !filters.severity && !filters.type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
          href={`${base}/punch-list`}
        >
          all
        </Link>
        {dimensions.map((d) => (
          <Link
            key={d}
            className={`rounded-full border px-2.5 py-1 ${filters.dimension === d ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
            href={`${base}/punch-list${qs({ dimension: filters.dimension === d ? undefined : d })}`}
          >
            {d}
          </Link>
        ))}
        {severities.map((s) => (
          <Link
            key={s}
            className={`rounded-full border px-2.5 py-1 ${filters.severity === s ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
            href={`${base}/punch-list${qs({ severity: filters.severity === s ? undefined : s })}`}
          >
            {s}
          </Link>
        ))}
        <form method="get" className="inline-flex gap-1">
          {filters.dimension && (
            <input type="hidden" name="dimension" value={filters.dimension} />
          )}
          {filters.severity && (
            <input type="hidden" name="severity" value={filters.severity} />
          )}
          <select
            name="type"
            className="rounded-full border border-neutral-300 px-2 py-1"
            defaultValue={filters.type ?? ""}
          >
            <option value="">any type</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full border border-neutral-300 px-2.5 py-1"
          >
            apply
          </button>
        </form>
      </div>

      <ul className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
        {ranked.slice(0, 200).map((f) => {
          const name = f.canonicalKey
            ? (data.componentScores.get(f.canonicalKey)?.name ??
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
                {f.canonicalKey ? (
                  <Link
                    className="font-medium hover:underline"
                    href={`${base}/component/${encodeURIComponent(f.canonicalKey)}`}
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="font-medium">{name}</span>
                )}{" "}
                <span className="text-neutral-600">
                  {summarize(f.type, f.evidence)}
                </span>
                <span className="ml-2 font-mono text-xs text-neutral-300">
                  {f.type}
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
        {ranked.length > 200 && (
          <li className="p-3 text-xs text-neutral-400">
            …and {ranked.length - 200} more — narrow with the filters above
          </li>
        )}
      </ul>
    </main>
  );
}
