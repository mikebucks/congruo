import type { Dimension } from "@congruo/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadReport } from "../../../../lib/report-data";

export const dynamic = "force-dynamic";

const DIMS: Dimension[] = ["parity", "complexity", "adoption", "documentation"];

export default async function ComponentTable({
  params,
  searchParams,
}: {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { snapshotId } = await params;
  const { sort } = await searchParams;
  const data = await loadReport(snapshotId);
  if (!data) notFound();

  const rows = [...data.componentScores.entries()].map(([refKey, c]) => ({
    refKey,
    ...c,
  }));
  const sortKey = (DIMS as string[]).includes(sort ?? "")
    ? (sort as Dimension)
    : sort === "usage"
      ? "usage"
      : "name";
  rows.sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    if (sortKey === "usage") return b.usageTotal - a.usageTotal;
    const av = a.scores[sortKey] ?? Number.POSITIVE_INFINITY;
    const bv = b.scores[sortKey] ?? Number.POSITIVE_INFINITY;
    return (av as number) - (bv as number); // worst first
  });

  const base = `/report/${snapshotId}`;
  const header = (label: string, key: string) => (
    <th className="py-2 pr-4">
      <Link
        className={sortKey === key ? "text-neutral-900" : "text-neutral-500"}
        href={`${base}/components?sort=${key}`}
      >
        {label}
      </Link>
    </th>
  );
  const cell = (v: number | null | undefined) => (
    <td
      className={`py-1.5 pr-4 tabular-nums ${
        v == null
          ? "text-neutral-300"
          : v < 50
            ? "text-red-700"
            : v < 80
              ? "text-amber-700"
              : "text-neutral-700"
      }`}
    >
      {v == null ? "—" : Math.round(v)}
    </td>
  );

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link className="text-sm text-blue-600 underline" href={base}>
        ← summary
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">
        Components{" "}
        <span className="text-base font-normal text-neutral-400">
          ({rows.length})
        </span>
      </h1>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-xs">
            {header("Component", "name")}
            {header("Usage", "usage")}
            {header("Parity", "parity")}
            {header("Complexity", "complexity")}
            {header("Adoption", "adoption")}
            {header("Docs", "documentation")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.refKey} className="border-b border-neutral-100">
              <td className="py-1.5 pr-4">
                <Link
                  className="hover:underline"
                  href={`${base}/component/${encodeURIComponent(r.refKey)}`}
                >
                  {r.name}
                </Link>
              </td>
              <td className="py-1.5 pr-4 tabular-nums text-neutral-500">
                {r.usageTotal}
              </td>
              {cell(r.scores.parity)}
              {cell(r.scores.complexity)}
              {cell(r.scores.adoption)}
              {cell(r.scores.documentation)}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
