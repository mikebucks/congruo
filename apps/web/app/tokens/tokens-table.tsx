"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable, type Facet } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

export interface TokenRow {
  key: string;
  name: string;
  swatch?: string;
  detail?: string;
  value?: string;
  type: string;
  sources: string[];
  references: number;
  linked: boolean;
}

// 8-digit hex is CSS RGBA — show the alpha as a percentage
function formatValue(v: string | undefined): string | undefined {
  const m = v?.match(/^(#[0-9a-f]{6})([0-9a-f]{2})$/i);
  if (!m?.[1] || !m[2]) return v;
  return `${m[1]} · ${Math.round((Number.parseInt(m[2], 16) / 255) * 100)}%`;
}

const numeric = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

const columns: ColumnDef<TokenRow>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="max-w-72 truncate" title={row.original.name}>
        <span className="font-mono text-xs">{row.original.name}</span>
        {row.original.detail && (
          <span className="ml-2 text-xs text-neutral-300">
            {row.original.detail}
          </span>
        )}
      </div>
    ),
  },
  {
    id: "value",
    accessorKey: "value",
    header: "Value",
    enableGlobalFilter: false,
    sortingFn: (a, b) => {
      const av = a.original.value ?? "";
      const bv = b.original.value ?? "";
      if (numeric(av) && numeric(bv)) return Number(av) - Number(bv);
      return av.localeCompare(bv);
    },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        {row.original.swatch && (
          <span
            className="inline-block h-4 w-4 rounded border border-neutral-200"
            style={{ backgroundColor: row.original.swatch }}
          />
        )}
        <span
          className="max-w-56 truncate font-mono text-xs text-neutral-600"
          title={row.original.value}
        >
          {formatValue(row.original.value) ?? "—"}
        </span>
      </span>
    ),
  },
  {
    id: "type",
    accessorKey: "type",
    header: "Type",
    enableGlobalFilter: false,
    filterFn: "equalsString",
    cell: ({ row }) => (
      <span className="text-xs text-neutral-500">{row.original.type}</span>
    ),
  },
  {
    id: "source",
    accessorFn: (r) => r.sources.join(", "),
    header: "Source",
    enableGlobalFilter: false,
    filterFn: (row, _id, value: string) => row.original.sources.includes(value),
    cell: ({ row }) => (
      <span className="text-xs text-neutral-500">
        {row.original.sources.join(", ")}
      </span>
    ),
  },
  {
    id: "references",
    accessorKey: "references",
    header: "References",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="tabular-nums text-neutral-600">
        {row.original.references}
      </span>
    ),
  },
  {
    id: "linked",
    accessorFn: (r) => (r.linked ? "linked" : "not linked"),
    header: "Linked",
    enableGlobalFilter: false,
    filterFn: "equalsString",
    cell: ({ row }) =>
      row.original.linked ? (
        <Badge className="bg-green-100 text-green-800">linked</Badge>
      ) : (
        <span className="text-xs text-neutral-400">—</span>
      ),
  },
];

export function TokensTable({ rows }: { rows: TokenRow[] }) {
  const facets: Facet[] = useMemo(() => {
    const types = [...new Set(rows.map((r) => r.type))].sort();
    const sources = [...new Set(rows.flatMap((r) => r.sources))].sort();
    return [
      {
        columnId: "type",
        title: "Type",
        options: types.map((t) => ({ label: t, value: t })),
      },
      {
        columnId: "source",
        title: "Source",
        options: sources.map((s) => ({ label: s, value: s })),
      },
      {
        columnId: "linked",
        title: "Linked",
        options: [
          { label: "linked", value: "linked" },
          { label: "not linked", value: "not linked" },
        ],
      },
    ];
  }, [rows]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search tokens…"
      facets={facets}
      initialSorting={[{ id: "references", desc: true }]}
    />
  );
}
