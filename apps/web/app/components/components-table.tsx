"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type Facet } from "@/components/data-table";
import {
  assignMapping,
  confirmMapping,
  ignoreComponent,
  setStatus,
  unlinkMapping,
} from "./actions";

export interface ComponentRowData {
  key: string;
  name: string;
  figmaName?: string;
  side: "both" | "figma" | "code";
  usage: number;
  scores: {
    parity: number | null;
    complexity: number | null;
    adoption: number | null;
    documentation: number | null;
  };
  link: "user" | "auto" | "suggested" | "none";
  confidence?: number;
  suggestedSymbol?: string;
  status: string;
  subjectSide: "figma" | "code";
  primaryRef: unknown;
  figmaRef?: unknown;
  suggestedCodeRef?: unknown;
  effectiveFigmaRef?: unknown;
  detailHref: string;
}

const STATUSES = ["stable", "new", "experimental", "deprecated"];

const SIDE_STYLE: Record<ComponentRowData["side"], string> = {
  both: "bg-violet-100 text-violet-800",
  figma: "bg-pink-100 text-pink-800",
  code: "bg-emerald-100 text-emerald-800",
};

function scoreColumn(
  id: keyof ComponentRowData["scores"],
  header: string,
): ColumnDef<ComponentRowData> {
  return {
    id,
    accessorFn: (r) => r.scores[id] ?? undefined,
    header,
    enableGlobalFilter: false,
    sortUndefined: "last",
    cell: ({ row }) => {
      const v = row.original.scores[id];
      return (
        <span
          className={`tabular-nums ${
            v == null
              ? "text-neutral-300"
              : v < 50
                ? "text-red-700"
                : v < 80
                  ? "text-amber-700"
                  : "text-neutral-600"
          }`}
        >
          {v == null ? "—" : Math.round(v)}
        </span>
      );
    },
  };
}

export function ComponentsTable({
  rows,
  workspaceId,
  codeCandidates,
  figmaCandidates,
}: {
  rows: ComponentRowData[];
  workspaceId: string;
  codeCandidates: { name: string; ref: unknown }[];
  figmaCandidates: { name: string; ref: unknown }[];
}) {
  const codeCandidatesJson = useMemo(
    () => JSON.stringify(codeCandidates),
    [codeCandidates],
  );
  const figmaCandidatesJson = useMemo(
    () => JSON.stringify(figmaCandidates),
    [figmaCandidates],
  );

  const columns: ColumnDef<ComponentRowData>[] = useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Component",
        cell: ({ row }) => (
          <>
            <Link className="hover:underline" href={row.original.detailHref}>
              {row.original.name}
            </Link>
            {row.original.figmaName && (
              <span className="ml-2 text-xs text-neutral-400">
                figma: {row.original.figmaName}
              </span>
            )}
          </>
        ),
      },
      {
        id: "side",
        accessorKey: "side",
        header: "Exists in",
        enableGlobalFilter: false,
        filterFn: "equalsString",
        cell: ({ row }) => (
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${SIDE_STYLE[row.original.side]}`}
          >
            {row.original.side}
          </span>
        ),
      },
      {
        id: "usage",
        accessorKey: "usage",
        header: "Usage",
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-neutral-500">
            {row.original.usage}
          </span>
        ),
      },
      scoreColumn("parity", "Par"),
      scoreColumn("complexity", "Cpx"),
      scoreColumn("adoption", "Adp"),
      scoreColumn("documentation", "Doc"),
      {
        id: "link",
        accessorKey: "link",
        header: "Figma ↔ code link",
        enableGlobalFilter: false,
        filterFn: "equalsString",
        cell: ({ row }) => {
          const r = row.original;
          if (r.link === "user") {
            return (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                user
              </span>
            );
          }
          if (r.link === "auto") {
            return (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                auto {Math.round((r.confidence ?? 0) * 100)}%
              </span>
            );
          }
          if (r.link === "suggested") {
            return (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                suggested: {r.suggestedSymbol}{" "}
                {Math.round((r.confidence ?? 0) * 100)}%
              </span>
            );
          }
          return <span className="text-xs text-neutral-400">not linked</span>;
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        enableGlobalFilter: false,
        filterFn: "equalsString",
        cell: ({ row }) => (
          <form action={setStatus} className="inline">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input
              type="hidden"
              name="ref"
              value={JSON.stringify(row.original.primaryRef)}
            />
            <select
              name="status"
              defaultValue={row.original.status}
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
        ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const r = row.original;
          const linked = r.link === "user" || r.link === "auto";
          return (
            <>
              {r.link === "suggested" && (
                <form action={confirmMapping} className="mr-2 inline">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input
                    type="hidden"
                    name="figmaRef"
                    value={JSON.stringify(r.figmaRef)}
                  />
                  <input
                    type="hidden"
                    name="codeRef"
                    value={JSON.stringify(r.suggestedCodeRef)}
                  />
                  <button
                    type="submit"
                    className="text-xs text-green-700 underline"
                  >
                    confirm
                  </button>
                </form>
              )}
              {linked && (
                <form action={unlinkMapping} className="inline">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input
                    type="hidden"
                    name="figmaRef"
                    value={JSON.stringify(r.effectiveFigmaRef)}
                  />
                  <button
                    type="submit"
                    className="text-xs text-red-700 underline"
                  >
                    unlink
                  </button>
                </form>
              )}
              {!linked && (
                <span className="inline-flex items-center gap-1">
                  <form action={assignMapping} className="inline-flex gap-1">
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={workspaceId}
                    />
                    <input
                      type="hidden"
                      name="subjectSide"
                      value={r.subjectSide}
                    />
                    <input
                      type="hidden"
                      name="subjectRef"
                      value={JSON.stringify(r.primaryRef)}
                    />
                    <input
                      type="hidden"
                      name="candidates"
                      value={
                        r.subjectSide === "figma"
                          ? codeCandidatesJson
                          : figmaCandidatesJson
                      }
                    />
                    <input
                      name="counterpartName"
                      list={
                        r.subjectSide === "figma"
                          ? "code-candidates"
                          : "figma-candidates"
                      }
                      placeholder={
                        r.subjectSide === "figma" ? "link code…" : "link figma…"
                      }
                      className="w-28 rounded border border-neutral-200 px-1 py-0.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="text-xs text-blue-600 underline"
                    >
                      set
                    </button>
                  </form>
                  <form action={ignoreComponent} className="inline">
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={workspaceId}
                    />
                    <input
                      type="hidden"
                      name="refs"
                      value={JSON.stringify([r.primaryRef])}
                    />
                    <button
                      type="submit"
                      className="text-xs text-neutral-400 underline"
                    >
                      ignore
                    </button>
                  </form>
                </span>
              )}
            </>
          );
        },
      },
    ],
    [workspaceId, codeCandidatesJson, figmaCandidatesJson],
  );

  const facets: Facet[] = [
    {
      columnId: "side",
      title: "Exists in",
      options: ["both", "figma", "code"].map((s) => ({ label: s, value: s })),
    },
    {
      columnId: "link",
      title: "Link",
      options: [
        { label: "user", value: "user" },
        { label: "auto", value: "auto" },
        { label: "suggested", value: "suggested" },
        { label: "not linked", value: "none" },
      ],
    },
    {
      columnId: "status",
      title: "Status",
      options: STATUSES.map((s) => ({ label: s, value: s })),
    },
  ];

  return (
    <>
      <datalist id="code-candidates">
        {codeCandidates.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      <datalist id="figma-candidates">
        {figmaCandidates.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search components…"
        facets={facets}
      />
    </>
  );
}
